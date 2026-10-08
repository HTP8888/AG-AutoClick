/**
 * AG Auto Click & Scroll - Antigravity Agent Integration Module
 * Discovery is read-only. Installation requires a closed, validated Desktop app.
 */
// Electron patches fs to treat .asar as virtual directories. The installer needs
// physical archive bytes for validation, hashing, staging, backup and restore.
const fs = process.versions.electron ? require('original-fs') : require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const vm = require('vm');
const { execFileSync } = require('child_process');

const HOOK_START = '// <!-- AG-AUTO-AGENT-START -->';
const HOOK_END = '// <!-- AG-AUTO-AGENT-END -->';
const MANIFEST = '.ag-auto-owner.json';
const OWNER = 'ag-auto-click-scroll';
const VERSION = '10.5.0';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function managementRoot(options = {}) { return options.managementDir || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'AG Auto', 'agent-management'); }
function targetRecord(paths, options = {}) { return path.join(managementRoot(options), hash(path.resolve(paths.agentRoot).toLowerCase()) + '.json'); }
function atomicJSON(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = file + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(data, null, 2), { flag: 'wx' }); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function getManagedTargets(options = {}) {
    const root = managementRoot(options);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => {
        try { const r = JSON.parse(fs.readFileSync(path.join(root, n), 'utf8')); return r.owner === OWNER && typeof r.agentRoot === 'string' ? { ...r, recordPath: path.join(root, n) } : null; } catch (_) { return null; }
    }).filter(Boolean);
}
function acquireLock(paths, options = {}) {
    // Keep mkdir as the acquisition primitive: already-copied legacy helpers use it.
    const dir = path.join(paths.resourcesDir, '.ag-auto-transaction.lock');
    const ownerFile = path.join(dir, 'owner.json');
    const busy = message => fail('TRANSACTION_BUSY', message);
    const readOwner = file => {
        try {
            regular(file);
            const bytes = fs.readFileSync(file, 'utf8'), value = JSON.parse(bytes);
            if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isFinite(value.created) || value.created <= 0 ||
                (value.token !== undefined && !/^[a-f0-9]{32}$/.test(value.token))) throw new Error('Invalid ownership');
            return { bytes, value };
        } catch (_) { busy('Transaction ownership is incomplete or unreadable; it cannot safely be recovered. Retry after the owner finishes initializing.'); }
    };
    const isDead = owner => {
        try { process.kill(owner.pid, 0); return false; }
        catch (error) {
            if (error.code === 'ESRCH') return true;
            busy('Transaction owner process state is unknown (' + (error.code || 'query failed') + '); its lock was preserved.');
        }
    };
    const identity = () => ({ pid: process.pid, created: Date.now(), token: crypto.randomBytes(16).toString('hex') });
    try { fs.mkdirSync(dir); }
    catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let stat;
        try { stat = fs.lstatSync(dir); }
        catch (_) { busy('Transaction lock changed or cannot be inspected. Retry shortly.'); }
        if (!stat.isDirectory() || stat.isSymbolicLink()) busy('Transaction lock is not a regular directory; it was preserved.');
        const original = readOwner(ownerFile);
        if (!isDead(original.value)) busy('Another integration transaction is active (PID ' + original.value.pid + '). Waiting for its lock.');
        // Each immutable ownership record has exactly one exclusive successor claim.
        // If a reaper crashes, a new reaper claims its demonstrably dead record in
        // turn. Never unlink/recreate a claim: that would allow two reapers to win.
        // Claims move WITH the directory, so no late reaper can remove a new lock.
        let predecessor = original, claimed = false;
        const claims = [];
        for (let attempt = 0; attempt < 128; attempt++) {
            const name = '.recover-' + hash(predecessor.bytes), file = path.join(dir, name);
            claims.push(name);
            try {
                fs.writeFileSync(file, JSON.stringify(identity()), { flag: 'wx' });
                claimed = true;
                break;
            } catch (claimError) {
                if (claimError.code !== 'EEXIST') busy('Transaction recovery could not claim ownership (' + claimError.code + '); retry shortly.');
                predecessor = readOwner(file);
                if (!isDead(predecessor.value)) busy('Another process is recovering the abandoned transaction. Retry shortly.');
            }
        }
        if (!claimed) busy('Transaction recovery chain is too long to inspect safely. Ownership was preserved.');
        if (readOwner(ownerFile).bytes !== original.bytes || !isDead(original.value)) busy('Transaction ownership changed during recovery. Retry shortly.');
        const retired = dir + '.retired-' + crypto.randomBytes(16).toString('hex');
        fs.renameSync(dir, retired);
        // Delete only the ownership records we inspected/created, not arbitrary files.
        try {
            for (const name of ['owner.json', ...claims]) fs.unlinkSync(path.join(retired, name));
            fs.rmdirSync(retired);
        } catch (_) { /* Unexpected files or denied cleanup remain for diagnosis. */ }
        try { fs.mkdirSync(dir); }
        catch (nextError) {
            if (nextError.code === 'EEXIST') busy('Another integration transaction acquired the recovered lock. Retry shortly.');
            throw nextError;
        }
    }
    const owner = identity(), bytes = JSON.stringify(owner);
    try { fs.writeFileSync(ownerFile, bytes, { flag: 'wx' }); }
    catch (error) {
        // A partial owner write must not leave an otherwise-owned directory busy.
        try { fs.unlinkSync(ownerFile); } catch (_) {}
        try { fs.rmdirSync(dir); } catch (_) {}
        throw error;
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        // Live owners cannot be reaped. The exact token check also makes repeated
        // release harmless after a successor (including a legacy helper) acquires.
        try {
            if (fs.readFileSync(ownerFile, 'utf8') !== bytes) return;
            const retired = dir + '.released-' + owner.token;
            fs.renameSync(dir, retired);
            fs.unlinkSync(path.join(retired, 'owner.json'));
            fs.rmdirSync(retired);
        } catch (_) { /* Preserve uncertain ownership instead of masking a commit. */ }
    };
}
function inspectAgentStatus(options = {}) {
    const diagnostics = [];
    const paths = options.paths || getAgentPaths({ ...options, diagnostics });
    const state = { appFound: !!paths, hookInstalled: false, hookVersion: null, updateNeeded: !!paths, waitingForExit: false, paths, diagnostics, code: paths ? 'HOOK_MISSING' : 'AGENT_NOT_FOUND' };
    if (!paths) return state;
    try {
        const m = readManifest(paths);
        if (m) {
            state.hookVersion = m.version;
            const preload = fs.readFileSync(paths.preloadPath);
            if (hash(preload) !== m.preloadHash) fail('APP_CHANGED', 'Managed preload changed; repair or inspect before continuing.');
            if (m.mainHash && hash(fs.readFileSync(contained(paths.appDir, m.main))) !== m.mainHash) fail('APP_CHANGED', 'Managed main process changed.');
            state.hookInstalled = true;
            let control; try { control = JSON.parse(fs.readFileSync(m.controlFile, 'utf8')); } catch (_) {}
            state.updateNeeded = m.version !== VERSION || fs.existsSync(paths.asarPath) || !m.generation || !control || control.generation !== m.generation || control.pending || !control.runtimeEnabled || fs.existsSync(m.controlFile + '.' + m.generation + '.stop');
            state.code = state.updateNeeded ? 'UPDATE_NEEDED' : 'HOOK_CURRENT';
        }
        if (options.checkRunning) { state.waitingForExit = runningState(paths, options); state.running = state.waitingForExit; }
    } catch (e) { state.code = e.code || 'STATUS_FAILED'; state.error = e.message; state.updateNeeded = false; state.blocked = true; state.reason = e.message; }
    return state;
}
function fail(code, message) { const e = new Error(message); e.code = code; throw e; }
function contained(root, relative) {
    if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.includes(':')) fail('UNSAFE_PATH', 'Unsafe package path');
    const target = path.resolve(root, relative);
    if (!target.startsWith(path.resolve(root) + path.sep)) fail('UNSAFE_PATH', 'Path escapes application');
    return target;
}
function regular(file) { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink()) fail('UNSAFE_PATH', 'Expected a regular file: ' + file); return s; }
function readArchive(file) {
    const bytes = fs.readFileSync(file);
    if (bytes.length < 16) fail('INVALID_ASAR', 'Truncated ASAR header');
    const headerSize = bytes.readUInt32LE(4), jsonSize = bytes.readUInt32LE(12), base = 8 + headerSize;
    if (jsonSize > 64 * 1024 * 1024 || jsonSize < 2 || base > bytes.length || 16 + jsonSize > base) fail('INVALID_ASAR', 'Invalid ASAR header size');
    const header = JSON.parse(bytes.subarray(16, 16 + jsonSize).toString('utf8'));
    const entries = new Map();
    function walk(node, prefix) {
        if (!node.files || typeof node.files !== 'object') fail('INVALID_ASAR', 'Missing ASAR file table');
        for (const [name, entry] of Object.entries(node.files)) {
            if (!name || name === '.' || name === '..' || /[\\/:]/.test(name)) fail('UNSAFE_PATH', 'Unsafe ASAR entry');
            const rel = prefix ? prefix + '/' + name : name;
            if (entry.link) fail('UNSAFE_PATH', 'ASAR links are not supported');
            if (entry.files) walk(entry, rel);
            else {
                if (!Number.isSafeInteger(entry.size) || entry.size < 0) fail('INVALID_ASAR', 'Invalid ASAR size');
                if (!entry.unpacked) {
                    if (!/^\d+$/.test(String(entry.offset))) fail('INVALID_ASAR', 'Invalid ASAR offset');
                    const offset = Number(entry.offset);
                    if (!Number.isSafeInteger(offset) || base + offset + entry.size > bytes.length) fail('INVALID_ASAR', 'Truncated ASAR entry');
                }
                entries.set(rel, entry);
            }
        }
    }
    walk(header, '');
    return { entries, read(rel) {
        const entry = entries.get(rel);
        if (!entry) fail('INVALID_APP', 'Missing app file: ' + rel);
        if (entry.unpacked) {
            const root = path.basename(file).startsWith('.ag-auto-archive-') ? path.join(path.dirname(file), 'app.asar.unpacked') : file.replace(/\.(original|disabled|bak)$/, '') + '.unpacked';
            const source = contained(root, rel);
            const realRoot = fs.realpathSync(root), realSource = fs.realpathSync(source);
            if (!realSource.startsWith(realRoot + path.sep)) fail('UNSAFE_PATH', 'Unpacked path escapes root');
            if (regular(source).size !== entry.size) fail('INVALID_ASAR', 'Unpacked file size mismatch');
            return fs.readFileSync(source);
        }
        const start = base + Number(entry.offset);
        return bytes.subarray(start, start + entry.size);
    } };
}
/** Zero-dependency Chromium Pickle reader, with bounded offsets and path checks. */
function extractAsar(asarPath, destDir) {
    if (fs.existsSync(destDir) && fs.readdirSync(destDir).length) fail('UNSAFE_DESTINATION', 'Extraction destination must be empty');
    const archive = readArchive(asarPath);
    for (const rel of archive.entries.keys()) {
        const dest = contained(destDir, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, archive.read(rel), { flag: 'wx' });
    }
}
function readManifest(paths) {
    const file = path.join(paths.appDir, MANIFEST);
    if (!fs.existsSync(file)) return null;
    const m = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (m.owner !== OWNER || m.schema !== 1) fail('OWNERSHIP_CONFLICT', 'Unrecognized ownership manifest');
    for (const key of ['archiveBackup', 'previousApp']) if (m[key] && (path.basename(m[key]) !== m[key] || !m[key].startsWith('.ag-auto-'))) fail('OWNERSHIP_CONFLICT', 'Unsafe backup reference');
    return m;
}
function findSourceAsar(paths) {
    if (!paths) return null;
    if (fs.existsSync(paths.asarPath)) return paths.asarPath; // An updater's fresh archive always wins.
    const m = readManifest(paths);
    if (m && m.archiveBackup) {
        const p = path.join(paths.resourcesDir, m.archiveBackup);
        if (!fs.existsSync(p) || hash(fs.readFileSync(p)) !== m.archiveHash) fail('BACKUP_CHANGED', 'Original archive backup is missing or changed');
        return p;
    }
    // Managed directory installs have native bytes in their manifest, not an
    // archive backup. Their known hook must not trigger legacy-ASAR recovery.
    if (m && m.source === 'directory') return null;
    // Legacy recovery is allowed only when the old extraction ownership marker exists.
    const legacyPreload = fs.existsSync(paths.preloadPath) ? fs.readFileSync(paths.preloadPath, 'utf8') : '';
    if (fs.existsSync(path.join(paths.appDir, '.ag-auto-extracted')) || legacyPreload.includes(HOOK_START)) {
        let version;
        try { version = JSON.parse(fs.readFileSync(path.join(paths.appDir, 'package.json'), 'utf8')).version; } catch (_) {}
        const clean = ['.disabled', '.original', '.bak'].map(s => paths.asarPath + s).filter(p => fs.existsSync(p)).filter(p => {
            try {
                const a = readArchive(p), pkg = JSON.parse(a.read('package.json'));
                const preload = a.read('dist/preload.js').toString();
                return (!version || pkg.version === version) && !/AG.AUTO|ag.auto.agent|_agAuto/i.test(preload);
            } catch (_) { return false; }
        });
        if (clean.length) return clean[0];
        fail('LEGACY_BACKUP_REQUIRED', 'No clean matching vendor archive. Repair/reinstall Agent before Sync; existing files were preserved.');
    }
    return null;
}
function validateApp(read, exists) {
    const pkg = JSON.parse(read('package.json').toString('utf8'));
    if (!pkg.name || typeof pkg.main !== 'string') fail('INVALID_APP', 'Missing package name or main');
    const main = pkg.main.replace(/^\.\//, '');
    contained('/validation-root', main);
    if (/(?:^|\/)(?:out\/main|vs\/code)/i.test(main) || exists('product.json')) fail('IDE_NOT_AGENT', 'Antigravity IDE is not the Desktop Agent');
    if (!/antigravity/i.test([pkg.name, pkg.productName].join(' '))) fail('INVALID_APP', 'Package is not Antigravity');
    if (!exists(main) || !exists('dist/preload.js')) fail('INVALID_APP', 'Agent main or dist/preload.js is missing');
    const mainCode = read(main).toString('utf8'), preload = read('dist/preload.js').toString('utf8');
    if (!/electron|require\(/.test(mainCode) || !/contextBridge/.test(preload) || !/ipcRenderer/.test(preload) || !/exposeInMainWorld/.test(preload)) fail('INVALID_APP', 'Desktop Electron preload contract not found');
    new vm.Script(preload, { filename: 'preload.js' });
    return { main, packageVersion: pkg.version || 'unknown', packageName: pkg.name };
}
function pathsFor(candidate) {
    let root = path.resolve(candidate.replace(/^"|"$/g, ''));
    if (/\.exe$/i.test(root)) root = path.dirname(root);
    if (/^app\.asar(?:\.(?:original|disabled|bak))?$/i.test(path.basename(root))) root = path.dirname(root);
    if (path.basename(root).toLowerCase() === 'app') root = path.dirname(root);
    const resourcesDir = path.basename(root).toLowerCase() === 'resources' ? root : path.join(root, 'resources');
    const appDir = path.join(resourcesDir, 'app');
    return { agentRoot: path.dirname(resourcesDir), resourcesDir, appDir, asarPath: path.join(resourcesDir, 'app.asar'), preloadPath: path.join(appDir, 'dist', 'preload.js'), markerPath: path.join(appDir, MANIFEST) };
}
function processSnapshot() {
    if (process.platform !== 'win32') return { known: false, processes: [] };
    try {
        const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.Name -match "antigravity" } | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
        const rows = output.trim() ? JSON.parse(output) : [];
        const processes = (Array.isArray(rows) ? rows : [rows]);
        return { known: processes.every(p => typeof p.ExecutablePath === 'string' && p.ExecutablePath), processes };
    } catch (_) { return { known: false, processes: [] }; }
}
function registryCandidates() {
    if (process.platform !== 'win32') return [];
    const result = [];
    for (const key of ['HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall']) {
        try {
            const output = execFileSync('reg.exe', ['query', key, '/s'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
            for (const block of output.split(/\r?\n(?=HKEY_)/)) {
                if (!/DisplayName\s+REG_SZ\s+[^\r\n]*antigravity/i.test(block)) continue;
                for (const match of block.matchAll(/(?:InstallLocation|DisplayIcon)\s+REG_(?:SZ|EXPAND_SZ)\s+([^\r\n]+)/g)) {
                    result.push(match[1].trim().replace(/,\s*-?\d+$/, '').replace(/%([^%]+)%/g, (_, k) => process.env[k] || '%' + k + '%'));
                }
            }
        } catch (_) { /* Registry keys can be absent or access restricted. */ }
    }
    return result;
}
/** Return only validated Desktop installations; never invent an installed path. */
function getAgentPaths(options = {}) {
    if (typeof options === 'string') options = { agentPath: options };
    if (options.agentPath && options.allowFallback) {
        const rejected = [];
        const exact = getAgentPaths({ ...options, allowFallback: false, diagnostics: rejected });
        if (exact) return exact;
        const found = getAgentPaths({ ...options, agentPath: '', allowFallback: false });
        if (options.diagnostics) options.diagnostics.push(...rejected);
        if (found) found.diagnostics.unshift({ code: 'STALE_PATH_RECOVERED', candidate: options.agentPath, message: 'Ignored invalid saved path; found validated Agent at ' + found.agentRoot });
        return found;
    }
    const snapshot = options._processSnapshot || processSnapshot();
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const candidates = options.agentPath ? [options.agentPath] : [
        ...snapshot.processes.map(p => p.ExecutablePath).filter(Boolean), ...registryCandidates(),
        ...['Antigravity Agent', 'Antigravity', 'antigravity'].map(n => path.join(local, 'Programs', n)),
        ...['Antigravity Agent', 'Antigravity'].map(n => path.join(process.env.ProgramFiles || 'C:\\Program Files', n))
    ];
    const diagnostics = [], valid = [], seen = new Set();
    for (const candidate of [...new Set(candidates)]) {
        try {
            const p = pathsFor(candidate);
            const identity = p.agentRoot.toLowerCase();
            if (seen.has(identity)) continue;
            seen.add(identity);
            if (!fs.existsSync(p.resourcesDir)) {
                diagnostics.push({ candidate, code: 'RESOURCES_NOT_FOUND', message: 'Application resources directory not found: ' + p.resourcesDir });
                continue;
            }
            if (fs.lstatSync(p.resourcesDir).isSymbolicLink() || (fs.existsSync(p.appDir) && fs.lstatSync(p.appDir).isSymbolicLink())) fail('UNSAFE_PATH', 'Symlink installation is not supported');
            const sourceAsar = findSourceAsar(p);
            let metadata;
            if (sourceAsar) {
                const archive = readArchive(sourceAsar);
                metadata = validateApp(rel => archive.read(rel), rel => archive.entries.has(rel));
            } else {
                metadata = validateApp(rel => fs.readFileSync(contained(p.appDir, rel)), rel => fs.existsSync(contained(p.appDir, rel)));
            }
            valid.push({ ...p, ...metadata, mainPath: path.join(p.appDir, metadata.main), sourceAsar, source: sourceAsar ? 'asar' : 'directory', isInstalled: true, diagnostics });
        } catch (e) { diagnostics.push({ candidate, code: e.code || 'INVALID_APP', message: e.message }); }
    }
    if (valid.length === 1) return valid[0];
    if (valid.length > 1) diagnostics.push({ code: 'MULTIPLE_AGENTS', message: 'Choose ag-auto.agentPath explicitly', candidates: valid.map(p => p.agentRoot) });
    if (options.diagnostics) options.diagnostics.push(...diagnostics);
    return null;
}
function isAppCorrupted(paths) {
    try { validateApp(rel => fs.readFileSync(contained(paths.appDir, rel)), rel => fs.existsSync(contained(paths.appDir, rel))); return false; } catch (_) { return true; }
}
function runningState(paths, options = {}) {
    const snapshot = options._processSnapshot || processSnapshot();
    if (!snapshot.known) fail('PROCESS_QUERY_FAILED', 'Cannot safely determine whether Agent is closed. Close Agent and retry.');
    const root = path.resolve(paths.agentRoot).toLowerCase() + path.sep;
    return snapshot.processes.some(p => path.resolve(p.ExecutablePath).toLowerCase().startsWith(root));
}
function isAgentRunning(options = {}) { const p = options.paths || getAgentPaths(options); return p ? runningState(p, options) : false; }
// Never kill a process by image name or restart applications without explicit user action.
function closeAgent() { return false; }
function launchAgent() { return false; }
function managedMain(controlFile, generation) {
    const { ipcMain, BrowserWindow, app, shell } = require('electron');
    const fs = require('fs');
    const channel = 'ag-auto-managed-' + generation;
    function enabled() {
        try { const value = JSON.parse(fs.readFileSync(controlFile, 'utf8')); return value.owner === 'ag-auto-click-scroll' && value.generation === generation && value.runtimeEnabled === true && !value.pending && !fs.existsSync(controlFile + '.' + generation + '.stop'); } catch (_) { return false; }
    }
    function allowed(sender) { return !sender.isDestroyed() && BrowserWindow.getAllWindows().some(w => w.webContents === sender); }
    ipcMain.on(channel + ':state', event => { if (allowed(event.sender)) event.sender.send(channel + ':state', enabled()); });
    ipcMain.on(channel + ':bot', event => { if (allowed(event.sender) && enabled()) shell.openExternal('https://t.me/infinityaistore_bot').catch(() => {}); });
    const timer = setInterval(() => { const state = enabled(); for (const w of BrowserWindow.getAllWindows()) if (!w.webContents.isDestroyed()) w.webContents.send(channel + ':state', state); }, 2000);
    timer.unref();
    // The extension can already be deleted. Resume its copied, bounded helper.
    function resumeCleanup() { try {
        const record = JSON.parse(fs.readFileSync(controlFile, 'utf8'));
        if (record.owner === 'ag-auto-click-scroll' && record.generation === generation && (record.pending || fs.existsSync(controlFile + '.' + generation + '.stop')) && !record.completed && record.workerPath && fs.existsSync(record.workerPath)) {
            const child = require('child_process').spawn(record.helperExecPath, [record.workerPath, '--cleanup', controlFile, generation], { cwd: require('path').dirname(record.workerPath), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
            child.on('error', error => { try { fs.appendFileSync(controlFile + '.log', JSON.stringify({ time: Date.now(), code: 'HELPER_LAUNCH_FAILED', error: error.message }) + '\n'); } catch (_) {} }); child.unref();
        }
    } catch (_) { /* Missing control data fails closed; never interrupt vendor startup. */ } }
    resumeCleanup();
    app.once('will-quit', () => { resumeCleanup(); clearInterval(timer); ipcMain.removeAllListeners(channel + ':state'); ipcMain.removeAllListeners(channel + ':bot'); });
}
function buildAgentScript(patterns, clickIntervalMs, enabled, management) {
    const runtimePath = require.resolve('../media/agentAutoScript');
    delete require.cache[runtimePath]; // Read the packaged runtime at installation time, not activation time.
    const runtime = require(runtimePath);
    if (typeof runtime !== 'function') fail('INVALID_RUNTIME', 'Agent runtime must export a function');
    const config = { version: VERSION, enabled: enabled !== false, clickPatterns: Array.isArray(patterns) ? patterns.filter(p => typeof p === 'string') : [], clickIntervalMs: Math.max(100, Number(clickIntervalMs) || 1000), management };
    const code = '(' + runtime.toString() + ')(' + JSON.stringify(config) + ');';
    new vm.Script(code);
    return code;
}
function stripHook(code) {
    const start = code.indexOf(HOOK_START), end = code.indexOf(HOOK_END);
    if (start === -1 && end === -1) return code;
    if (start === -1 || end < start || code.indexOf(HOOK_START, start + 1) !== -1 || code.indexOf(HOOK_END, end + 1) !== -1) fail('AMBIGUOUS_HOOK', 'Malformed or duplicate legacy hook markers; refusing to alter native code');
    const lineStart = code.lastIndexOf('\n', start - 1) + 1;
    if (code.slice(lineStart, start).trim() || code.slice(end + HOOK_END.length).trim()) fail('AMBIGUOUS_HOOK', 'Hook markers are not a standalone trailing block');
    return code.slice(0, lineStart).replace(/\n$/, '');
}
function treeHash(root) {
    const digest = crypto.createHash('sha256');
    function walk(dir, prefix) {
        for (const name of fs.readdirSync(dir).sort()) {
            if (!prefix && name === MANIFEST) continue;
            const file = path.join(dir, name), rel = prefix + name, stat = fs.lstatSync(file);
            if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Application symlink is not supported');
            digest.update(rel + '\0');
            if (stat.isDirectory()) walk(file, rel + '/');
            else { regular(file); digest.update(fs.readFileSync(file)); }
        }
    }
    walk(root, ''); return digest.digest('hex');
}
function result(paths, fields) { return { installed: !!paths, appFound: !!paths, success: false, restartRequired: false, waitingForExit: false, diagnostics: paths ? paths.diagnostics : [], paths, ...fields }; }
function installAgentHook(patterns, interval, enabled, options = {}) {
    const diagnostics = [];
    let paths = getAgentPaths({ ...options, diagnostics });
    if (!paths) return result(null, { code: 'AGENT_NOT_FOUND', error: 'No validated Desktop Agent found.', diagnostics });
    let stage, heldApp, archiveBackup, release, controlFile, previousControl, controlWritten = false, committed = false;
    try {
        release = acquireLock(paths, options);
        paths = getAgentPaths({ ...options, agentPath: paths.agentRoot });
        if (!paths) fail('APP_CHANGED', 'Application changed while acquiring transaction lock.');
        if (options.shouldContinue && !options.shouldContinue()) fail('CANCELLED', 'Integration cancelled.');
        const status = inspectAgentStatus({ ...options, paths });
        if (status.error) fail(status.code, status.error);
        if (!status.updateNeeded && !options.force) {
            const current = readManifest(paths);
            const record = JSON.parse(fs.readFileSync(current.controlFile, 'utf8'));
            atomicJSON(current.controlFile, { ...record, extensionPath: path.resolve(__dirname, '..'), updated: Date.now() });
            return result(paths, { ...status, success: true, code: 'HOOK_CURRENT', unchanged: true });
        }
        if (runningState(paths, options)) return result(paths, { code: 'AGENT_RUNNING', busy: true, waitingForExit: true, error: 'Close this Desktop Agent manually, then Sync again.' });
        const old = readManifest(paths);
        const token = crypto.randomBytes(8).toString('hex');
        stage = path.join(paths.resourcesDir, '.ag-auto-stage-' + token);
        if (paths.sourceAsar) extractAsar(paths.sourceAsar, stage);
        else { treeHash(paths.appDir); fs.cpSync(paths.appDir, stage, { recursive: true, dereference: false }); }
        const preload = path.join(stage, 'dist', 'preload.js');
        const native = stripHook(fs.readFileSync(preload, 'utf8'));
        if (/ag.auto.agent|_agAuto|AG.AUTO.CLICK/i.test(native)) fail('LEGACY_BACKUP_REQUIRED', 'Unknown legacy engine remains. Repair Agent from vendor installer first.');
        controlFile = targetRecord(paths, options);
        previousControl = fs.existsSync(controlFile) ? fs.readFileSync(controlFile) : null;
        const workerPath = require('./agentCleanup').prepareWorker({ ...options, generation: token });
        const management = { channel: 'ag-auto-managed-' + token };
        const injected = native + '\n' + HOOK_START + '\n;\n' + buildAgentScript(patterns, interval, enabled, management) + '\n' + HOOK_END + '\n';
        new vm.Script(injected);
        fs.writeFileSync(preload, injected);
        const pkg = JSON.parse(fs.readFileSync(path.join(stage, 'package.json'), 'utf8'));
        if (pkg.type === 'module' || /\.mjs$/i.test(paths.main)) fail('UNSUPPORTED_MAIN', 'Managed lifecycle requires a CommonJS Agent main entry.');
        const mainFile = contained(stage, paths.main), nativeMain = stripHook(fs.readFileSync(mainFile, 'utf8'));
        const mainCode = nativeMain + '\n' + HOOK_START + '\n;(' + managedMain.toString() + ')(' + JSON.stringify(controlFile) + ',' + JSON.stringify(token) + ');\n' + HOOK_END + '\n';
        new vm.Script(mainCode); fs.writeFileSync(mainFile, mainCode);
        validateApp(rel => fs.readFileSync(contained(stage, rel)), rel => fs.existsSync(contained(stage, rel)));
        const m = { schema: 1, owner: OWNER, version: VERSION, generation: token, controlFile, main: paths.main, nativeMain: Buffer.from(nativeMain).toString('base64'), mainHash: hash(mainCode), source: paths.sourceAsar ? 'asar' : 'directory', nativePreload: Buffer.from(native).toString('base64'), preloadHash: hash(injected) };
        if (fs.existsSync(paths.asarPath)) {
            archiveBackup = path.join(paths.resourcesDir, '.ag-auto-archive-' + token + '.asar');
            m.archiveBackup = path.basename(archiveBackup);
            m.archiveHash = hash(fs.readFileSync(paths.asarPath));
        } else if (old && old.archiveBackup && paths.sourceAsar === path.join(paths.resourcesDir, old.archiveBackup)) {
            // findSourceAsar already verified this backup. Keep the original restore
            // source rather than creating (or later deleting) duplicate vendor bytes.
            m.archiveBackup = old.archiveBackup; m.archiveHash = old.archiveHash;
        } else if (paths.sourceAsar) {
            // Copy legacy/nonstandard sources to a uniquely owned backup; never overwrite old backups.
            archiveBackup = path.join(paths.resourcesDir, '.ag-auto-archive-' + token + '.asar');
            fs.copyFileSync(paths.sourceAsar, archiveBackup, fs.constants.COPYFILE_EXCL);
            m.archiveBackup = path.basename(archiveBackup); m.archiveHash = hash(fs.readFileSync(archiveBackup));
        }
        if (fs.existsSync(paths.appDir)) {
            heldApp = path.join(paths.resourcesDir, '.ag-auto-previous-' + token);
            m.previousApp = old ? old.previousApp : path.basename(heldApp);
        }
        m.treeHash = treeHash(stage);
        fs.writeFileSync(path.join(stage, MANIFEST), JSON.stringify(m, null, 2));
        if (options.shouldContinue && !options.shouldContinue()) fail('CANCELLED', 'Integration cancelled.');
        if (runningState(paths, options)) fail('AGENT_RUNNING', 'Agent started during preparation; close it and retry.');
        atomicJSON(controlFile, { schema: 1, owner: OWNER, version: VERSION, agentRoot: paths.agentRoot, generation: token, runtimeEnabled: true, pending: false, workerPath, helperExecPath: options.execPath || process.execPath, extensionPath: path.resolve(__dirname, '..'), updated: Date.now() });
        controlWritten = true;
        if (heldApp) fs.renameSync(paths.appDir, heldApp);
        fs.renameSync(stage, paths.appDir);
        if (fs.existsSync(paths.asarPath)) fs.renameSync(paths.asarPath, archiveBackup);
        committed = true;
        if (old && heldApp && path.basename(heldApp) !== m.previousApp) {
            try {
                const heldManifest = JSON.parse(fs.readFileSync(path.join(heldApp, MANIFEST), 'utf8'));
                if (heldManifest.owner === OWNER && heldManifest.generation === old.generation && old.treeHash && treeHash(heldApp) === old.treeHash) fs.rmSync(heldApp, { recursive: true });
                else paths.diagnostics.push({ code: 'OLD_COPY_PRESERVED', message: 'The replaced application contains unverified changes and was preserved.' });
            } catch (_) { paths.diagnostics.push({ code: 'OLD_COPY_PRESERVED', message: 'The replaced application could not be verified or removed and was preserved.' }); }
        }
        return result(paths, { success: true, code: 'HOOK_INSTALLED', restartRequired: true, runtimeVerified: false, diagnostics: [...paths.diagnostics, { message: 'Installed on disk only. Start Agent and verify its pill; runtime execution is not confirmed.' }] });
    } catch (e) {
        const rollback = [];
        if (!committed && controlWritten) {
            try { if (previousControl) atomicJSON(controlFile, JSON.parse(previousControl.toString('utf8'))); else fs.unlinkSync(controlFile); }
            catch (r) { rollback.push({ message: 'Control rollback failed: ' + r.message }); }
        }
        if (!committed && heldApp && fs.existsSync(heldApp)) {
            try { if (fs.existsSync(paths.appDir)) fs.rmSync(paths.appDir, { recursive: true }); fs.renameSync(heldApp, paths.appDir); } catch (r) { rollback.push({ message: 'Rollback failed: ' + r.message }); }
        } else if (!committed && stage && !fs.existsSync(stage) && fs.existsSync(paths.appDir)) {
            try { fs.rmSync(paths.appDir, { recursive: true }); } catch (r) { rollback.push({ message: 'Rollback failed: ' + r.message }); }
        }
        return result(paths, { code: e.code || 'INSTALL_FAILED', error: e.message, diagnostics: [...paths.diagnostics, ...rollback] });
    } finally {
        try { if (stage && fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); } catch (_) { /* Retain staging for diagnosis if cleanup is denied. */ }
        if (release) release();
    }
}
function uninstallAgentHook(options = {}) {
    const paths = getAgentPaths(options);
    if (!paths) return result(null, { code: 'AGENT_NOT_FOUND' });
    let release;
    try {
        release = acquireLock(paths, options);
        if (options.cleanupRecord) {
            let record; try { record = JSON.parse(fs.readFileSync(options.cleanupRecord, 'utf8')); } catch (_) {}
            if (!record || record.owner !== OWNER || record.generation !== options.generation || (!record.pending && !fs.existsSync(options.cleanupRecord + '.' + options.generation + '.stop'))) return result(paths, { success: true, code: 'SUPERSEDED' });
        }
        const m = readManifest(paths);
        if (!m) return result(paths, { success: true, code: 'NOT_OWNED' });
        if (options.generation && m.generation !== options.generation) return result(paths, { success: true, code: 'SUPERSEDED' });
        if (runningState(paths, options)) return result(paths, { code: 'AGENT_RUNNING', busy: true, waitingForExit: true, error: 'Close Agent manually before removal.' });
        if (treeHash(paths.appDir) !== m.treeHash) fail('APP_CHANGED', 'Application files changed after installation; refusing destructive removal.');
        if (runningState(paths, options)) return result(paths, { code: 'AGENT_RUNNING', busy: true, waitingForExit: true });
        if (m.source === 'directory') {
            const code = fs.readFileSync(paths.preloadPath);
            if (hash(code) !== m.preloadHash) fail('APP_CHANGED', 'Preload changed after installation');
            const mainFile = m.main && m.nativeMain ? contained(paths.appDir, m.main) : null;
            const mainCode = mainFile ? fs.readFileSync(mainFile) : null;
            try {
                fs.writeFileSync(paths.preloadPath, Buffer.from(m.nativePreload, 'base64'));
                if (mainFile) fs.writeFileSync(mainFile, Buffer.from(m.nativeMain, 'base64'));
                fs.unlinkSync(paths.markerPath);
            } catch (error) {
                try { fs.writeFileSync(paths.preloadPath, code); if (mainFile) fs.writeFileSync(mainFile, mainCode); }
                catch (rollbackError) { error.message += '; restoration rollback failed: ' + rollbackError.message; }
                throw error;
            }
        } else {
            const backup = path.join(paths.resourcesDir, m.archiveBackup);
            if (!fs.existsSync(paths.asarPath) && (!fs.existsSync(backup) || hash(fs.readFileSync(backup)) !== m.archiveHash)) fail('BACKUP_CHANGED', 'Original archive backup is missing or changed');
            const retired = path.join(paths.resourcesDir, '.ag-auto-removed-' + crypto.randomBytes(8).toString('hex'));
            fs.renameSync(paths.appDir, retired);
            try {
                if (!fs.existsSync(paths.asarPath)) fs.renameSync(backup, paths.asarPath);
                // Do not restore a legacy extracted tree: it may contain the obsolete engine.
                // The validated current vendor ASAR is the restored application.
            } catch (e) { if (!fs.existsSync(paths.appDir)) fs.renameSync(retired, paths.appDir); throw e; }
            // Retain the detached owned tree as a recovery copy rather than deleting user files.
        }
        const recordFile = m.controlFile || targetRecord(paths, options);
        if (fs.existsSync(recordFile)) {
            const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'));
            if (record.owner === OWNER && record.generation === m.generation) atomicJSON(recordFile, { ...record, runtimeEnabled: false, pending: false, completed: Date.now() });
        }
        return result(paths, { success: true, code: 'HOOK_REMOVED', restartRequired: true, runtimeVerified: false });
    } catch (e) { return result(paths, { code: e.code || 'UNINSTALL_FAILED', error: e.message }); }
    finally { if (release) release(); }
}
module.exports = { VERSION, OWNER, managementRoot, getManagedTargets, targetRecord, atomicJSON, acquireLock, pathsFor, inspectAgentStatus, getAgentStatus: inspectAgentStatus, isPathRunning: runningState, getAgentPaths, findSourceAsar, isAppCorrupted, isAgentRunning, closeAgent, launchAgent, extractAsar, buildAgentScript, installAgentHook, uninstallAgentHook };
