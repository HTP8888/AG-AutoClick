// ===========================================================
// AG Auto Click & Scroll — VS Code Extension
// ===========================================================
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createIpcIdentity } = require('./ipcIdentity');
const agentIntegration = require('./agentIntegration');
const { attachAgentLifecycle } = require('./agentExtensionLifecycle');
let _agentLifecycle = null;
let _agentLifecycleState = { phase: 'idle', message: '' };
const _ipcIdentity = createIpcIdentity();
const { execSync } = require('child_process');
const buildSettingsHtmlV85 = require('./settingsWebviewHtml');
const pricingDefaults = require('./pricing-defaults.json');
const {
    DEFAULT_RECOVERY_POLICY,
    normalizeRecoveryJournal,
    evaluateRecovery,
    recordRepairAttempt,
    recordRepairFailure,
    acknowledgeHealthyRenderer,
    evaluateReloadVerification
} = require('./recoveryPolicy');

// Tag markers để tìm và xoá script đã inject
const TAG_START = '<!-- AG-AUTO-CLICK-SCROLL-START -->';
const TAG_END = '<!-- AG-AUTO-CLICK-SCROLL-END -->';

/**
 * Ghi file với auto-elevation trên Linux/macOS khi gặp EACCES
 * - Linux: dùng pkexec (native password dialog)
 * - macOS: dùng osascript (native password dialog)
 * - Windows: throw lại lỗi (user cần Run as Admin)
 */
function writeFileElevated(filePath, content) {
    try {
        fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
        if (err.code !== 'EACCES' && err.code !== 'EPERM') throw err;

        const tmpPath = path.join(os.tmpdir(), 'ag-auto-' + Date.now() + '.tmp');
        fs.writeFileSync(tmpPath, content, 'utf8');

        try {
            if (process.platform === 'linux') {
                // pkexec shows native Linux password dialog
                execSync(`pkexec bash -c "cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'"`, { timeout: 30000 });
                console.log('[AG Auto] ✅ Elevated write (pkexec) →', path.basename(filePath));
            } else if (process.platform === 'darwin') {
                // macOS: osascript shows native password dialog
                const cmd = `cp '${tmpPath}' '${filePath}' && chmod 644 '${filePath}'`;
                execSync(`osascript -e 'do shell script "${cmd}" with administrator privileges'`, { timeout: 30000 });
                console.log('[AG Auto] ✅ Elevated write (osascript) →', path.basename(filePath));
            } else {
                // Windows: throw original error
                throw err;
            }
        } catch (elevErr) {
            try { fs.unlinkSync(tmpPath); } catch (_) { }
            if (elevErr === err) throw err;
            console.error('[AG Auto] Elevation failed:', elevErr.message);
            throw new Error(`Permission denied. Trên Linux, hãy thử: sudo chmod -R a+w "${path.dirname(filePath)}"`);
        }

        try { fs.unlinkSync(tmpPath); } catch (_) { }
    }
}

/**
 * Tìm file workbench.html của VS Code
 */
function getWorkbenchPath() {
    const appRoot = vscode.env.appRoot;
    console.log('[AG Auto] appRoot:', appRoot);

    // Thử nhiều đường dẫn phổ biến (VS Code + Antigravity)
    const candidates = [
        path.join(appRoot, 'out', 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'browser', 'workbench', 'workbench.html'),
        path.join(appRoot, 'out', 'vs', 'code', 'electron-main', 'workbench', 'workbench.html'),
    ];
    for (const p of candidates) {
        console.log('[AG Auto] Thử:', p, '->', fs.existsSync(p) ? 'TÌM THẤY!' : 'không có');
        if (fs.existsSync(p)) return p;
    }
    // Fallback: tìm bằng đệ quy với depth lớn hơn
    console.log('[AG Auto] Không tìm thấy trong candidates, thử tìm đệ quy...');
    const outDir = path.join(appRoot, 'out');
    const found = findFileRecursive(outDir, 'workbench.html', 6);
    console.log('[AG Auto] Kết quả tìm đệ quy:', found || 'KHÔNG TÌM THẤY');
    return found;
}

/**
 * Tìm file đệ quy với giới hạn depth
 */
function findFileRecursive(dir, filename, maxDepth) {
    if (maxDepth <= 0) return null;
    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isFile() && entry.name === filename) return fullPath;
            if (entry.isDirectory()) {
                const result = findFileRecursive(fullPath, filename, maxDepth - 1);
                if (result) return result;
            }
        }
    } catch (_) { }
    return null;
}

function getDisabledClickPatterns(context) {
    if (!context || !context.globalState) return [];
    const disabled = context.globalState.get('disabledClickPatterns', []);
    return Array.isArray(disabled) ? disabled : [];
}

function canonicalPatternName(pattern) {
    if (pattern === 'Allow This Conversation') return 'Allow This Con';
    if (pattern === 'Allow This Conversion') return null;
    return pattern;
}

function normalizePatternList(patterns) {
    if (!Array.isArray(patterns)) return [];
    const normalized = [];
    const seen = new Set();
    patterns.forEach(pattern => {
        const canonical = canonicalPatternName(pattern);
        if (!canonical || seen.has(canonical)) return;
        seen.add(canonical);
        normalized.push(canonical);
    });
    return normalized;
}

function resolveClickPatternState(context, configuredPatterns, options = {}) {
    const defaultPatterns = ['Run', 'Submit', 'Allow', 'Accept', 'Always Allow', 'Keep Waiting', 'Retry', 'Allow Once', 'Allow This Con', 'Allow in Workspace', 'Accept all'];
    const defaultOff = ['Accept all'];
    const disabledPats = normalizePatternList(getDisabledClickPatterns(context));
    const mergedPatterns = normalizePatternList(configuredPatterns);

    if (options.mergeDefaults) {
        defaultPatterns.forEach(p => {
            if (!mergedPatterns.includes(p) && !disabledPats.includes(p) && !defaultOff.includes(p)) {
                mergedPatterns.push(p);
            }
        });
    }

    const activePatterns = mergedPatterns.filter(p => !disabledPats.includes(p));
    return {
        disabledPats,
        mergedPatterns,
        activePatterns,
        acceptEnabled: activePatterns.includes('Accept'),
        safePatterns: activePatterns.filter(p => p !== 'Accept')
    };
}

function mergePricingData(baseData, overrideData) {
    const baseOffers = baseData && typeof baseData === 'object' ? baseData.offers || {} : {};
    const overrideOffers = overrideData && typeof overrideData === 'object' ? overrideData.offers || {} : {};
    const locales = new Set([...Object.keys(baseOffers), ...Object.keys(overrideOffers)]);
    const offers = {};

    locales.forEach(locale => {
        const baseLocale = baseOffers[locale] || {};
        const overrideLocale = overrideOffers[locale] || {};
        offers[locale] = {
            ...baseLocale,
            ...overrideLocale,
            sections: Array.isArray(overrideLocale.sections)
                ? overrideLocale.sections
                : (Array.isArray(baseLocale.sections) ? baseLocale.sections : [])
        };
    });

    return {
        version: overrideData?.version || baseData?.version || 1,
        updatedAt: overrideData?.updatedAt || baseData?.updatedAt || null,
        remoteUrl: overrideData?.remoteUrl || baseData?.remoteUrl || '',
        offers
    };
}

function fetchJson(url, timeoutMs = 2500) {
    return new Promise((resolve, reject) => {
        if (!url) {
            resolve(null);
            return;
        }

        const transport = url.startsWith('https://') ? require('https') : require('http');
        const req = transport.get(url, {
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            }
        }, res => {
            if (res.statusCode && res.statusCode >= 400) {
                res.resume();
                reject(new Error(`Pricing fetch failed: HTTP ${res.statusCode}`));
                return;
            }

            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => {
                body += chunk;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(new Error(`Pricing JSON parse failed: ${error.message}`));
                }
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error('Pricing fetch timeout'));
        });
        req.on('error', reject);
    });
}

async function loadPricingData() {
    const cfg = vscode.workspace.getConfiguration('ag-auto');
    const remoteUrl = (cfg.get('pricingConfigUrl', '') || '').trim() || 'https://ag-pricing.rezthetoman2u.workers.dev/pricing.json';

    try {
        const remoteData = await fetchJson(remoteUrl, 2500);
        const merged = mergePricingData(pricingDefaults, remoteData);
        console.log('[AG Auto] Loaded remote pricing config:', remoteUrl);
        return {
            ...merged,
            remoteUrl
        };
    } catch (error) {
        console.log('[AG Auto] Falling back to bundled pricing config:', error.message);
        return {
            ...pricingDefaults,
            remoteUrl
        };
    }
}

async function renderSettingsPanel(panel, context, assets = {}, languageOverride) {
    const config = vscode.workspace.getConfiguration('ag-auto');
    const pricingData = await loadPricingData();
    const configuredPatterns = config.get('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Submit', 'Keep Waiting', 'Accept']);
    const patternState = resolveClickPatternState(context, configuredPatterns, { mergeDefaults: true });

    panel.webview.html = buildSettingsHtmlV85({
        enabled: _autoAcceptEnabled,
        agentAutoIntegrate: config.get('autoIntegrateAgent', false),
        agentLifecycle: _agentLifecycleState,
        scrollEnabled: _httpScrollEnabled,
        scrollPauseMs: config.get('scrollPauseMs', 7000),
        scrollIntervalMs: config.get('scrollIntervalMs', 500),
        clickIntervalMs: config.get('clickIntervalMs', 1000),
        clickPatterns: patternState.mergedPatterns,
        disabledClickPatterns: patternState.disabledPats,
        clickLimits: context.globalState.get('clickLimits', {}),
        language: languageOverride || config.get('language', 'vi'),
        clickStats: _clickStats,
        totalClicks: _totalClicks,
        version: context.extension?.packageJSON?.version || '0.0.0',
        momoQrImageUri: assets.momoQrImageUri,
        zaloQrImageUri: assets.zaloQrImageUri,
        serverPort: _actualPort || 0,
        scriptInjected: isScriptInjected(),
        serverStartedAt: _serverStartedAt || Date.now(),
        pricingData: {
            ...pricingData,
            remoteUrl: (config.get('pricingConfigUrl', '') || '').trim() || pricingData.remoteUrl || ''
        }
    });
}


/**
 * Đọc config từ VS Code settings và tạo nội dung script
 */
function buildScriptContent(context) {
    const config = vscode.workspace.getConfiguration('ag-auto');
    const pauseMs = config.get('scrollPauseMs', 7000);
    const scrollMs = config.get('scrollIntervalMs', 500);
    const clickMs = config.get('clickIntervalMs', 1000);
    const allPatterns = config.get('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Submit', 'Keep Waiting', 'Accept all', 'Accept']);
    const patternState = resolveClickPatternState(context, allPatterns, { mergeDefaults: true });
    const patterns = patternState.safePatterns;
    const enabled = context.globalState.get('startupEnabledPreference', true);

    // Read template script
    const templatePath = path.join(context.extensionPath, 'media', 'autoScript.js');
    let script = fs.readFileSync(templatePath, 'utf8');

    // Config path for live reload (use forward slashes for Electron)
    const wbPath = getWorkbenchPath();
    const configFilePath = wbPath ? path.join(path.dirname(wbPath), 'ag-auto-config.json').replace(/\\/g, '/') : '';
    // Replace placeholders with actual config values
    script = script.replace(/\/\*\{\{PAUSE_SCROLL_MS\}\}\*\/\d+/, pauseMs.toString());
    script = script.replace(/\/\*\{\{SCROLL_INTERVAL_MS\}\}\*\/\d+/, scrollMs.toString());
    script = script.replace(/\/\*\{\{CLICK_INTERVAL_MS\}\}\*\/\d+/, clickMs.toString());
    script = script.replace(
        /\/\*\{\{CLICK_PATTERNS\}\}\*\/\[.*?\]/,
        JSON.stringify(patterns)
    );
    script = script.replace(/\/\*\{\{ENABLED\}\}\*\/\w+/, enabled.toString());
    script = script.replace(/\/\*\{\{CONFIG_PATH\}\}\*\//, configFilePath);
    script = script.replace(/\/\*\{\{WORKBENCH_DIR\}\}\*\/""/, JSON.stringify(wbPath ? path.dirname(wbPath).replace(/\\/g, '/') : ''));

    return script;
}

/**
 * Ghi config JSON ra file để script inject reload realtime (không cần restart)
 */
function writeConfigJson(context) {
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return;
        const wbDir = path.dirname(wbPath);
        const config = vscode.workspace.getConfiguration('ag-auto');
        const allPatterns = config.get('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Submit', 'Keep Waiting', 'Accept']);
        const patternState = resolveClickPatternState(context, allPatterns, { mergeDefaults: true });
        const enabled = _autoAcceptEnabled;
        const configData = JSON.stringify({
            enabled: enabled,
            scrollEnabled: _httpScrollEnabled,
            clickPatterns: patternState.safePatterns,
            acceptInChatOnly: patternState.acceptEnabled,
            pauseScrollMs: config.get('scrollPauseMs', 7000),
            scrollIntervalMs: config.get('scrollIntervalMs', 500),
            clickIntervalMs: config.get('clickIntervalMs', 1000),
            clickLimits: context.globalState.get('clickLimits', {})
        });
        const configPath = path.join(wbDir, 'ag-auto-config.json');
        writeFileElevated(configPath, configData);
        console.log('[AG Auto] Config JSON updated:', configData);

        // Agent configuration is applied explicitly via Sync; never patch another app on IDE settings writes.
    } catch (e) {
        console.error('[AG Auto] Error writing config JSON:', e.message);
    }
}


function injectIntoWorkbenchHtml(html, injection) {
    if (/<\/body>/i.test(html)) {
        return html.replace(/<\/body>/i, injection + '\n</body>');
    }
    if (/<\/html>/i.test(html)) {
        return html.replace(/<\/html>/i, injection + '\n</html>');
    }
    return html + '\n' + injection + '\n';
}

function hasValidHtmlInjection(html) {
    return html.includes(TAG_START) &&
        html.includes(TAG_END) &&
        /<script[^>]+src=["'][^"']*ag-auto-script\.js(?:\?[^"']*)?["'][^>]*>/i.test(html);
}

/**
 * Inject script vào workbench — thử nhiều cách để tương thích mọi phiên bản
 */
function installScript(context) {
    console.log('[AG Auto] installScript() đang chạy...');
    const wbPath = getWorkbenchPath();
    if (!wbPath) {
        console.error('[AG Auto] KHÔNG TÌM THẤY workbench.html!');
        vscode.window.showErrorMessage('[AG Auto] Không tìm thấy workbench.html! Hãy kiểm tra cài đặt VS Code.');
        return false;
    }
    console.log('[AG Auto] Tìm thấy workbench.html tại:', wbPath);

    const wbDir = path.dirname(wbPath);
    const scriptContent = buildScriptContent(context);

    // ===== Step 1: CLEANUP old JS injection from workbench.js (don't add anything new) =====
    const JS_TAG_START = '/* AG-AUTO-CLICK-SCROLL-JS-START */';
    const JS_TAG_END = '/* AG-AUTO-CLICK-SCROLL-JS-END */';

    try {
        // Find JS files and remove old injected code
        const htmlContent = fs.readFileSync(wbPath, 'utf8');
        const scriptMatches = htmlContent.match(/src="([^"]*\.js)"/g) || [];
        const jsFiles = new Set();

        for (const match of scriptMatches) {
            const srcMatch = match.match(/src="([^"]*\.js)"/);
            if (srcMatch) {
                const jsName = path.basename(srcMatch[1].split('?')[0]);
                if (jsName === 'ag-auto-script.js') continue; // Skip our own script
                const sameDirPath = path.join(wbDir, jsName);
                if (fs.existsSync(sameDirPath)) jsFiles.add(sameDirPath);
                const parent1 = path.join(wbDir, '..', jsName);
                if (fs.existsSync(parent1)) jsFiles.add(path.resolve(parent1));
                const parent2 = path.join(wbDir, '..', '..', jsName);
                if (fs.existsSync(parent2)) jsFiles.add(path.resolve(parent2));
            }
        }

        // Fallback: also check workbench.desktop.main.js
        if (jsFiles.size === 0) {
            const fallbackNames = ['workbench.desktop.main.js', 'workbench.js'];
            for (const name of fallbackNames) {
                const found = findFileRecursive(path.join(wbDir, '..'), name, 3);
                if (found) { jsFiles.add(found); break; }
            }
        }

        for (const jsPath of jsFiles) {
            let jsContent = fs.readFileSync(jsPath, 'utf8');
            const jsRegex = new RegExp(`${escapeRegex(JS_TAG_START)}[\\s\\S]*?${escapeRegex(JS_TAG_END)}`, 'g');
            if (jsRegex.test(jsContent)) {
                jsContent = jsContent.replace(jsRegex, '');
                writeFileElevated(jsPath, jsContent);
                console.log('[AG Auto] 🧹 Cleaned old inject from', path.basename(jsPath));
            }
        }
    } catch (err) {
        console.error('[AG Auto] Lá»—i cleanup JS:', err.message);
    }

    // ===== Step 2: Write ag-auto-script.js + inject HTML <script> tag =====
    try {
        let html = fs.readFileSync(wbPath, 'utf8');
        const htmlRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(htmlRegex, '');

        const ts = Date.now();

        // Write fresh script file
        const destPath = path.join(wbDir, 'ag-auto-script.js');
        writeFileElevated(destPath, scriptContent);

        // Add <script> tag to HTML. Prefer </body>, then </html>, then append.
        const injection = `\n${TAG_START}\n<script src="ag-auto-script.js?v=${ts}"></script>\n${TAG_END}`;
        html = injectIntoWorkbenchHtml(html, injection);

        if (!hasValidHtmlInjection(html)) {
            throw new Error('HTML injection marker/script verification failed');
        }

        writeFileElevated(wbPath, html);
        console.log('[AG Auto] ✅ HTML inject + fresh ag-auto-script.js (v=' + ts + ')');

        // Standalone Agent installation is a separate, explicit Sync operation.
    } catch (err) {
        console.error('[AG Auto] Lỗi inject vào HTML:', err.message);
        return false;
    }

    return true;
}

/**
 * Cập nhật checksums trong product.json sau khi inject/uninstall
 * để tránh lỗi "Your Antigravity installation appears to be corrupt"
 */
function updateProductChecksums() {
    try {
        // Tìm product.json qua nhiều cách
        let productJsonPath = null;

        // Cách 1: process.resourcesPath (nhanh nhất)
        if (process.resourcesPath) {
            const candidate = path.join(process.resourcesPath, 'app', 'product.json');
            if (fs.existsSync(candidate)) productJsonPath = candidate;
        }

        // Cách 2: Từ workbench path đi lên
        if (!productJsonPath) {
            const wbPath = getWorkbenchPath();
            if (!wbPath) return;
            let searchDir = path.dirname(wbPath);
            for (let i = 0; i < 8; i++) {
                const candidate = path.join(searchDir, 'product.json');
                if (fs.existsSync(candidate)) {
                    productJsonPath = candidate;
                    break;
                }
                searchDir = path.dirname(searchDir);
            }
        }

        if (!productJsonPath) {
            console.log('[AG Auto] product.json không tìm thấy, bỏ qua checksum update');
            return;
        }

        console.log('[AG Auto] Tìm thấy product.json:', productJsonPath);
        const productJson = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));

        if (!productJson.checksums) {
            console.log('[AG Auto] product.json không có trường checksums, bỏ qua');
            return;
        }
        // product.json ở resources/app/ nhưng files ở resources/app/out/
        const appRoot = path.dirname(productJsonPath);
        const outDir = path.join(appRoot, 'out');
        let updated = false;

        // Recalculate checksums cho tất cả files trong product.json
        for (const relativePath in productJson.checksums) {
            // relativePath dùng forward slashes (e.g. "vs/workbench/workbench.desktop.main.js")
            // Trên Windows cần convert thành native path separator
            const nativePath = relativePath.split('/').join(path.sep);
            // Thử tìm file ở out/ trước, nếu ko có thì thử appRoot trực tiếp
            let filePath = path.join(outDir, nativePath);
            if (!fs.existsSync(filePath)) filePath = path.join(appRoot, nativePath);
            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath);
                const hash = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
                const oldHash = productJson.checksums[relativePath];
                if (oldHash !== hash) {
                    productJson.checksums[relativePath] = hash;
                    updated = true;
                    console.log('[AG Auto] Checksum updated:', relativePath, '(old:', oldHash.substring(0, 10) + '...', 'new:', hash.substring(0, 10) + '...)');
                }
            }
        }

        if (updated) {
            writeFileElevated(productJsonPath, JSON.stringify(productJson, null, '\t'));
            console.log('[AG Auto] ✅ product.json checksums đã cập nhật!');
        } else {
            console.log('[AG Auto] Checksums đã đúng, không cần update');
        }
        return updated;
    } catch (e) {
        console.error('[AG Auto] Lá»—i update checksums:', e.message);
        return false;
    }
}

/**
 * Clear V8 bytecode code cache to force Electron to recompile JS from disk
 * Without this, Electron reuses cached bytecode and ignores file changes
 */
function clearV8CodeCache() {
    try {
        const appDataDir = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        const codeCacheDir = path.join(appDataDir, 'Antigravity', 'Code Cache', 'js');
        if (fs.existsSync(codeCacheDir)) {
            fs.rmSync(codeCacheDir, { recursive: true, force: true });
            console.log('[AG Auto] Cleared V8 code cache:', codeCacheDir);
        } else {
            console.log('[AG Auto] V8 code cache dir not found:', codeCacheDir);
        }
    } catch (e) {
        console.log('[AG Auto] Could not clear code cache:', e.message);
    }
}

/**
 * Gỡ script khỏi workbench.html
 */
function uninstallScript() {
    const wbPath = getWorkbenchPath();
    if (!wbPath) return false;

    // Gỡ bỏ sạch sẽ khỏi Antigravity Antigravity Agent 2.0
    try {
        const agentRemoval = agentIntegration.uninstallAgentHook({ agentPath: vscode.workspace.getConfiguration('ag-auto').get('agentPath', '') });
        if (!agentRemoval.success && agentRemoval.code !== 'AGENT_NOT_FOUND') vscode.window.showWarningMessage('[AG Auto] Agent chưa được gỡ: ' + (agentRemoval.error || agentRemoval.code) + '. Tắt trong panel Agent nếu vẫn đang mở.');
        console.log('[AG Auto] ✅ Đã gỡ bỏ hook khỏi Antigravity Agent.');
    } catch (agentErr) {
        console.error('[AG Auto] Lỗi gỡ hook Agent:', agentErr.message);
    }

    const wbDir = path.dirname(wbPath);
    const JS_TAG_START = '/* AG-AUTO-CLICK-SCROLL-JS-START */';
    const JS_TAG_END = '/* AG-AUTO-CLICK-SCROLL-JS-END */';

    try {
        // Xoá từ workbench.html
        let html = fs.readFileSync(wbPath, 'utf8');
        const htmlRegex = new RegExp(`${escapeRegex(TAG_START)}[\\s\\S]*?${escapeRegex(TAG_END)}`, 'g');
        html = html.replace(htmlRegex, '');
        writeFileElevated(wbPath, html);

        // Xoá file script và file phụ do AG Auto tạo
        const scriptPath = path.join(wbDir, 'ag-auto-script.js');
        if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);

        const sidecarFiles = [
            'ag-auto-config.json',
            'ag-auto-window-bindings.json',
            'ag-auto-ports.json'
        ];
        for (const fileName of sidecarFiles) {
            const p = path.join(wbDir, fileName);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        }
        for (const entry of fs.readdirSync(wbDir)) {
            if (/^ag-auto-port-\d+\.txt$/.test(entry)) {
                fs.unlinkSync(path.join(wbDir, entry));
            }
        }

        // Xoá từ workbench.desktop.main.js
        const mainJsCandidates = ['workbench.desktop.main.js', 'workbench.js'];
        for (const name of mainJsCandidates) {
            const p = path.join(wbDir, name);
            if (fs.existsSync(p)) {
                let js = fs.readFileSync(p, 'utf8');
                const jsRegex = new RegExp(`${escapeRegex(JS_TAG_START)}[\\s\\S]*?${escapeRegex(JS_TAG_END)}`, 'g');
                js = js.replace(jsRegex, '');
                writeFileElevated(p, js);
            }
        }

        return true;
    } catch (err) {
        vscode.window.showErrorMessage(`[AG Auto] Không thể gỡ bỏ cấu hình do thiếu quyền Administrator. Vui lòng mở lại VS Code dưới quyền Admin! Chi tiết: ${err.message}`);
        return false;
    }
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let _httpServer = null;
let _actualPort = 0;
let _settingsPanel = null;
const AG_HTTP_PORT_START = 48787;
const AG_HTTP_PORT_END = 48850;
let _settingsOpenRequestedThisSession = false;
let _settingsOpenedThisSession = false;
let _lastSettingsOpenAt = 0;
const SETTINGS_OPEN_GUARD_MS = 5000;
let _promoShownThisSession = false;
let _promoFallbackScheduled = false;
let _promoFallbackReady = false;
let _promoFallbackTimer = null;
const SETTINGS_PANEL_TITLE = 'AG Auto Click & Scroll - Settings';
const SETTINGS_PANEL_VIEW_TYPE = 'agAutoSettingsManualOnly';
const LEGACY_SETTINGS_PANEL_VIEW_TYPES = ['agAutoSettings', 'agAutoSettingsManual', SETTINGS_PANEL_VIEW_TYPE];
const SUPPRESS_SETTINGS_RESTORE_KEY = 'agSuppressSettingsRestoreUntil';
const PROMO_DELAY_MS = 30 * 1000;              // 30s after startup
const PROMO_NOTIFICATION_TIMEOUT_MS = 30 * 1000; // 30s timeout for notification
const PROMO_AFTER_XEM_NGAY_MS = 6 * 60 * 60 * 1000;  // 6h after "Xem ngay"
const PROMO_AFTER_DE_SAU_MS = 2 * 60 * 60 * 1000;     // 2h after "De sau"
const PROMO_FALLBACK_MS = 4 * 60 * 60 * 1000;         // one proactive dashboard after 4h
const PROMO_BOT_URL = 'https://t.me/infinityaistore_bot';

function settingsPanelRecentlyOpened() {
    return _lastSettingsOpenAt > 0 && (Date.now() - _lastSettingsOpenAt) < SETTINGS_OPEN_GUARD_MS;
}

function suppressSettingsRestoreForNextStartup(context, ttlMs = 45000) {
    if (!context || !context.globalState) return Promise.resolve();
    return context.globalState.update(SUPPRESS_SETTINGS_RESTORE_KEY, Date.now() + Math.max(5000, ttlMs));
}

async function consumePendingSettingsRestoreSuppression(context) {
    if (!context || !context.globalState) return false;
    const suppressUntil = Number(context.globalState.get(SUPPRESS_SETTINGS_RESTORE_KEY, 0));
    if (!suppressUntil) return false;

    await context.globalState.update(SUPPRESS_SETTINGS_RESTORE_KEY, 0);
    return suppressUntil > Date.now();
}

async function openFallbackDashboardIfReady(context) {
    if (!_promoFallbackReady) return;
    if (_promoShownThisSession || _settingsOpenedThisSession || _settingsPanel) {
        _promoFallbackReady = false;
        console.log('[AG Auto] Promo fallback: skipped because promo/settings was already shown this session');
        return;
    }
    if (!_windowFocused || (vscode.window.state && vscode.window.state.focused === false)) {
        console.log('[AG Auto] Promo fallback: due, waiting for this project window to regain focus');
        return;
    }

    _promoFallbackReady = false;
    _promoShownThisSession = true;
    console.log('[AG Auto] Promo fallback: opening dashboard once after 4h');
    try {
        await openSettingsPanel(context, { scrollToPromo: true, trigger: 'promo' });
    } catch (e) {
        _promoShownThisSession = false;
        console.log('[AG Auto] Promo fallback error:', e.message);
    }
}

function scheduleFallbackDashboard(context) {
    if (_promoFallbackScheduled) return;
    _promoFallbackScheduled = true;
    console.log('[AG Auto] Promo fallback: will open dashboard once in ' + (PROMO_FALLBACK_MS / 3600000) + 'h');

    if (typeof vscode.window.onDidChangeWindowState === 'function') {
        const focusDisposable = vscode.window.onDidChangeWindowState(state => {
            if (state.focused !== false && _promoFallbackReady) {
                openFallbackDashboardIfReady(context).catch(e => {
                    console.log('[AG Auto] Deferred promo fallback error:', e.message);
                });
            }
        });
        context.subscriptions.push(focusDisposable);
    }

    const timer = setTimeout(async () => {
        if (_promoFallbackTimer === timer) _promoFallbackTimer = null;
        _promoFallbackReady = true;
        await openFallbackDashboardIfReady(context);
    }, PROMO_FALLBACK_MS);
    _promoFallbackTimer = timer;
    context.subscriptions.push({ dispose: () => {
        clearTimeout(timer);
        if (_promoFallbackTimer === timer) _promoFallbackTimer = null;
    } });
}

async function showPromoNotification(context) {
    console.log('[AG Auto] Promo: showing notification...');
    if (_promoShownThisSession || _settingsPanel) {
        console.log('[AG Auto] Promo: already shown or panel open, skipping');
        return;
    }
    try {
        const notificationPromise = vscode.window.showInformationMessage(
            '🤖 BOT Auto Order — Hàng AI nhiều lắm, quẹo lựa đi sếp!',
            'Xem ngay',
            'Để sau'
        );
        const timeoutPromise = new Promise(resolve =>
            setTimeout(() => resolve('__timeout__'), PROMO_NOTIFICATION_TIMEOUT_MS)
        );
        const choice = await Promise.race([notificationPromise, timeoutPromise]);

        if (choice === 'Xem ngay') {
            _promoShownThisSession = true;
            console.log('[AG Auto] Promo: user clicked Xem ngay, opening BOT Auto Order; next notification in 6h');
            await vscode.env.openExternal(vscode.Uri.parse(PROMO_BOT_URL));
            const retryTimer = setTimeout(() => {
                _promoShownThisSession = false;
                showPromoNotification(context);
            }, PROMO_AFTER_XEM_NGAY_MS);
            context.subscriptions.push({ dispose: () => clearTimeout(retryTimer) });
        } else if (choice === 'Để sau') {
            console.log('[AG Auto] Promo: user clicked De sau, retry notification in 2h');
            const retryTimer = setTimeout(() => showPromoNotification(context), PROMO_AFTER_DE_SAU_MS);
            context.subscriptions.push({ dispose: () => clearTimeout(retryTimer) });
        } else {
            console.log('[AG Auto] Promo: no response; one-time 4h dashboard fallback remains scheduled');
            scheduleFallbackDashboard(context);
        }
    } catch (e) {
        console.log('[AG Auto] Promo error:', e.message);
    }
}

function scheduleSoftPromo(context) {
    // Schedule exactly one proactive dashboard fallback from extension activation.
    scheduleFallbackDashboard(context);
    console.log('[AG Auto] Promo scheduled: notification in ' + PROMO_DELAY_MS + 'ms');
    const timer = setTimeout(() => showPromoNotification(context), PROMO_DELAY_MS);
    context.subscriptions.push({ dispose: () => clearTimeout(timer) });
}

function isAgSettingsTab(tab) {
    if (!tab) return false;
    // Check by viewType (most reliable)
    const isAgSettingsView = tab.input && LEGACY_SETTINGS_PANEL_VIEW_TYPES.includes(tab.input.viewType);
    // Check by EXACT label match only — avoid matching the Extension detail tab
    const label = typeof tab.label === 'string' ? tab.label : '';
    const isAgSettingsLabel = label === SETTINGS_PANEL_TITLE;
    // Check restored webview viewType containing our prefix
    const isRestoredWebview = tab.input && tab.input.viewType && (
        typeof tab.input.viewType === 'string' && (
            tab.input.viewType.indexOf('agAuto') !== -1 ||
            tab.input.viewType.indexOf('ag-auto') !== -1
        )
    );
    return !!(isAgSettingsView || isAgSettingsLabel || isRestoredWebview);
}

/**
 * Mở Webview Settings Panel từ thao tác người dùng hoặc promo một lần trong phiên.
 * Việc mở panel không được thay đổi trạng thái Accept/Scroll.
 */
async function openSettingsPanel(context, options = {}) {
    const trigger = options.trigger || '';
    if (trigger !== 'user' && trigger !== 'promo') {
        console.log('[AG Auto] Blocked dashboard open without an explicit user/promo trigger');
        return;
    }
    _settingsOpenRequestedThisSession = true;
    _settingsOpenedThisSession = true;
    _lastSettingsOpenAt = Date.now();

    if (_settingsPanel) {
        const existingPanel = _settingsPanel;
        if (typeof existingPanel.visible === 'boolean') {
            if (!options.scrollToPromo && existingPanel.visible) {
                existingPanel.dispose();
                _settingsPanel = null;
                return;
            }
        } else if (!options.scrollToPromo) {
            try {
                existingPanel.reveal(vscode.ViewColumn.One);
                return;
            } catch (e) {
                console.log('[AG Auto] Stale settings panel reference detected, recreating panel:', e.message);
                _settingsPanel = null;
            }
        }
    }

    // If panel exists and we need to scroll to promo, refresh + reveal + send message
    if (_settingsPanel && options.scrollToPromo) {
        const panel = _settingsPanel;
        await renderSettingsPanel(panel, context, {
            momoQrImageUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'momo-qr.png')).toString(),
            zaloQrImageUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'zalo-qr.png')).toString()
        });
        panel.reveal(vscode.ViewColumn.One);
        setTimeout(() => {
            try { panel.webview.postMessage({ command: 'scrollToPromo' }); } catch(e) {}
        }, 700);
        return;
    }

    const panel = vscode.window.createWebviewPanel(
        SETTINGS_PANEL_VIEW_TYPE,
        SETTINGS_PANEL_TITLE,
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
        }
    );
    _settingsPanel = panel;
    const momoQrImageUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'momo-qr.png')).toString();
    const zaloQrImageUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'zalo-qr.png')).toString();

    // Clear reference when panel is closed
    panel.onDidDispose(() => {
        if (_settingsPanel === panel) {
            _settingsPanel = null;
        }
        if (!settingsPanelRecentlyOpened()) {
            _settingsOpenRequestedThisSession = false;
        }
    });

    renderSettingsPanel(panel, context, { momoQrImageUri, zaloQrImageUri }).catch(error => {
        console.error('[AG Auto] Failed to render settings panel:', error.message);
        panel.webview.html = buildSettingsHtmlV85({
            enabled: true, scrollEnabled: true, scrollPauseMs: 7000, scrollIntervalMs: 500,
            clickIntervalMs: 1000, clickPatterns: ['Allow','Always Allow','Run','Submit','Keep Waiting','Accept'],
            disabledClickPatterns: [], language: 'vi', clickStats: _clickStats, totalClicks: _totalClicks,
            version: context.extension?.packageJSON?.version || '0.0.0',
            momoQrImageUri, zaloQrImageUri, serverPort: _actualPort || 0, scriptInjected: isScriptInjected(),
            serverStartedAt: _serverStartedAt || Date.now(), pricingData: pricingDefaults
        });
    });

    // If opened from promo, scroll to promo section after render
    if (options.scrollToPromo) {
        setTimeout(() => {
            try { panel.webview.postMessage({ command: 'scrollToPromo' }); } catch(e) {}
        }, 1500);
    }

    // Nhận message từ Webview
    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'agentAutoIntegrate' && typeof msg.enabled === 'boolean') {
            await vscode.commands.executeCommand('ag-auto.setAgentAutomation', msg.enabled);
            return;
        }
        if (msg.command === 'agentRetry') {
            if (_agentLifecycle) await _agentLifecycle.retry();
            return;
        }
        if (msg.command === 'agentSync' || msg.command === 'agentDiagnose') {
            await vscode.commands.executeCommand(msg.command === 'agentSync' ? 'ag-auto.syncAgent' : 'ag-auto.diagnoseAgent');
            return;
        }
        if (msg.command === 'changeLang') {
            const cfg = vscode.workspace.getConfiguration('ag-auto');
            await cfg.update('language', msg.lang, vscode.ConfigurationTarget.Global);
            await renderSettingsPanel(panel, context, { momoQrImageUri, zaloQrImageUri }, msg.lang);
            return;
        }
        if (msg.command === 'toggle') {
            _autoAcceptEnabled = msg.enabled;
            await context.globalState.update('startupEnabledPreference', _autoAcceptEnabled);
            writeConfigJson(context);
            if (_autoAcceptEnabled && (!_httpServer || _actualPort <= 0)) {
                console.log('[AG Auto] Toggle ON requested while HTTP server is not listening — starting IPC server now');
                startHttpServer();
            }
            updateStatusBarItem();
            console.log('[AG Auto] INSTANT toggle: ' + (_autoAcceptEnabled ? 'ON ✅' : 'OFF 🛑') + ' (window-local)');
            return;
        }
        if (msg.command === 'scrollToggle') {
            _httpScrollEnabled = msg.enabled;
            await context.globalState.update('scrollEnabledPreference', _httpScrollEnabled);
            writeConfigJson(context);
            updateStatusBarItem();
            console.log('[AG Auto] INSTANT scroll toggle: ' + (_httpScrollEnabled ? 'ON ✅' : 'OFF 🛑') + ' (persisted)');
            return;
        }
        if (msg.command === 'save') {
            console.log('[AG Auto] Nhận lệnh SAVE từ Webview, data:', JSON.stringify(msg.data));
            _autoAcceptEnabled = msg.data.enabled;
            _httpClickPatterns = msg.data.clickPatterns.filter(p => !msg.data.disabledClickPatterns.includes(p));
            _httpScrollConfig = {
                pauseScrollMs: msg.data.scrollPauseMs || 5000,
                scrollIntervalMs: msg.data.scrollIntervalMs || 500,
                clickIntervalMs: msg.data.clickIntervalMs || 2000
            };
            await context.globalState.update('disabledClickPatterns', msg.data.disabledClickPatterns);
            await context.globalState.update('clickLimits', msg.data.clickLimits || {});
            await context.globalState.update('startupEnabledPreference', _autoAcceptEnabled);
            await context.globalState.update('scrollEnabledPreference', _httpScrollEnabled);
            try {
                const cfg = vscode.workspace.getConfiguration('ag-auto');
                await cfg.update('clickPatterns', msg.data.clickPatterns, vscode.ConfigurationTarget.Global);
                await cfg.update('clickIntervalMs', msg.data.clickIntervalMs || 2000, vscode.ConfigurationTarget.Global);
                await cfg.update('scrollPauseMs', msg.data.scrollPauseMs || 5000, vscode.ConfigurationTarget.Global);
                await cfg.update('scrollIntervalMs', msg.data.scrollIntervalMs || 500, vscode.ConfigurationTarget.Global);
                await cfg.update('language', msg.data.language, vscode.ConfigurationTarget.Global);
            } catch (e) {
                console.log('[AG Auto] Language/config update failed, storing in globalState:', e.message);
                await context.globalState.update('language', msg.data.language);
                await context.globalState.update('clickPatterns', msg.data.clickPatterns);
            }
            console.log('[AG Auto] HTTP state updated — patterns:', _httpClickPatterns.length, 'scroll:', JSON.stringify(_httpScrollConfig), 'enabled:', _autoAcceptEnabled, '(window-local)');

            writeConfigJson(context);
            updateStatusBarItem();
            startCommandsLoop();

            const updatedLang = msg.data.language;
            let savedMsg = '$(check) [AG Auto] Saved!';
            if (updatedLang === 'en') savedMsg = '$(check) [AG Auto] Saved!';
            if (updatedLang === 'zh') savedMsg = '$(check) [AG Auto] Saved!';
            vscode.window.setStatusBarMessage(savedMsg, 3000);
            return;
        }
        if (msg.command === 'reload') {
            vscode.commands.executeCommand('workbench.action.reloadWindow');
            return;
        }
        if (msg.command === 'resetStats') {
            _clickStats = {};
            _totalClicks = 0;
            _resetStatsRequested = true;
            // Clear persisted stats
            context.globalState.update('clickStats', {});
            context.globalState.update('totalClicks', 0);
            panel.webview.postMessage({ command: 'statsUpdated', clickStats: {}, totalClicks: 0 });
            return;
        }
        if (msg.command === 'clearClickLog') {
            _clickLog = [];
            if (_extensionContext) _extensionContext.globalState.update('clickLog', []);
            panel.webview.postMessage({ command: 'clickLogUpdate', log: [] });
            return;
        }
        if (msg.command === 'getClickLog') {
            panel.webview.postMessage({ command: 'clickLogUpdate', log: _clickLog });
            return;
        }
        if (msg.command === 'getStats') {
            panel.webview.postMessage({ command: 'statsUpdated', clickStats: _clickStats, totalClicks: _totalClicks });
        }
    }, undefined, context.subscriptions);

    // Auto-refresh stats every 2s while panel is open
    const statsTimer = setInterval(() => {
        try {
            panel.webview.postMessage({ command: 'statsUpdated', clickStats: _clickStats, totalClicks: _totalClicks });
        } catch (e) { clearInterval(statsTimer); }
    }, 2000);
    panel.onDidDispose(() => clearInterval(statsTimer));
}

function registerUnexpectedSettingsTabGuard(context) {
    const scheduleCleanup = (delayMs) => {
        const timer = setTimeout(() => {
            closeUnexpectedSettingsTabs();
        }, delayMs);
        context.subscriptions.push({ dispose: () => clearTimeout(timer) });
    };

    [50, 250, 1000, 2500, 5000, 9000].forEach(scheduleCleanup);

    if (!vscode.window.tabGroups || typeof vscode.window.tabGroups.onDidChangeTabs !== 'function') return;

    let pendingCleanupTimer = null;
    const clearPendingCleanup = () => {
        if (pendingCleanupTimer) {
            clearTimeout(pendingCleanupTimer);
            pendingCleanupTimer = null;
        }
    };

    context.subscriptions.push({ dispose: clearPendingCleanup });
    context.subscriptions.push(
        vscode.window.tabGroups.onDidChangeTabs(() => {
            if (_settingsOpenRequestedThisSession) return;
            clearPendingCleanup();
            pendingCleanupTimer = setTimeout(() => {
                pendingCleanupTimer = null;
                closeUnexpectedSettingsTabs();
            }, 50);
        })
    );
}

// =============================================================
// STATUS BAR
// =============================================================
let statusBarItem;
let statusBarScroll;
let reloadRequiredStatusBar;

function createStatusBarItem(context) {
    // Persistent recovery warning is separate from Accept/Scroll so their layout
    // and ON/OFF preference rendering never changes with runtime health.
    reloadRequiredStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, -9999);
    reloadRequiredStatusBar.command = 'ag-auto.reloadRequired';
    context.subscriptions.push(reloadRequiredStatusBar);

    // Accept item (far right, higher priority = more left)
    statusBarItem = vscode.window.createStatusBarItem(_ipcIdentity.marker + '-accept', vscode.StatusBarAlignment.Right, -10000);
    statusBarItem.command = 'ag-auto.openSettings';
    context.subscriptions.push(statusBarItem);

    // Scroll item (far right, next to Accept)
    statusBarScroll = vscode.window.createStatusBarItem(_ipcIdentity.marker + '-scroll', vscode.StatusBarAlignment.Right, -10001);
    statusBarScroll.command = 'ag-auto.openSettings';
    context.subscriptions.push(statusBarScroll);

    updateStatusBarItem();
    updateReloadRequiredWarning();
    statusBarItem.show();
    statusBarScroll.show();
}

function updateStatusBarItem() {
    if (!statusBarItem || !statusBarScroll) return;

    function renderItem(item, label, enabled) {
        // Runtime health/recovery phases intentionally stay internal. The status bar
        // only mirrors the user's configured ON/OFF preference, so opening another
        // project cannot expose transient supervisor states in the UI.
        if (!enabled) {
            item.text = '$(circle-slash) ' + label + ' OFF';
            item.color = '#F44747';
            item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            item.tooltip = 'Auto ' + label + ': OFF\nClick to open Settings';
            return;
        }
        item.text = '$(check) ' + label + ' ON';
        item.color = '#4EC9B0';
        item.backgroundColor = undefined;
        item.tooltip = 'Auto ' + label + ': ON\nClick to open Settings';
    }

    renderItem(statusBarItem, 'Accept', _autoAcceptEnabled);
    renderItem(statusBarScroll, 'Scroll', _httpScrollEnabled);
}

async function closeUnexpectedSettingsTabs(options = {}) {
    if ((_settingsOpenRequestedThisSession || settingsPanelRecentlyOpened()) && !options.force) return;
    if (settingsPanelRecentlyOpened()) {
        console.log('[AG Auto] Skip restore suppression: settings were just opened intentionally');
        return;
    }
    let closedAny = false;

    if (_settingsPanel) {
        try {
            _settingsPanel.dispose();
            closedAny = true;
        } catch (e) {
            console.log('[AG Auto] Could not dispose stray settings panel:', e.message);
        } finally {
            _settingsPanel = null;
        }
    }



    const activeTab = vscode.window.tabGroups && vscode.window.tabGroups.activeTabGroup
        ? vscode.window.tabGroups.activeTabGroup.activeTab
        : null;
    if (isAgSettingsTab(activeTab)) {
        try {
            await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
            closedAny = true;
        } catch (e) {
            console.log('[AG Auto] Could not close active restored settings editor:', e.message);
        }
    }

    if (!vscode.window.tabGroups || typeof vscode.window.tabGroups.close !== 'function') {
        return;
    }

    try {
        const tabsToClose = [];
        for (const group of vscode.window.tabGroups.all || []) {
            for (const tab of group.tabs || []) {
                if (isAgSettingsTab(tab)) {
                    tabsToClose.push(tab);
                }
            }
        }

        if (tabsToClose.length > 0) {
            await vscode.window.tabGroups.close(tabsToClose, true);
            closedAny = true;
            console.log('[AG Auto] Closed restored settings tab(s):', tabsToClose.length);
        }
    } catch (e) {
        console.log('[AG Auto] Could not close restored settings tab:', e.message);
    }

    if (closedAny) {
        console.log('[AG Auto] Suppressed unexpected settings panel restore');
    }
}

// =============================================================
// HTTP MICRO-SERVER for IPC with injected workbench script
// The injected script polls http://127.0.0.1:48787/ag-status
// Extension Host controls _autoAcceptEnabled, server returns it
// =============================================================
const http = require('http');
let _autoAcceptEnabled = true;
let _httpScrollEnabled = true;
let _httpClickPatterns = [];
let _httpDefaultsInitialized = false;
let _httpScrollConfig = { pauseScrollMs: 5000, scrollIntervalMs: 500, clickIntervalMs: 2000 };
let _clickStats = {};
let _clickLog = []; // In-memory click log (last 200)
let _totalClicks = 0;
let _resetStatsRequested = false;
let _extensionContext = null;
let _serverStartedAt = Date.now();
let _serverGeneration = '';
let _serverOwnerWindowKey = '';
let _serverPreferredWindowKey = '';
let _lastOwnerPollAt = 0;
let _httpServerRestartTimer = null;
let _httpServerWatchdog = null;
let _portRegistryHeartbeat = null;
let _httpServerIntentionalClose = false;
let _httpServerRestartAttempts = 0;
let _httpPortFile = '';
let _portsListFile = '';
let _lastPortRegistryWriteAt = 0;
const _processedStatsBatches = new Map(); // Renderer ID -> highest acknowledged sequence (host lifetime).
const HTTP_SERVER_WATCHDOG_MS = 5000;
const PORT_REGISTRY_HEARTBEAT_MS = 10000;
const PORT_REGISTRY_STALE_MS = 120000;

const IPC_SERVICE_NAME = 'ag-auto-click-scroll';
const IPC_PROTOCOL_VERSION = 3;
let _httpServerStarting = false;
let _lastListenPort = AG_HTTP_PORT_START;
const _serverSockets = new Map();
let _nativeWatcherDispose = null;
let _httpHealthProbe = null;
let _httpHealthFailures = 0;
let _ipcOutput = null;
let _ipcDiagnosticAt = 0;
function logIpcDiagnostic(event, force = false) {
    const now = Date.now();
    if (!_ipcOutput || (!force && now - _ipcDiagnosticAt < 30000)) return;
    _ipcDiagnosticAt = now;
    const age = time => time ? Math.max(0, now - time) : -1;
    _ipcOutput.appendLine(new Date().toISOString() + ' ' + event +
        ' port=' + _actualPort + ' generation=' + _serverGeneration +
        ' ownerPaired=' + !!_serverOwnerWindowKey + ' pollAgeMs=' + age(_lastOwnerPollAt) +
        ' heartbeatAgeMs=' + age(_lastRendererRuntimeStateAt) + ' restartAttempts=' + _httpServerRestartAttempts);
}
let _runtimeHealth = {
    acceptDegraded: false,
    scrollDegraded: false,
    phase: 'starting',
    reason: 'startup',
    detail: 'Waiting for the injected renderer to connect.',
    source: '',
    updatedAt: 0
};
let _lastRendererRuntimeStateAt = 0;
let _lastRendererInstanceId = '';
let _rendererSupervisor = null;
let _rendererSupervisorTickRunning = false;
let _rendererSupervisorMisses = 0;
let _extensionActivatedAt = 0;
let _windowFocusedAt = 0;
let _windowFocused = true;
let _scriptRepairPromise = null;
let _reloadRequired = null;
let _reloadNotificationPromise = null;
let _reloadWarningTimer = null;
let _reloadWarningNotBefore = 0;
let _reloadStateWritePromise = Promise.resolve();
let _reloadVerification = { healthyCount: 0, lastHeartbeatAt: 0, rendererInstanceId: '' };
const RENDERER_SUPERVISOR_MS = 10000;
const STARTUP_RELOAD_WARNING_GRACE_MS = DEFAULT_RECOVERY_POLICY.startupGraceMs;
const RECOVERY_JOURNAL_KEY = 'ag-auto-renderer-recovery-v1';
const RELOAD_REQUIRED_STATE_KEY = 'ag-auto-reload-required-v1';

function readRequestBody(req, res, maxBytes, onBody) {
    let body = '';
    let rejected = false;
    req.on('data', chunk => {
        if (rejected) return;
        body += chunk;
        if (body.length > maxBytes) {
            rejected = true;
            res.writeHead(413);
            res.end(JSON.stringify({ error: 'Payload too large' }));
            req.destroy();
        }
    });
    req.on('end', () => {
        if (rejected) return;
        rejected = true;
        onBody(body);
    });
    req.on('aborted', () => { rejected = true; });
    req.on('error', (e) => {
        if (!rejected) {
            rejected = true;
            res.writeHead(400);
            res.end(JSON.stringify({ error: e.message }));
        }
    });
}

function setRuntimeHealth(next = {}) {
    const acceptDegraded = !!next.acceptDegraded;
    const scrollDegraded = !!next.scrollDegraded;
    const phase = next.phase ? String(next.phase) : '';
    const reason = next.reason ? String(next.reason) : '';
    const detail = next.detail ? String(next.detail) : '';
    const source = next.source ? String(next.source) : '';
    const changed = _runtimeHealth.acceptDegraded !== acceptDegraded ||
        _runtimeHealth.scrollDegraded !== scrollDegraded ||
        _runtimeHealth.phase !== phase ||
        _runtimeHealth.reason !== reason ||
        _runtimeHealth.detail !== detail ||
        _runtimeHealth.source !== source;

    _runtimeHealth = {
        acceptDegraded,
        scrollDegraded,
        phase,
        reason,
        detail,
        source,
        updatedAt: Date.now()
    };

    if (changed) {
        const label = (phase || reason || 'healthy').toUpperCase();
        console.log('[AG Auto] Runtime health → ' + label + ' | acceptDegraded=' + acceptDegraded + ' | scrollDegraded=' + scrollDegraded + (detail ? ' | detail=' + detail : ''));
    }

    // Runtime recovery remains fully active, but its technical phases are internal.
    // The status bar is rendered only when the user's Accept/Scroll preference changes.
}

function markRuntimeHealthy(source) {
    setRuntimeHealth({ acceptDegraded: false, scrollDegraded: false, phase: 'healthy', reason: '', detail: '', source: source || 'extension' });
}

function normalizeReloadRequiredState(value) {
    if (!value || typeof value !== 'object') return null;
    const requiredAt = Number(value.requiredAt) || 0;
    if (requiredAt <= 0) return null;
    return {
        requiredAt,
        reason: value.reason ? String(value.reason) : 'script-repair',
        previousRendererInstanceId: value.previousRendererInstanceId ? String(value.previousRendererInstanceId) : ''
    };
}

function getReloadRequiredStore(context) {
    // workspaceState follows this project window across Reload Window without
    // allowing one healthy project to clear another project's pending warning.
    return context.workspaceState || context.globalState;
}

function queueReloadRequiredStateUpdate(context, value) {
    const store = getReloadRequiredStore(context);
    const snapshot = value ? { ...value } : null;
    const queuedWrite = _reloadStateWritePromise
        .catch(() => undefined)
        .then(() => store.update(RELOAD_REQUIRED_STATE_KEY, snapshot));
    _reloadStateWritePromise = queuedWrite.catch(error => {
        console.error('[AG Auto] Could not persist reload-required state:', error.message);
    });
    return queuedWrite;
}

function updateReloadRequiredWarning() {
    if (!reloadRequiredStatusBar) return;
    if (!_reloadRequired || Date.now() < _reloadWarningNotBefore) {
        reloadRequiredStatusBar.hide();
        return;
    }
    reloadRequiredStatusBar.text = '$(warning) Auto Accept cần Reload';
    reloadRequiredStatusBar.tooltip = 'Auto Accept đang chờ reload để kích hoạt script đã sửa. Click để Reload Antigravity ngay.';
    reloadRequiredStatusBar.color = '#FFFFFF';
    reloadRequiredStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    reloadRequiredStatusBar.show();
}

function clearReloadWarningTimer() {
    if (_reloadWarningTimer) clearTimeout(_reloadWarningTimer);
    _reloadWarningTimer = null;
}

function resetReloadVerification() {
    _reloadVerification = { healthyCount: 0, lastHeartbeatAt: 0, rendererInstanceId: '' };
}

function clearReloadRequiredAfterVerification(reason) {
    if (!_reloadRequired) return false;
    const activeContext = _extensionContext;
    const confirmations = _reloadVerification.healthyCount;
    _reloadRequired = null;
    resetReloadVerification();
    clearReloadWarningTimer();
    _reloadWarningNotBefore = 0;
    _reloadNotificationPromise = null;
    updateReloadRequiredWarning();

    if (activeContext) {
        const journal = normalizeRecoveryJournal(activeContext.globalState.get(RECOVERY_JOURNAL_KEY, {}));
        if (journal.pending) {
            Promise.resolve(activeContext.globalState.update(RECOVERY_JOURNAL_KEY, acknowledgeHealthyRenderer(journal))).catch(error => {
                console.error('[AG Auto] Could not acknowledge stable renderer recovery:', error.message);
            });
        }
        queueReloadRequiredStateUpdate(activeContext, null).catch(() => undefined);
    }

    console.log('[AG Auto] ✅ Reload warning cleared after ' + confirmations + ' healthy confirmations' + (reason ? ' (' + reason + ')' : '') + '.');
    return true;
}

function scheduleReloadRequiredWarning(context) {
    clearReloadWarningTimer();
    if (!_reloadRequired) {
        _reloadWarningNotBefore = 0;
        updateReloadRequiredWarning();
        return;
    }

    const remainingMs = Math.max(0, _reloadWarningNotBefore - Date.now());
    if (remainingMs > 0) {
        updateReloadRequiredWarning();
        _reloadWarningTimer = setTimeout(() => {
            _reloadWarningTimer = null;
            if (!_reloadRequired) return;
            _reloadWarningNotBefore = 0;
            updateReloadRequiredWarning();
            showReloadRequiredNotification(context);
        }, remainingMs);
        return;
    }

    _reloadWarningNotBefore = 0;
    updateReloadRequiredWarning();
    showReloadRequiredNotification(context);
}

async function executeRecoveryReload(context) {
    const activeContext = context || _extensionContext;
    if (!_reloadRequired || !activeContext) return false;
    try {
        // Flush again here to close the race where the user clicks Reload ngay
        // before the non-blocking initial persistence write has settled.
        await queueReloadRequiredStateUpdate(activeContext, _reloadRequired);
        await suppressSettingsRestoreForNextStartup(activeContext);
        await closeUnexpectedSettingsTabs({ force: true });
        console.log('[AG Auto] User confirmed recovery reload; reloading Antigravity now.');
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
        return true;
    } catch (error) {
        console.error('[AG Auto] User-confirmed reload failed:', error.message);
        vscode.window.showErrorMessage('[AG Auto] Không thể reload Antigravity. Cảnh báo sẽ được giữ lại để bạn thử lại.');
        return false;
    }
}

function showReloadRequiredNotification(context) {
    if (!_reloadRequired) return Promise.resolve(false);
    if (Date.now() < _reloadWarningNotBefore) {
        scheduleReloadRequiredWarning(context);
        return Promise.resolve(false);
    }
    if (_reloadNotificationPromise) return _reloadNotificationPromise;

    const requiredAt = _reloadRequired.requiredAt;
    const notification = vscode.window.showWarningMessage(
        '[AG Auto] Chưa xác minh được script hoạt động ổn định sau khi tự sửa/inject. Hãy reload Antigravity để nạp lại script; extension sẽ vẫn tiếp tục kiểm tra và không tự reload làm gián đoạn công việc của bạn.',
        'Reload ngay'
    );
    _reloadNotificationPromise = Promise.resolve(notification)
        .then(choice => {
            if (choice === 'Reload ngay' && _reloadRequired && _reloadRequired.requiredAt === requiredAt) {
                return executeRecoveryReload(context);
            }
            return false;
        })
        .catch(error => {
            console.error('[AG Auto] Reload-required notification failed:', error.message);
            return false;
        })
        .finally(() => {
            if (_reloadNotificationPromise === notificationPromise) _reloadNotificationPromise = null;
        });
    const notificationPromise = _reloadNotificationPromise;
    return notificationPromise;
}

function setReloadRequired(context, reason, options = {}) {
    if (!_reloadRequired) {
        _reloadRequired = {
            requiredAt: Date.now(),
            reason: reason || 'script-repair',
            previousRendererInstanceId: _lastRendererInstanceId || ''
        };
        resetReloadVerification();
        queueReloadRequiredStateUpdate(context, _reloadRequired).catch(() => undefined);
    }

    if (options.reveal === false) {
        clearReloadWarningTimer();
        _reloadWarningNotBefore = 0;
        return;
    }

    const deferWarningMs = Math.max(0, Number(options.deferWarningMs) || 0);
    if (deferWarningMs > 0) {
        _reloadWarningNotBefore = Math.max(_reloadWarningNotBefore, Date.now() + deferWarningMs);
    }
    scheduleReloadRequiredWarning(context);
}

function markRendererHeartbeat(data) {
    const receivedAt = Date.now();
    _lastRendererRuntimeStateAt = receivedAt;
    _rendererSupervisorMisses = 0;
    const rendererInstanceId = data && data.rendererInstanceId ? String(data.rendererInstanceId) : '';
    if (rendererInstanceId) _lastRendererInstanceId = rendererInstanceId;

    if (!_extensionContext) return;
    if (!_reloadRequired) {
        resetReloadVerification();
        return;
    }

    const verification = evaluateReloadVerification(_reloadVerification, {
        now: receivedAt,
        heartbeatAt: Number(data && data.sentAt) || 0,
        requiredAt: _reloadRequired.requiredAt,
        ownerPollAt: _lastOwnerPollAt,
        runtimeHeartbeatAt: _lastRendererRuntimeStateAt,
        rendererInstanceId,
        acceptDegraded: !!(data && data.acceptDegraded),
        scrollDegraded: !!(data && data.scrollDegraded),
        expectedAcceptEnabled: _autoAcceptEnabled,
        expectedScrollEnabled: _httpScrollEnabled,
        actualAcceptEnabled: data && data.actualAcceptEnabled,
        actualScrollEnabled: data && data.actualScrollEnabled
    }, DEFAULT_RECOVERY_POLICY);
    _reloadVerification = verification.state;

    if (verification.accepted) {
        console.log('[AG Auto] Healthy reload verification ' + _reloadVerification.healthyCount + '/' + DEFAULT_RECOVERY_POLICY.reloadHealthyConfirmations + ' from ' + rendererInstanceId + '.');
    } else if (verification.reset) {
        console.log('[AG Auto] Reload verification reset: ' + verification.reason + '.');
    }

    if (verification.confirmed) {
        clearReloadRequiredAfterVerification(verification.reason);
    }
}

function atomicWriteJson(filePath, value) {
    if (!filePath) return false;
    const tempPath = filePath + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    try {
        fs.writeFileSync(tempPath, JSON.stringify(value), 'utf8');
        fs.renameSync(tempPath, filePath);
        return true;
    } catch (error) {
        try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch (_) { }
        try {
            fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
            console.log('[AG Auto] Atomic sidecar rename unavailable; used direct fallback for', path.basename(filePath));
            return true;
        } catch (fallbackError) {
            console.log('[AG Auto] Could not write sidecar ' + path.basename(filePath) + ':', fallbackError.message);
            return false;
        }
    }
}

function readPortRegistry() {
    if (!_portsListFile) return [];
    try {
        const parsed = JSON.parse(fs.readFileSync(_portsListFile, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
        return [];
    }
}

function initializePortSidecarPaths() {
    if (_httpPortFile && _portsListFile) return true;
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return false;
        const wbDir = path.dirname(wbPath);
        _httpPortFile = path.join(wbDir, 'ag-auto-port-' + process.pid + '.txt');
        _portsListFile = path.join(wbDir, 'ag-auto-ports.json');
        return true;
    } catch (error) {
        console.log('[AG Auto] Could not initialize port sidecar paths:', error.message);
        return false;
    }
}

function updatePortRegistry(force = false) {
    if (!_actualPort || !initializePortSidecarPaths()) return;
    const now = Date.now();
    if (!force && now - _lastPortRegistryWriteAt < PORT_REGISTRY_HEARTBEAT_MS - 500) return;
    _lastPortRegistryWriteAt = now;
    try {
        fs.writeFileSync(_httpPortFile, String(_actualPort), 'utf8');
        const entries = readPortRegistry().filter(entry => {
            if (!entry || Number(entry.port) < AG_HTTP_PORT_START || Number(entry.port) > AG_HTTP_PORT_END) return false;
            if (Number(entry.pid) === process.pid) return false;
            const heartbeatAt = Number(entry.heartbeatAt || entry.time || 0);
            return heartbeatAt > 0 && now - heartbeatAt < PORT_REGISTRY_STALE_MS;
        });
        entries.push({
            service: IPC_SERVICE_NAME,
            protocolVersion: IPC_PROTOCOL_VERSION,
            pid: process.pid,
            port: _actualPort,
            startedAt: _serverStartedAt,
            generation: _serverGeneration,
            heartbeatAt: now,
            time: _serverStartedAt
        });
        atomicWriteJson(_portsListFile, entries);
    } catch (error) {
        console.log('[AG Auto] Could not update port registry:', error.message);
    }
}

function cleanupPortSidecars() {
    initializePortSidecarPaths();
    try { if (_httpPortFile && fs.existsSync(_httpPortFile)) fs.unlinkSync(_httpPortFile); } catch (_) { }
    if (_portsListFile) {
        try {
            const entries = readPortRegistry().filter(entry => Number(entry.pid) !== process.pid);
            atomicWriteJson(_portsListFile, entries);
        } catch (_) { }
    }
}

function acceptStatsBatch(rendererId, sequence) {
    const previous = _processedStatsBatches.get(rendererId) || 0;
    if (sequence <= previous) return false;
    _processedStatsBatches.set(rendererId, sequence);
    return true;
}

function rendererIdentityMatches(data) {
    if (!data || !_serverOwnerWindowKey || data.windowKey !== _serverOwnerWindowKey) return false;
    if (!data.serverGeneration || String(data.serverGeneration) !== String(_serverGeneration)) return false;
    if (!data.serverStartedAt || Number(data.serverStartedAt) !== Number(_serverStartedAt)) return false;
    return _ipcIdentity.matches(data, _serverGeneration);
}

function scheduleHttpServerRestart(reason) {
    if (_httpServerIntentionalClose || _httpServerRestartTimer) return;
    const delays = [1000, 2000, 5000, 10000, 30000];
    const delay = delays[Math.min(_httpServerRestartAttempts, delays.length - 1)];
    _httpServerRestartAttempts++;
    logIpcDiagnostic('server-retry-scheduled');
    console.log('[AG Auto] Scheduling HTTP server restart in ' + delay + 'ms (' + reason + ')');
    _httpServerRestartTimer = setTimeout(() => {
        _httpServerRestartTimer = null;
        startHttpServer();
    }, delay);
}

function handleUnexpectedHttpServerStop(server, reason) {
    if (server !== _httpServer || _httpServerIntentionalClose) return;
    console.log('[AG Auto] HTTP server stopped unexpectedly:', reason);
    if (_serverOwnerWindowKey) _serverPreferredWindowKey = _serverOwnerWindowKey;
    _actualPort = 0;
    _serverOwnerWindowKey = '';
    _lastOwnerPollAt = 0;
    cleanupPortSidecars();
    _httpServerStarting = false;
    if (_httpHealthProbe) _httpHealthProbe.cancel();
    _httpHealthFailures = 0;
    for (const socket of _serverSockets.get(server) || []) socket.destroy();
    _serverSockets.delete(server);
    try { server.removeAllListeners(); } catch (_) { }
    try { server.close(); } catch (_) { }
    _httpServer = null;
    scheduleHttpServerRestart(reason);
}

function probeHttpServerHealth() {
    if (_httpHealthProbe || !_httpServer || !_httpServer.listening || !_actualPort) return;
    const server = _httpServer;
    const generation = _serverGeneration;
    const started = Date.now();
    let request;
    let timer;
    let settled = false;
    const probe = { cancel: () => finish(false, true) };
    _httpHealthProbe = probe;
    function finish(ok, cancelled = false) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (request) request.destroy();
        if (_httpHealthProbe === probe) _httpHealthProbe = null;
        if (cancelled || server !== _httpServer || generation !== _serverGeneration) return;
        // Sleep/event-loop blockage is not evidence that the listener is broken.
        const elapsed = Date.now() - started;
        if (elapsed < 0 || elapsed > 5000) { _httpHealthFailures = 0; return; }
        if (ok) { _httpHealthFailures = 0; _httpServerRestartAttempts = 0; }
        else if (++_httpHealthFailures >= 3) handleUnexpectedHttpServerStop(server, 'HTTP health probe failed three times');
    }
    timer = setTimeout(() => finish(false), 2000);
    try {
        request = http.get({ hostname: '127.0.0.1', port: _actualPort,
            path: '/ag-status?probe=1&windowKey=host-watchdog', agent: false }, response => {
            let body = '';
            response.on('data', chunk => {
                body += chunk;
                if (body.length > 4096) finish(false);
            });
            response.on('error', () => finish(false));
            response.on('end', () => {
                let data;
                try { data = JSON.parse(body); } catch (_) { finish(false); return; }
                finish(response.statusCode === 200 && !!data && data.hostId === _ipcIdentity.hostId && data.serverGeneration === generation);
            });
        });
        request.on('error', () => finish(false));
    } catch (_) { finish(false); }
}

function ensureHttpServerWatchdog() {
    if (!_httpServerWatchdog) {
        _httpServerWatchdog = setInterval(() => {
            if (_httpServerIntentionalClose) return;
            if (!_httpServerStarting && (!_httpServer || !_httpServer.listening || _actualPort <= 0)) {
                if (_httpServer) {
                    handleUnexpectedHttpServerStop(_httpServer, 'watchdog detected non-listening server');
                } else {
                    _actualPort = 0;
                    scheduleHttpServerRestart('watchdog detected missing server');
                }
            } else if (!_httpServerStarting) {
                probeHttpServerHealth();
            }
        }, HTTP_SERVER_WATCHDOG_MS);
    }
    if (!_portRegistryHeartbeat) {
        _portRegistryHeartbeat = setInterval(() => updatePortRegistry(false), PORT_REGISTRY_HEARTBEAT_MS);
    }
}

function applySupervisorDecision(decision) {
    if (!decision) return;
    if (decision.phase === 'idle') {
        _rendererSupervisorMisses = 0;
        markRuntimeHealthy('supervisor-idle');
        return;
    }
    if (decision.phase === 'background') {
        _rendererSupervisorMisses = 0;
        return;
    }
    if (decision.phase === 'healthy') {
        _rendererSupervisorMisses = 0;
        markRuntimeHealthy('supervisor');
        return;
    }
    if (decision.phase === 'blocked') {
        setRuntimeHealth({
            acceptDegraded: _autoAcceptEnabled,
            scrollDegraded: _httpScrollEnabled,
            phase: 'blocked',
            reason: decision.reason,
            detail: decision.detail,
            source: 'renderer-supervisor'
        });
        return;
    }
    setRuntimeHealth({
        acceptDegraded: false,
        scrollDegraded: false,
        phase: decision.phase === 'repairing' ? 'repairing' : 'connecting',
        reason: decision.reason,
        detail: decision.detail,
        source: 'renderer-supervisor'
    });
}

async function performScriptRepair(context, options = {}) {
    if (_scriptRepairPromise) return _scriptRepairPromise;
    if (_reloadRequired) {
        updateReloadRequiredWarning();
        showReloadRequiredNotification(context);
        return true;
    }

    const mode = options.mode || 'manual';
    const automatic = mode === 'auto';
    const revealReloadWarning = options.revealReloadWarning !== false;
    const reason = options.reason || (automatic ? 'renderer-heartbeat-lost' : 'manual-enable');

    _scriptRepairPromise = (async () => {
        let journal = normalizeRecoveryJournal(context.globalState.get(RECOVERY_JOURNAL_KEY, {}));
        try {
            if (automatic) {
                if (!_windowFocused || !(_autoAcceptEnabled || _httpScrollEnabled)) return false;
                journal = recordRepairAttempt(journal, {
                    at: Date.now(),
                    identity: _lastRendererInstanceId || ('host:' + (context.extension?.packageJSON?.version || '0') + ':' + getWorkbenchInstallFingerprint()),
                    ownerKey: _serverOwnerWindowKey || _serverPreferredWindowKey || '',
                    reason
                });
                await context.globalState.update(RECOVERY_JOURNAL_KEY, journal);
                if (!_windowFocused || !(_autoAcceptEnabled || _httpScrollEnabled)) {
                    throw new Error('Auto repair cancelled because the window lost focus or automation was turned off.');
                }
            }

            setRuntimeHealth({
                acceptDegraded: false,
                scrollDegraded: false,
                phase: 'repairing',
                reason,
                detail: automatic ? 'Repairing renderer injection once; waiting for user-confirmed reload.' : 'Injecting renderer script by explicit request.',
                source: mode + '-repair'
            });

            const installOk = installScript(context);
            if (!installOk || !isScriptInjected()) {
                throw new Error('Injection verification failed after writing workbench files.');
            }

            clearV8CodeCache();
            updateProductChecksums();
            await context.globalState.update('ag-injected-version', context.extension?.packageJSON?.version || '0');
            setRuntimeHealth({
                acceptDegraded: _autoAcceptEnabled,
                scrollDegraded: _httpScrollEnabled,
                phase: 'blocked',
                reason: 'reload-required',
                detail: 'Script repair completed. Waiting for the user to reload Antigravity.',
                source: mode + '-repair'
            });
            setReloadRequired(context, reason, {
                reveal: revealReloadWarning,
                deferWarningMs: automatic ? STARTUP_RELOAD_WARNING_GRACE_MS : 0
            });
            return true;
        } catch (error) {
            console.error('[AG Auto] ' + mode + ' repair failed:', error.message);
            if (automatic) {
                journal = recordRepairFailure(journal, { at: Date.now(), message: error.message });
                await context.globalState.update(RECOVERY_JOURNAL_KEY, journal);
                setRuntimeHealth({
                    acceptDegraded: _autoAcceptEnabled,
                    scrollDegraded: _httpScrollEnabled,
                    phase: 'blocked',
                    reason: 'auto-repair-failed',
                    detail: error.message + ' Automatic retry is cooldown-limited.',
                    source: 'renderer-supervisor'
                });
                vscode.window.showWarningMessage(
                    '[AG Auto] Tự repair inject thất bại và đã khóa repair tự động để tránh loop.',
                    'Run Enable Now'
                ).then(choice => {
                    if (choice === 'Run Enable Now') vscode.commands.executeCommand('ag-auto.enable');
                });
            } else {
                setRuntimeHealth({
                    acceptDegraded: _autoAcceptEnabled,
                    scrollDegraded: _httpScrollEnabled,
                    phase: 'blocked',
                    reason: 'manual-repair-failed',
                    detail: error.message,
                    source: 'manual-repair'
                });
            }
            return false;
        } finally {
            _scriptRepairPromise = null;
        }
    })();

    return _scriptRepairPromise;
}

async function runRendererSupervisor(context) {
    if (_rendererSupervisorTickRunning || _scriptRepairPromise) return;
    _rendererSupervisorTickRunning = true;
    try {
        const now = Date.now();
        const journal = context.globalState.get(RECOVERY_JOURNAL_KEY, {});
        const decision = evaluateRecovery({
            now,
            automationEnabled: _autoAcceptEnabled || _httpScrollEnabled,
            windowFocused: _windowFocused,
            activatedAt: _extensionActivatedAt,
            focusedAt: _windowFocusedAt,
            serverHealthy: !!(_httpServer && _httpServer.listening && _actualPort > 0),
            ownerPollAt: _lastOwnerPollAt,
            runtimeHeartbeatAt: _lastRendererRuntimeStateAt,
            consecutiveMisses: _rendererSupervisorMisses,
            injectionValid: true,
            journal
        }, DEFAULT_RECOVERY_POLICY);
        _rendererSupervisorMisses = decision.nextMisses;

        if (decision.shouldRepair) {
            if (!isScriptInjected()) {
                decision.reason = 'injection-missing';
                decision.detail = 'Injection marker or renderer script is missing after repeated stale-heartbeat confirmation.';
            } else {
                decision.shouldRepair = false;
                decision.phase = 'connecting';
                decision.reason = _serverOwnerWindowKey ? 'renderer-reconnecting' : 'pairing-pending';
                decision.detail = 'Injection is intact. IPC recovery continues without reinjection or reload.';
            }
        }

        logIpcDiagnostic('supervisor-' + decision.phase);
        applySupervisorDecision(decision);
        if (decision.shouldRepair) {
            await performScriptRepair(context, { mode: 'auto', reason: decision.reason });
        }
    } finally {
        _rendererSupervisorTickRunning = false;
    }
}

function ensureRendererSupervisor(context) {
    if (_rendererSupervisor) return;
    const now = Date.now();
    _extensionActivatedAt = now;
    _windowFocused = !vscode.window.state || vscode.window.state.focused !== false;
    _windowFocusedAt = now;

    if (typeof vscode.window.onDidChangeWindowState === 'function') {
        context.subscriptions.push(vscode.window.onDidChangeWindowState(state => {
            const wasFocused = _windowFocused;
            _windowFocused = state.focused !== false;
            _rendererSupervisorMisses = 0;
            if (_windowFocused && !wasFocused) {
                // Keep the last verified runtime status stable. focusedAt still gives
                // the recovery policy a full grace window before any repair decision.
                _windowFocusedAt = Date.now();
                if (_reloadRequired) showReloadRequiredNotification(context);
            }
        }));
    }

    _rendererSupervisor = setInterval(() => {
        runRendererSupervisor(context).catch(error => {
            console.error('[AG Auto] Renderer supervisor tick failed:', error.message);
        });
    }, RENDERER_SUPERVISOR_MS);
    context.subscriptions.push({ dispose: () => {
        if (_rendererSupervisor) clearInterval(_rendererSupervisor);
        _rendererSupervisor = null;
    } });
}


function startHttpServer() {
    if (_httpServerStarting || (_httpServer && _httpServer.listening && _actualPort > 0)) return;
    _httpServerStarting = true;
    ensureHttpServerWatchdog();
    _httpServerIntentionalClose = false;

    if (_httpServer) {
        console.log('[AG Auto] Resetting stale HTTP server object before restart');
        if (_httpHealthProbe) _httpHealthProbe.cancel();
        for (const socket of _serverSockets.get(_httpServer) || []) socket.destroy();
        _serverSockets.delete(_httpServer);
        try { _httpServer.removeAllListeners(); } catch (_) { }
        try { _httpServer.close(); } catch (_) { }
        _httpServer = null;
        _actualPort = 0;
    }

    // Initialize defaults only once for this window runtime
    if (!_httpDefaultsInitialized) {
        _httpDefaultsInitialized = true;
        const cfg = vscode.workspace.getConfiguration('ag-auto');
        const patternState = resolveClickPatternState(
            _extensionContext,
            cfg.get('clickPatterns', ['Allow', 'Always Allow', 'Run', 'Submit', 'Keep Waiting', 'Accept']),
            { mergeDefaults: true }
        );
        _httpClickPatterns = patternState.activePatterns;
        _httpScrollEnabled = _extensionContext ? _extensionContext.globalState.get('scrollEnabledPreference', cfg.get('scrollEnabled', true)) : cfg.get('scrollEnabled', true);
        _httpScrollConfig = {
            pauseScrollMs: cfg.get('scrollPauseMs', 5000),
            scrollIntervalMs: cfg.get('scrollIntervalMs', 500),
            clickIntervalMs: cfg.get('clickIntervalMs', 2000)
        };
        _autoAcceptEnabled = _extensionContext ? _extensionContext.globalState.get('startupEnabledPreference', true) : true;
    }

    _serverStartedAt = Date.now();
    _serverGeneration = process.pid + '-' + _serverStartedAt + '-' + crypto.randomBytes(4).toString('hex');
    _serverOwnerWindowKey = '';
    _lastOwnerPollAt = 0;
    _lastPortRegistryWriteAt = 0;

    try {
        const { URL } = require('url');
        const generation = _serverGeneration;
        const server = http.createServer((req, res) => {
            res.setHeader('Cache-Control', 'no-store');
            if (server !== _httpServer || generation !== _serverGeneration) {
                res.writeHead(503); res.end(); return;
            }
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AG-Session');
            res.setHeader('Content-Type', 'application/json');

            if (req.method === 'OPTIONS') {
                res.writeHead(204);
                res.end();
                return;
            }

            let parsed;
            try {
                const requestUrl = new URL(req.url, 'http://127.0.0.1');
                parsed = { pathname: requestUrl.pathname, query: Object.fromEntries(requestUrl.searchParams) };
            } catch (_) { res.writeHead(400); res.end(JSON.stringify({ error: 'invalid-url' })); return; }
            const requestWindowKey = parsed.query && typeof parsed.query.windowKey === 'string' ? String(parsed.query.windowKey) : '';
            const isProbe = parsed.query && parsed.query.probe === '1';

            if (parsed.pathname === '/ag-status') {
                if (!requestWindowKey) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ service: IPC_SERVICE_NAME, protocolVersion: IPC_PROTOCOL_VERSION, error: 'windowKey-required' }));
                    return;
                }

                if (isProbe && req.method === 'GET') {
                    res.writeHead(200);
                    res.end(JSON.stringify({ service: IPC_SERVICE_NAME, protocolVersion: IPC_PROTOCOL_VERSION,
                        hostId: _ipcIdentity.hostId, serverGeneration: generation, serverStartedAt: _serverStartedAt }));
                    return;
                }
                const identity = { ...parsed.query, sessionToken: req.headers['x-ag-session'] };
                if (req.method !== 'GET' || !rendererIdentityMatches(identity)) {
                    res.writeHead(409);
                    res.end(JSON.stringify({ bindRejected: true, rejectReason: 'session-mismatch' }));
                    return;
                }
                _lastOwnerPollAt = Date.now();

                if (parsed.query && parsed.query.stats && !isProbe && _serverOwnerWindowKey === requestWindowKey) {
                    const statsBatchId = parsed.query.statsBatchId ? String(parsed.query.statsBatchId) : '';
                    try {
                        const incoming = typeof parsed.query.stats === 'string'
                            ? JSON.parse(parsed.query.stats)
                            : {};
                        const sequence = Number(parsed.query.statsSeq);
                        if (!statsBatchId || statsBatchId.length > 240 || !Number.isSafeInteger(sequence) || sequence <= 0 ||
                            !incoming || Array.isArray(incoming) || typeof incoming !== 'object' ||
                            Object.entries(incoming).some(([key, value]) => !key || key.length > 120 ||
                                ['__proto__', 'constructor', 'prototype'].includes(key) || !Number.isSafeInteger(value) || value < 0)) {
                            throw new Error('Invalid stats batch');
                        }
                        if (acceptStatsBatch(identity.rendererInstanceId, sequence)) {
                            for (const key in incoming) {
                                if (!_clickStats[key]) _clickStats[key] = 0;
                                _clickStats[key] += Number(incoming[key]) || 0;
                            }
                            _totalClicks = Object.values(_clickStats).reduce((total, count) => total + (Number(count) || 0), 0);
                            if (_extensionContext) {
                                _extensionContext.globalState.update('clickStats', _clickStats);
                                _extensionContext.globalState.update('totalClicks', _totalClicks);
                            }
                        }
                    } catch (error) {
                        console.log('[AG Auto] Stats batch parse failed:', error.message);
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: 'invalid-stats-batch' }));
                        return;
                    }
                }

                const safePatterns = _httpClickPatterns.filter(pattern => pattern !== 'Accept');
                const acceptEnabled = _httpClickPatterns.includes('Accept');
                const response = {
                    service: IPC_SERVICE_NAME,
                    protocolVersion: IPC_PROTOCOL_VERSION,
                    enabled: _autoAcceptEnabled,
                    scrollEnabled: _httpScrollEnabled,
                    clickPatterns: safePatterns,
                    acceptInChatOnly: acceptEnabled,
                    pauseScrollMs: _httpScrollConfig.pauseScrollMs,
                    scrollIntervalMs: _httpScrollConfig.scrollIntervalMs,
                    clickIntervalMs: _httpScrollConfig.clickIntervalMs,
                    clickStats: _clickStats,
                    totalClicks: _totalClicks,
                    clickLimits: _extensionContext ? _extensionContext.globalState.get('clickLimits', {}) : {},
                    hostId: _ipcIdentity.hostId,
                    rendererInstanceId: _lastRendererInstanceId,
                    statsBatchId: parsed.query.statsBatchId || '',
                    ownerKey: _serverOwnerWindowKey || null,
                    serverStartedAt: _serverStartedAt,
                    serverGeneration: _serverGeneration,
                    serverPid: process.pid,
                    serverPort: _actualPort,
                    runtimeHealth: _runtimeHealth
                };
                if (_resetStatsRequested && !isProbe && _serverOwnerWindowKey === requestWindowKey) {
                    response.resetStats = true;
                    _resetStatsRequested = false;
                }
                res.writeHead(200);
                res.end(JSON.stringify(response));
                return;
            }

            if (parsed.pathname === '/ag-pair' && req.method === 'POST') {
                readRequestBody(req, res, 4096, body => {
                    if (server !== _httpServer || generation !== _serverGeneration) {
                        res.writeHead(409); res.end(); return;
                    }
                    let data;
                    try { data = JSON.parse(body); } catch (_) { res.writeHead(400); res.end(); return; }
                    const session = _ipcIdentity.claim(data, generation);
                    if (!session) { res.writeHead(403); res.end(JSON.stringify({ error: 'pairing-rejected' })); return; }
                    if (_lastRendererInstanceId !== data.rendererInstanceId) {
                        _lastRendererRuntimeStateAt = 0;
                        resetReloadVerification();
                    }
                    _serverOwnerWindowKey = data.windowKey;
                    _lastRendererInstanceId = data.rendererInstanceId;
                    _serverPreferredWindowKey = data.windowKey;
                    logIpcDiagnostic('renderer-paired');
                    res.writeHead(200);
                    res.end(JSON.stringify({ ...session, hostId: _ipcIdentity.hostId, serverGeneration: generation,
                        serverStartedAt: _serverStartedAt, ownerKey: data.windowKey, rendererInstanceId: data.rendererInstanceId }));
                });
                return;
            }

            if (parsed.pathname === '/api/click-log' && req.method === 'POST') {
                readRequestBody(req, res, 16384, (body) => {
                    try {
                        const data = JSON.parse(body);
                        if (server !== _httpServer || generation !== _serverGeneration || !rendererIdentityMatches(data)) {
                            res.writeHead(409);
                            res.end(JSON.stringify({ error: 'owner-identity-mismatch' }));
                            return;
                        }
                        console.log('[AG Auto] Click-log received:', data.pattern, data.button);
                        const timestamp = (() => { const d = new Date(); const pad = n => n < 10 ? '0' + n : n; return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ' ' + pad(d.getDate()) + '/' + pad(d.getMonth() + 1); })();
                        const entry = { time: timestamp, pattern: data.pattern || 'click', button: (data.button || '').substring(0, 80) };
                        _clickLog.unshift(entry);
                        if (_clickLog.length > 200) _clickLog.pop();
                        if (_extensionContext) _extensionContext.globalState.update('clickLog', _clickLog);
                        if (_settingsPanel) _settingsPanel.webview.postMessage({ command: 'clickLogUpdate', log: _clickLog });
                        res.writeHead(200);
                        res.end(JSON.stringify({ logged: true }));
                    } catch (error) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: error.message }));
                    }
                });
                return;
            }

            if (parsed.pathname === '/api/runtime-state' && req.method === 'POST') {
                readRequestBody(req, res, 16384, (body) => {
                    try {
                        const data = JSON.parse(body || '{}');
                        if (server !== _httpServer || generation !== _serverGeneration || !rendererIdentityMatches(data)) {
                            res.writeHead(409);
                            res.end(JSON.stringify({ error: 'owner-identity-mismatch' }));
                            return;
                        }
                        markRendererHeartbeat(data);
                        setRuntimeHealth({
                            acceptDegraded: !!data.acceptDegraded,
                            scrollDegraded: !!data.scrollDegraded,
                            phase: (data.acceptDegraded || data.scrollDegraded) ? 'degraded' : 'healthy',
                            reason: data.reason || '',
                            detail: data.detail || '',
                            source: data.source || 'autoScript'
                        });
                        res.writeHead(200);
                        res.end(JSON.stringify({ ok: true, runtimeHealth: _runtimeHealth }));
                    } catch (error) {
                        res.writeHead(400);
                        res.end(JSON.stringify({ error: error.message }));
                    }
                });
                return;
            }

            res.writeHead(404);
            res.end(JSON.stringify({ error: 'not-found' }));
        });

        _httpServer = server;
        _serverSockets.set(server, new Set());
        server.on('connection', socket => {
            const sockets = _serverSockets.get(server);
            if (!sockets) { socket.destroy(); return; }
            sockets.add(socket);
            socket.on('close', () => sockets.delete(socket));
        });
        server.requestTimeout = 10000;
        server.headersTimeout = 10000;
        server.setTimeout(15000, socket => socket.destroy());
        server.on('close', () => handleUnexpectedHttpServerStop(server, 'close event'));

        const listenPorts = [_lastListenPort];
        for (let port = AG_HTTP_PORT_START; port <= AG_HTTP_PORT_END; port++) {
            if (port !== _lastListenPort) listenPorts.push(port);
        }
        function tryListenPort(index) {
            if (server !== _httpServer) return;
            const port = listenPorts[index];
            if (!port) {
                console.log('[AG Auto] No available port in range ' + AG_HTTP_PORT_START + '-' + AG_HTTP_PORT_END);
                try { server.removeAllListeners(); } catch (_) { }
                _httpServer = null;
                _httpServerStarting = false;
                _serverSockets.delete(server);
                _actualPort = 0;
                scheduleHttpServerRestart('all IPC ports busy');
                return;
            }

            const onListenError = error => {
                if (server !== _httpServer || _httpServerIntentionalClose) return;
                server.removeListener('listening', onListening);
                if (error.code === 'EADDRINUSE') {
                    console.log('[AG Auto] Port ' + port + ' busy, trying ' + (port + 1) + '...');
                    setImmediate(() => tryListenPort(index + 1));
                    return;
                }
                handleUnexpectedHttpServerStop(server, 'listen error: ' + error.message);
            };
            const onListening = () => {
                if (server !== _httpServer || _httpServerIntentionalClose) {
                    try { server.close(); } catch (_) { }
                    return;
                }
                server.removeListener('error', onListenError);
                const address = server.address();
                _actualPort = address && typeof address === 'object' ? Number(address.port) : Number(port);
                _httpServerStarting = false;
                _lastListenPort = _actualPort;
                _httpHealthFailures = 0;
                logIpcDiagnostic('server-listening');
                console.log('[AG Auto] ✅ HTTP server started on port ' + _actualPort + ' generation=' + _serverGeneration);
                updatePortRegistry(true);
                server.on('error', error => handleUnexpectedHttpServerStop(server, 'runtime error: ' + error.message));
            };
            server.once('error', onListenError);
            server.once('listening', onListening);
            try { server.listen(port, '127.0.0.1'); }
            catch (error) { handleUnexpectedHttpServerStop(server, 'listen exception: ' + error.message); }
        }

        tryListenPort(0);
    } catch (error) {
        _httpServerStarting = false;
        console.log('[AG Auto] HTTP server failed:', error.message);
        if (_httpServer) {
            handleUnexpectedHttpServerStop(_httpServer, 'start exception: ' + error.message);
            return;
        }
        _actualPort = 0;
        scheduleHttpServerRestart('start exception: ' + error.message);
    }
}

// Keep Commands API as bonus (silent accept in background)
// ONLY chat-safe commands — NEVER editor diff commands
let _autoAcceptInterval = null;
const CHAT_ACCEPT_COMMANDS = [
    'antigravity.agent.acceptAgentStep',        // Chat panel: accept agent step ✅
    'antigravity.prioritized.supercompleteAccept', // Autocomplete accept ✅
    'antigravity.terminalCommand.accept',        // Terminal command accept ✅
    'antigravity.acceptCompletion'               // Code completion accept ✅
    // REMOVED: 'antigravity.command.accept'                    — too generic, may affect editor
    // REMOVED: 'antigravity.prioritized.agentAcceptAllInFile'  — EDITOR accept!
    // REMOVED: 'antigravity.prioritized.agentAcceptFocusedHunk' — EDITOR accept!
];
CHAT_ACCEPT_COMMANDS.splice(0, CHAT_ACCEPT_COMMANDS.length, 'antigravity.agent.acceptAgentStep', 'antigravity.terminalCommand.accept');

function startCommandsLoop() {
    const clickMs = _httpScrollConfig.clickIntervalMs || 2000;

    if (_autoAcceptInterval) clearInterval(_autoAcceptInterval);

    _autoAcceptInterval = setInterval(() => {
        if (!_autoAcceptEnabled) return;

        // Run chat-safe commands when ANY accept-related pattern is enabled
        const wantsAccept = _httpClickPatterns.includes('Accept');
        if (!wantsAccept) return;

        Promise.allSettled(
            CHAT_ACCEPT_COMMANDS.map(cmd => vscode.commands.executeCommand(cmd))
        ).catch(() => { });
    }, clickMs);

    console.log('[AG Auto] Commands loop started (interval: ' + clickMs + 'ms, enabled: ' + _autoAcceptEnabled + ', chat commands: ' + CHAT_ACCEPT_COMMANDS.length + ')');
}

// =============================================================
// CHECK IF SCRIPT IS ACTUALLY INJECTED
// =============================================================
/**
 * Check if the inject markers actually exist in workbench.html
 * Returns false if Antigravity updated and overwrote the files
 */
function isScriptInjected() {
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath) return false;
        const wbDir = path.dirname(wbPath);
        const html = fs.readFileSync(wbPath, 'utf8');
        const scriptPath = path.join(wbDir, 'ag-auto-script.js');
        if (!hasValidHtmlInjection(html) || !fs.existsSync(scriptPath)) return false;
        const script = fs.readFileSync(scriptPath, 'utf8');
        return script.length > 1000 && script.includes('window._agAutoLoaded');
    } catch (e) {
        console.log('[AG Auto] Cannot check inject status:', e.message);
        return false;
    }
}

function getWorkbenchInstallFingerprint() {
    try {
        const wbPath = getWorkbenchPath();
        if (!wbPath || !fs.existsSync(wbPath)) return 'no-workbench';
        const stat = fs.statSync(wbPath);
        return crypto.createHash('sha1')
            .update(wbPath + '|' + stat.size + '|' + Math.floor(stat.mtimeMs))
            .digest('hex')
            .slice(0, 12);
    } catch (e) {
        console.log('[AG Auto] Cannot build workbench fingerprint:', e.message);
        return 'unknown-workbench';
    }
}

// =============================================================
// EXTENSION ACTIVATION
// =============================================================
function activate(context) {
    _ipcOutput = vscode.window.createOutputChannel('AG Auto IPC');
    context.subscriptions.push(_ipcOutput);
    _ipcDiagnosticAt = 0;
    const _extVersion = context.extension?.packageJSON?.version || 'unknown';
    console.log('[AG Auto] Extension dang khoi dong (v' + _extVersion + ')...');
    _extensionContext = context;
    _reloadRequired = normalizeReloadRequiredState(getReloadRequiredStore(context).get(RELOAD_REQUIRED_STATE_KEY, null));
    resetReloadVerification();
    _reloadWarningNotBefore = _reloadRequired ? Date.now() + STARTUP_RELOAD_WARNING_GRACE_MS : 0;

    // Install restore protection before any startup I/O, injection, IPC, or
    // background work. A newly opened project must never get a chance to reveal
    // a stale dashboard while the rest of activation is still running.
    for (const viewType of LEGACY_SETTINGS_PANEL_VIEW_TYPES) {
        try {
            const serializer = vscode.window.registerWebviewPanelSerializer(viewType, {
                async deserializeWebviewPanel(panel, _state) {
                    console.log('[AG Auto] Intercepted restored webview (' + viewType + ') — disposing immediately');
                    panel.dispose();
                }
            });
            context.subscriptions.push(serializer);
        } catch (e) {
            console.log('[AG Auto] Serializer for ' + viewType + ' already registered or failed:', e.message);
        }
    }
    registerUnexpectedSettingsTabGuard(context);

    // Restore persisted click stats
    _clickStats = context.globalState.get('clickStats', {});
    _totalClicks = context.globalState.get('totalClicks', 0);
    // Restore persisted click log
    const storedLog = context.globalState.get('clickLog', []);
    if (storedLog && storedLog.length > 0) _clickLog = storedLog;
    // Restore persisted startup Accept preference
    _autoAcceptEnabled = context.globalState.get('startupEnabledPreference', true);
    // Restore persisted scroll preference
    _httpScrollEnabled = context.globalState.get('scrollEnabledPreference', true);



    // Background "Keep Waiting" dialog clicker (Win32 native dialog)
    if (process.platform === 'win32') {
        const { execFile } = require('child_process');
        const keepWaitingScript = `
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class AgWin32 {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr hwnd, EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr w, IntPtr l);
}
"@
$global:clicked = $false
[AgWin32]::EnumWindows({
    param($hWnd, $lp)
    if (-not [AgWin32]::IsWindowVisible($hWnd)) { return $true }
    if ($global:clicked) { return $false }
    [AgWin32]::EnumChildWindows($hWnd, {
        param($ch, $lp2)
        $cls = New-Object System.Text.StringBuilder 64
        [AgWin32]::GetClassName($ch, $cls, 64) | Out-Null
        if ($cls.ToString() -eq 'Button') {
            $txt = New-Object System.Text.StringBuilder 256
            [AgWin32]::GetWindowText($ch, $txt, 256) | Out-Null
            $t = $txt.ToString()
            if ($t -match 'Keep Waiting') {
                [AgWin32]::PostMessage($ch, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
                $global:clicked = $true
            }
        }
        return $true
    }, [IntPtr]::Zero) | Out-Null
    if ($global:clicked) { return $false }
    return $true
}, [IntPtr]::Zero) | Out-Null
if ($global:clicked) { Write-Output 'CLICKED' }
`.trim();

        let child = null;
        let disposed = false;
        let retryAt = 0;
        let failures = 0;
        const keepWaitingInterval = setInterval(() => {
            if (disposed || child || Date.now() < retryAt) return;
            if (!_autoAcceptEnabled) return;
            if (!_httpClickPatterns.includes('Keep Waiting')) return;

            child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', keepWaitingScript], { timeout: 5000, windowsHide: true }, (err, stdout) => {
                child = null;
                if (disposed) return;
                failures = err ? Math.min(failures + 1, 5) : 0;
                retryAt = err ? Date.now() + Math.min(30000, 1000 * Math.pow(2, failures)) : 0;
                if (stdout && stdout.trim() === 'CLICKED') {
                    console.log('[AG Auto] 🎯 Native dialog: Keep Waiting clicked via Win32');
                    _totalClicks++;
                    if (!_clickStats['Keep Waiting']) _clickStats['Keep Waiting'] = 0;
                    _clickStats['Keep Waiting']++;
                    if (_extensionContext) {
                        _extensionContext.globalState.update('clickStats', _clickStats);
                        _extensionContext.globalState.update('totalClicks', _totalClicks);
                    }
                }
            });
        }, 3000);
        _nativeWatcherDispose = () => {
            disposed = true;
            clearInterval(keepWaitingInterval);
            if (child) { try { child.kill(); } catch (_) { } child = null; }
        };
        context.subscriptions.push({ dispose: _nativeWatcherDispose });
        console.log('[AG Auto] Win32 Keep Waiting watcher started');
    }

    // extensionKind: ["ui"] ensures this always runs locally — safe to inject
    {

        // Check if script is ACTUALLY present in workbench files (not just a stored key)
        // This handles Antigravity updates that overwrite workbench files
        const needsInject = !isScriptInjected();

        // Detect extension upgrade / first install auto-inject cases
        const currentVersion = context.extension?.packageJSON?.version || '0';
        const lastInjectedVersion = context.globalState.get('ag-injected-version', '0');
        const attemptedInjectKeys = context.globalState.get('ag-auto-inject-attempted-keys', {});
        const versionChanged = currentVersion !== lastInjectedVersion;

        const workbenchFingerprint = getWorkbenchInstallFingerprint();

        let autoInjectKey = '';
        if (versionChanged) {
            autoInjectKey = 'upgrade:' + currentVersion;
        } else if (needsInject) {
            autoInjectKey = 'missing-script:' + workbenchFingerprint;
        }

        const alreadyAttemptedThisKey = autoInjectKey ? !!attemptedInjectKeys[autoInjectKey] : false;
        const shouldInjectNow = !!autoInjectKey && !alreadyAttemptedThisKey;

        // ONLY inject once per reason key (first install / missing script / each upgraded version)
        if (shouldInjectNow) {
            try {
                attemptedInjectKeys[autoInjectKey] = { time: Date.now(), success: false };
                context.globalState.update('ag-auto-inject-attempted-keys', attemptedInjectKeys);
                console.log('[AG Auto] One-time auto inject scheduled for key: ' + autoInjectKey);

                const installOk = installScript(context);
                const injectedAfterInstall = installOk && isScriptInjected();

                if (injectedAfterInstall) {
                    attemptedInjectKeys[autoInjectKey] = { time: Date.now(), success: true };
                    context.globalState.update('ag-auto-inject-attempted-keys', attemptedInjectKeys);
                    context.globalState.update('ag-injected-version', currentVersion);

                    const reason = autoInjectKey.indexOf('missing-script:') === 0
                        ? 'Script not found after Antigravity/workbench update (auto repair key ' + autoInjectKey + ')'
                        : ('Version ' + lastInjectedVersion + ' → ' + currentVersion + ' (one-time auto inject)');
                    console.log('[AG Auto] ' + reason + ' — clearing V8 cache; user reload is required.');
                    clearV8CodeCache();

                    updateProductChecksums();
                    setRuntimeHealth({
                        acceptDegraded: _autoAcceptEnabled,
                        scrollDegraded: _httpScrollEnabled,
                        phase: 'blocked',
                        reason: 'reload-required',
                        detail: 'Startup injection completed. Waiting for the user to reload Antigravity.',
                        source: 'startup-repair'
                    });
                    setReloadRequired(context, 'startup-inject', { deferWarningMs: STARTUP_RELOAD_WARNING_GRACE_MS });
                } else {
                    console.log('[AG Auto] Auto inject attempt did not complete successfully for key ' + autoInjectKey + ' — waiting for manual fallback');
                    vscode.window.showWarningMessage(
                        '[AG Auto] Extension đã tự thử inject script 1 lần cho bản này nhưng chưa thành công. Bạn có muốn chạy Auto Enable (Inject Script) thủ công không?',
                        'Chạy ngay'
                    ).then(choice => {
                        if (choice === 'Chạy ngay') {
                            vscode.commands.executeCommand('ag-auto.enable');
                        }
                    });
                }
            } catch (e) {
                console.error('[AG Auto] Inject error:', e.message);
                vscode.window.showWarningMessage(
                    '[AG Auto] Extension đã tự thử inject script 1 lần cho bản này nhưng gặp lỗi. Bạn có muốn chạy Auto Enable (Inject Script) thủ công không?',
                    'Chạy ngay'
                ).then(choice => {
                    if (choice === 'Chạy ngay') {
                        vscode.commands.executeCommand('ag-auto.enable');
                    }
                });
            }
        } else {
            console.log('[AG Auto] ✅ Auto inject already attempted for current state, skipping');

            // Refresh the on-disk renderer for the next workbench load. The current
            // renderer does not fetch/eval this file dynamically.
            try {
                const wbPath = getWorkbenchPath();
                if (wbPath) {
                    const scriptContent = buildScriptContent(context);
                    const destPath = path.join(path.dirname(wbPath), 'ag-auto-script.js');
                    writeFileElevated(destPath, scriptContent);
                    console.log('[AG Auto] ✅ ag-auto-script.js refreshed for the next renderer load');
                }
            } catch (e) {
                console.error('[AG Auto] Error updating ag-auto-script.js:', e.message);
            }

            const checksumsUpdated = updateProductChecksums();
            if (checksumsUpdated) {
                console.log('[AG Auto] Checksums updated for refreshed on-disk renderer');
            }
        }

        // The host is ready, but status remains CONNECTING until a verified renderer
        // owner poll or runtime heartbeat arrives.
        console.log('[AG Auto] ✅ Script ready, starting services...');
        setRuntimeHealth({
            acceptDegraded: false,
            scrollDegraded: false,
            phase: 'starting',
            reason: 'startup',
            detail: 'Waiting for verified renderer heartbeat.',
            source: 'activate'
        });

        // 1. HTTP server for IPC (injected script polls this for ON/OFF)
        startHttpServer();
        ensureRendererSupervisor(context);

        // 2. Commands API as bonus background accept
        startCommandsLoop();

        // 3. Write config JSON
        writeConfigJson(context);
    } // end of else (non-remote context)

    // ---- Always register commands & status bar (even during first inject/remote) ----
    createStatusBarItem(context);
    if (_reloadRequired) {
        console.log('[AG Auto] Reload-required state restored; warning will appear after the 60-second startup verification window unless three healthy renderer reports arrive first.');
        scheduleReloadRequiredWarning(context);
    }

    scheduleSoftPromo(context);

    // Kill any restored dashboard tabs from previous session ASAP
    consumePendingSettingsRestoreSuppression(context).then(shouldSuppress => {
        if (shouldSuppress) {
            console.log('[AG Auto] Suppress flag active — force-closing restored settings tabs');
            closeUnexpectedSettingsTabs({ force: true }).catch(e => {
                console.log('[AG Auto] Early restore suppression failed:', e.message);
            });
        }
    });

    // Fallback: also try closing restored tabs after a short delay
    const restoredSettingsTimer = setTimeout(() => {
        closeUnexpectedSettingsTabs();
    }, 2000);
    context.subscriptions.push({ dispose: () => clearTimeout(restoredSettingsTimer) });

    // Lắng nghe khi settings thay đổi -> cập nhật status bar icon
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('ag-auto')) {
                updateStatusBarItem();
            }
        })
    );

    // Command: Enable
    context.subscriptions.push(
        vscode.commands.registerCommand('ag-auto.enable', async () => {
            // Selecting Enable is already explicit user confirmation: repair if
            // needed, then reload immediately without requiring a second click.
            if (_reloadRequired) {
                const reloaded = await executeRecoveryReload(context);
                if (!reloaded) scheduleReloadRequiredWarning(context);
                return;
            }

            const success = await performScriptRepair(context, {
                mode: 'manual',
                reason: 'manual-enable',
                revealReloadWarning: false
            });
            if (!success) {
                vscode.window.showErrorMessage('[AG Auto] Inject script thất bại. Hãy thử mở Antigravity bằng quyền Administrator rồi chạy lại.');
                return;
            }

            const reloaded = await executeRecoveryReload(context);
            if (!reloaded) scheduleReloadRequiredWarning(context);
        })
    );

    // Command: Disable
    context.subscriptions.push(
        vscode.commands.registerCommand('ag-auto.disable', async () => {
            const success = uninstallScript();
            if (success) {
                clearV8CodeCache();
                updateProductChecksums();
                updateStatusBarItem();
                const choice = await vscode.window.showInformationMessage(
                    '[AG Auto] Script removed! Reload VS Code to complete.',
                    'Reload Now'
                );
                if (choice === 'Reload Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            } else {
                vscode.window.showErrorMessage('[AG Auto] workbench.html not found!');
            }
        })
    );

    // Command: Reload after a completed script repair. This command is reachable
    // only through the persistent warning item; it never runs automatically.
    context.subscriptions.push(
        vscode.commands.registerCommand('ag-auto.reloadRequired', async () => {
            await executeRecoveryReload(context);
        })
    );

    // Command: Open Settings
    context.subscriptions.push(
        vscode.commands.registerCommand('ag-auto.openSettings', async () => {
            await openSettingsPanel(context, { trigger: 'user' });
        })
    );

    // Standalone lifecycle is independent of IDE workbench writes.
    const agentOutput = vscode.window.createOutputChannel('AG Auto Agent');
    context.subscriptions.push(agentOutput);
    const agentOptions = () => ({ agentPath: vscode.workspace.getConfiguration('ag-auto').get('agentPath', '') });
    const diagnoseAgent = () => {
        const diagnostics = [];
        const paths = agentIntegration.getAgentPaths({ ...agentOptions(), allowFallback: true, diagnostics });
        const report = { version: context.extension?.packageJSON?.version || '10.5.0', configuredAgentPath: agentOptions().agentPath, paths, hookState: paths ? agentIntegration.getAgentStatus({ paths }) : null, diagnostics };
        agentOutput.appendLine(JSON.stringify(report, null, 2));
        console.log('[AG Auto Agent] Diagnostics:', JSON.stringify(report));
        agentOutput.show(true);
        return paths;
    };
    context.subscriptions.push(vscode.commands.registerCommand('ag-auto.diagnoseAgent', diagnoseAgent));
    context.subscriptions.push(vscode.commands.registerCommand('ag-auto.syncAgent', async () => {
        try {
            let paths = diagnoseAgent();
            while (!paths) {
                const choice = await vscode.window.showWarningMessage('[AG Auto] Agent not found. Choose the application folder; invalid selections will not be saved.', 'Choose Agent folder', 'Retry auto-detect');
                if (choice === 'Retry auto-detect') { paths = diagnoseAgent(); continue; }
                if (choice !== 'Choose Agent folder') return;
                const programs = path.join(process.env.LOCALAPPDATA || require('os').homedir(), 'Programs');
                const selected = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri: vscode.Uri.file(programs), openLabel: 'Select Agent application folder' });
                if (!selected || !selected.length) return;
                const diagnostics = [];
                paths = agentIntegration.getAgentPaths({ agentPath: selected[0].fsPath, diagnostics });
                if (!paths) {
                    agentOutput.appendLine(JSON.stringify({ selectedPath: selected[0].fsPath, diagnostics }, null, 2));
                    const detail = diagnostics[diagnostics.length - 1];
                    await vscode.window.showErrorMessage('[AG Auto] Folder was NOT saved. ' + (detail ? detail.code + ': ' + detail.message : 'No compatible Agent found.'));
                }
            }
            const choice = await vscode.window.showWarningMessage('[AG Auto] Cài tích hợp vào ' + paths.agentRoot + ' (Agent ' + paths.packageVersion + '). Lưu công việc và đóng Agent trước. Không tự đóng ứng dụng.', { modal: true }, 'Cài / cập nhật');
            if (choice !== 'Cài / cập nhật') return;
            await vscode.workspace.getConfiguration('ag-auto').update('agentPath', paths.agentRoot, vscode.ConfigurationTarget.Global);
            const config = vscode.workspace.getConfiguration('ag-auto');
            const state = resolveClickPatternState(context, config.get('clickPatterns', ['Allow', 'Run', 'Submit']), { mergeDefaults: false });
            const res = agentIntegration.installAgentHook(state.safePatterns, config.get('clickIntervalMs', 1000), _autoAcceptEnabled, { agentPath: paths.agentRoot });
            agentOutput.appendLine(JSON.stringify(res, null, 2));
            if (res.success) vscode.window.showInformationMessage('[AG Auto] Đã cài trên đĩa. Mở lại Agent và bấm AG Auto để cấu hình; chưa xác nhận engine chạy cho tới khi thấy nút.');
            else if (res.code === 'TRANSACTION_BUSY') vscode.window.showInformationMessage('[AG Auto] Một lượt tích hợp khác đang xử lý. Chờ một chút rồi chạy lại Sync & Fix; nếu đã bật Tự tích hợp, hệ thống sẽ tự thử lại.');
            else { agentOutput.show(true); vscode.window.showErrorMessage('[AG Auto] ' + res.code + ': ' + (res.error || 'Xem Output → AG Auto Agent')); }
        } catch (e) { agentOutput.appendLine(e.stack || e.message); agentOutput.show(true); vscode.window.showErrorMessage('[AG Auto] Sync thất bại: ' + e.message); }
    }));
    _agentLifecycle = attachAgentLifecycle({
        vscode, context, integration: agentIntegration, output: agentOutput,
        getSeed: () => {
            const config = vscode.workspace.getConfiguration('ag-auto');
            const state = resolveClickPatternState(context, config.get('clickPatterns', ['Allow', 'Run', 'Submit']), { mergeDefaults: false });
            return { patterns: state.safePatterns, interval: config.get('clickIntervalMs', 1000), enabled: _autoAcceptEnabled };
        },
        onState: (state, enabled) => {
            _agentLifecycleState = state;
            if (_settingsPanel) _settingsPanel.webview.postMessage({ command: 'agentLifecycle', state, enabled });
        }
    });

}

function deactivate() {
    if (_agentLifecycle) { _agentLifecycle.dispose(); _agentLifecycle = null; }
    if (_ipcOutput) { _ipcOutput.dispose(); _ipcOutput = null; }
    _httpServerIntentionalClose = true;
    if (_promoFallbackTimer) {
        clearTimeout(_promoFallbackTimer);
        _promoFallbackTimer = null;
    }
    _promoFallbackScheduled = false;
    _promoFallbackReady = false;
    _promoShownThisSession = false;
    _settingsOpenedThisSession = false;
    _settingsOpenRequestedThisSession = false;
    if (_httpServerRestartTimer) {
        clearTimeout(_httpServerRestartTimer);
        _httpServerRestartTimer = null;
    }
    if (_httpServerWatchdog) {
        clearInterval(_httpServerWatchdog);
        _httpServerWatchdog = null;
    }
    if (_portRegistryHeartbeat) {
        clearInterval(_portRegistryHeartbeat);
        _portRegistryHeartbeat = null;
    }
    if (_rendererSupervisor) {
        clearInterval(_rendererSupervisor);
        _rendererSupervisor = null;
    }
    _rendererSupervisorTickRunning = false;
    clearReloadWarningTimer();
    _reloadWarningNotBefore = 0;
    _reloadNotificationPromise = null;
    if (reloadRequiredStatusBar) {
        reloadRequiredStatusBar.dispose();
        reloadRequiredStatusBar = null;
    }
    if (statusBarItem) {
        statusBarItem.dispose();
        statusBarItem = null;
    }
    if (statusBarScroll) {
        statusBarScroll.dispose();
        statusBarScroll = null;
    }
    if (_settingsPanel) {
        _settingsPanel.dispose();
        _settingsPanel = null;
    }
    if (_autoAcceptInterval) {
        clearInterval(_autoAcceptInterval);
        _autoAcceptInterval = null;
    }
    const server = _httpServer;
    _httpServer = null;
    _actualPort = 0;
    if (_nativeWatcherDispose) _nativeWatcherDispose();
    if (_httpHealthProbe) _httpHealthProbe.cancel();
    _httpServerStarting = false;
    if (server) {
        for (const socket of _serverSockets.get(server) || []) socket.destroy();
        _serverSockets.delete(server);
        try { server.removeAllListeners(); } catch (_) { }
        try { server.close(); } catch (_) { }
    }
    cleanupPortSidecars();
}

module.exports = { activate, deactivate };
