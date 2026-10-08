module.exports = function initAgAutoAgent(config) {
    'use strict';
    // Self-contained: installer serializes this function into the sandboxed renderer.
    var win = window, doc = document;
    if (win.__agAutoAgent && !win.__agAutoAgent.destroyed) {
        win.__agAutoAgent.mount();
        return win.__agAutoAgent;
    }
    config = config || {};
    var KEY = 'ag-auto-agent-settings-v1';
    var defaults = { enabled: false, patterns: ['Submit', 'Run', 'Allow', 'Accept all', 'Keep Waiting'], interval: 1000 };
    var stored = null, storageOK = true;
    try { stored = JSON.parse(win.localStorage.getItem(KEY) || 'null'); } catch (_) { storageOK = false; }
    var validStored = stored && stored.schemaVersion === 1;
    function own(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
    function normalize(input, partial) {
        input = input || {};
        var out = partial ? {} : { enabled: defaults.enabled, patterns: defaults.patterns.slice(), interval: defaults.interval };
        if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
        var p = own(input, 'patterns') ? input.patterns : input.clickPatterns;
        if (Array.isArray(p) || typeof p === 'string') {
            out.patterns = (Array.isArray(p) ? p : p.split(/\r?\n/)).filter(function (v) { return typeof v === 'string'; }).map(function (v) { return v.trim(); }).filter(Boolean).slice(0, 100);
        }
        var n = own(input, 'interval') ? input.interval : (own(input, 'clickIntervalMs') ? input.clickIntervalMs : input.intervalMs);
        if (n !== '' && n != null && isFinite(Number(n))) out.interval = Math.max(250, Math.min(60000, Math.round(Number(n))));
        return out;
    }
    var seed = normalize(Object.assign({}, validStored ? stored.seed : {}, normalize(config, true)), false);
    var overrides = normalize(validStored ? stored.overrides : {}, true);
    if (!validStored) {
        try {
            var legacy = win.localStorage.getItem('ag_auto_agent_enabled');
            if (legacy === 'false' || legacy === '0' || legacy === 'off') overrides.enabled = false;
            else if (legacy === 'true' || legacy === '1' || legacy === 'on') overrides.enabled = true;
        } catch (_) { storageOK = false; }
    }
    var root, panel, pill, toggle, intervalInput, status, timer;
    var patternChoices = ['Submit', 'Run', 'Accept', 'Allow'], patternChecks = [];
    function selectedPatterns() { return patternChoices.filter(function (_, i) { return patternChecks[i].checked; }); }
    var stopped = false, lastClicks = new WeakMap();
    var managed = !!(config.management && config.management.channel), acknowledged = !managed, lastAck = 0, ipc = null, managementTimer = null, stateListener;
    function permitted() { return !managed || (acknowledged && Date.now() - lastAck < 7000); }
    function settings() { return normalize(Object.assign({}, seed, overrides), false); }
    function persist() {
        try {
            win.localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, seed: seed, overrides: overrides }));
            storageOK = true;
        } catch (_) { storageOK = false; }
    }
    function node(tag, text, parent) {
        var el = doc.createElement(tag);
        if (text) el.textContent = text;
        if (parent) parent.appendChild(el);
        return el;
    }
    function button(text, action, parent) {
        var el = node('button', text, parent); el.type = 'button';
        el.style.cssText = 'appearance:none;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;font:500 12px system-ui,sans-serif;line-height:18px;color:#dbe5f5;background:#243147;border:1px solid #394961;border-radius:8px;padding:8px 12px;cursor:pointer;text-decoration:none;';
        el.addEventListener('click', action);
        return el;
    }
    function paint() {
        if (!root) return;
        var s = settings();
        pill.textContent = 'AG Auto · ' + (s.enabled ? 'ON' : 'OFF') + ' ⚙';
        toggle.checked = s.enabled;
        patternChecks.forEach(function (input, i) { input.checked = s.patterns.some(function (p) { return canonical(p) === canonical(patternChoices[i]); }); });
        intervalInput.value = String(s.interval);
        status.textContent = storageOK ? 'Đã lưu' : 'Không thể lưu';
    }
    function update(patch) {
        overrides = Object.assign({}, overrides, normalize(patch, true));
        persist(); paint(); schedule(); return settings();
    }
    function importSeed() {
        // Embedded IDE seed is a snapshot, never a live synchronization connection.
        overrides = {}; persist(); paint(); schedule(); return settings();
    }
    function mount() {
        if (stopped || !permitted() || !doc.body || (root && root.isConnected)) return;
        var stale = doc.getElementById('ag-auto-agent-root');
        if (stale) stale.remove();
        root = node('div', '', doc.body); root.id = 'ag-auto-agent-root';
        root.setAttribute('data-ag-auto-agent', 'true');
        root.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;font:13px system-ui,sans-serif;color:#e9eef8;';
        pill = button('AG Auto', function () {
            panel.hidden = !panel.hidden; pill.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) toggle.focus();
        }, root);
        pill.setAttribute('aria-controls', 'ag-auto-agent-panel'); pill.setAttribute('aria-expanded', 'false');
        pill.setAttribute('aria-label', 'AG Auto — mở cài đặt tự động bấm');
        pill.style.cssText = 'border:1px solid #677b9c;border-radius:18px;padding:8px 14px;background:#202c41;color:#fff;cursor:pointer;';
        panel = node('section', '', root); panel.id = 'ag-auto-agent-panel'; panel.hidden = true;
        panel.setAttribute('aria-label', 'Cài đặt AG Auto');
        panel.style.cssText = 'box-sizing:border-box;position:absolute;right:0;bottom:46px;width:288px;max-width:calc(100vw - 36px);max-height:75vh;overflow:auto;padding:16px;border:1px solid #35445b;border-radius:14px;background:#141e2e;color:#e9eef8;box-shadow:0 12px 36px #0008;font:12px system-ui,sans-serif;line-height:1.5;text-align:left;';
        var header = node('div', '', panel); header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;';
        node('h2', 'AG Auto', header).style.cssText = 'font:600 15px system-ui,sans-serif;margin:0;color:#f1f5ff;';
        var close = button('×', function () { panel.hidden = true; pill.setAttribute('aria-expanded', 'false'); pill.focus(); }, header);
        close.setAttribute('aria-label', 'Đóng'); close.style.cssText += 'padding:0;width:26px;height:26px;background:transparent;border-color:transparent;font-size:20px;color:#98a9bf;';
        if (managed) {
            var bot = button('🤖 BOT Auto Order', function () { if (!stopped && permitted() && ipc) ipc.send(config.management.channel + ':bot'); }, panel);
            bot.style.cssText += 'display:flex;width:100%;margin-bottom:12px;background:#1b2f49;border-color:#304c70;color:#a7cdff;';
        }
        var enabledLabel = node('label', '', panel);
        enabledLabel.style.cssText = 'display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:9px;background:#1d2b40;cursor:pointer;font-weight:500;';
        toggle = node('input', '', enabledLabel); toggle.type = 'checkbox'; toggle.id = 'ag-auto-agent-enabled';
        toggle.style.cssText = 'appearance:auto;width:16px;height:16px;margin:0;accent-color:#79a9ff;cursor:pointer;';
        node('span', 'Tự động bấm', enabledLabel);
        toggle.addEventListener('change', function () { update({ enabled: toggle.checked }); });
        node('div', 'Nút cần bấm', panel).style.cssText = 'margin:14px 0 6px;color:#b9c8dc;font-weight:500;';
        var grid = node('div', '', panel); grid.id = 'ag-auto-agent-patterns';
        grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', 'Nút cần bấm');
        grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:8px;';
        patternChecks = patternChoices.map(function (name) {
            var label = node('label', '', grid);
            label.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px;border:1px solid #35445b;border-radius:8px;background:#0e1725;cursor:pointer;';
            var input = node('input', '', label); input.type = 'checkbox'; input.id = 'ag-auto-agent-pattern-' + name.toLowerCase();
            input.style.cssText = 'appearance:auto;width:15px;height:15px;margin:0;accent-color:#79a9ff;cursor:pointer;';
            node('span', name, label);
            input.addEventListener('change', function () { update({ patterns: selectedPatterns() }); });
            return input;
        });
        var speedRow = node('div', '', panel); speedRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin:14px 0;';
        var intervalLabel = node('label', 'Chu kỳ (ms)', speedRow); intervalLabel.htmlFor = 'ag-auto-agent-interval'; intervalLabel.style.cssText = 'color:#b9c8dc;font-weight:500;';
        intervalInput = node('input', '', speedRow); intervalInput.id = 'ag-auto-agent-interval'; intervalInput.type = 'number'; intervalInput.min = '250'; intervalInput.max = '60000'; intervalInput.step = '50';
        intervalInput.style.cssText = 'box-sizing:border-box;width:96px;padding:7px 9px;border:1px solid #35445b;border-radius:8px;background:#0e1725;color:#e4edfc;font:12px system-ui,sans-serif;';
        var actions = node('div', '', panel); actions.style.cssText = 'display:flex;align-items:center;gap:8px;';
        var save = button('Lưu', function () { update({ enabled: toggle.checked, patterns: selectedPatterns(), interval: intervalInput.value }); }, actions);
        save.style.cssText += 'background:#729fff;border-color:#729fff;color:#09172b;font-weight:700;min-width:72px;';
        var reset = button('Đặt lại', importSeed, actions); reset.title = 'Dùng cấu hình IDE lúc tích hợp';
        status = node('span', '', actions); status.setAttribute('role', 'status'); status.style.cssText = 'margin-left:auto;color:#8fa4bd;font-size:11px;';

        root.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') { panel.hidden = true; pill.setAttribute('aria-expanded', 'false'); pill.focus(); }
        });
        paint();
    }
    function canonical(text) { return String(text || '').replace(/[↵⏎⤶]/g, '').replace(/\s+/g, ' ').trim().toLocaleLowerCase(); }
    function safe(el) {
        if (!el || !el.isConnected || el.disabled || el.getAttribute('aria-disabled') === 'true') return false;
        if (el.closest('#ag-auto-agent-root, [data-ag-auto-agent], [inert], [hidden], [aria-hidden="true"], [aria-disabled="true"], fieldset[disabled]')) return false;
        if (el.closest('[contenteditable], textarea, form, [role="textbox"], [data-testid*="composer"], [class*="composer"], [class*="chat-input"], [class*="chatInput"], [class*="input-box"]')) return false;
        if (el.closest('[role="radio"], [role="option"], [role="checkbox"], [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"], [data-state="checked"], [data-state="selected"]')) return false;
        if (!el.getClientRects().length) return false;
        for (var p = el; p && p.nodeType === 1; p = p.parentElement) {
            var style = win.getComputedStyle(p);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || Number(style.opacity) === 0 || style.pointerEvents === 'none') return false;
        }
        return true;
    }
    function scan() {
        if (stopped || !permitted()) return 0;
        var s = settings(); if (!s.enabled || !s.patterns.length) return 0;
        var wanted = s.patterns.map(canonical);
        var candidates = doc.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"]');
        var now = Date.now();
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i]; if (!safe(el)) continue;
            var text = canonical(el.textContent || el.getAttribute('aria-label') || el.value);
            var description = canonical(text + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || ''));
            // Never automate denials, persistent grants, write-ins, or selected choices.
            if (/\b(always|forever|permanent|workspace|all conversations|deny|reject|cancel|decline|never|write.?in|other|selected|chosen|send)\b|luôn|vĩnh viễn|từ chối|hủy|gửi/.test(description)) continue;
            if (wanted.indexOf(text) === -1) continue;
            if (lastClicks.has(el) && now - lastClicks.get(el) < Math.max(1500, s.interval)) continue;
            lastClicks.set(el, now); el.click(); return 1; // At most one action per tick.
        }
        return 0;
    }
    var recentBgApprovals = new Map();
    var cachedCsrf = null;
    var bgScanning = false;

    function utf8Encode(str) {
        if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
        if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8');
        var bytes = [];
        for (var i = 0; i < str.length; i++) {
            var code = str.charCodeAt(i);
            if (code < 0x80) bytes.push(code);
            else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else if (code < 0xd800 || code >= 0xe000) {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            } else {
                i++;
                code = 0x10000 + (((code & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
                bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 0x3f), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            }
        }
        return new Uint8Array(bytes);
    }

    function utf8Decode(bytes) {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
        if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('utf8');
        var str = '', i = 0;
        while (i < bytes.length) {
            var b1 = bytes[i++];
            if (b1 < 0x80) str += String.fromCharCode(b1);
            else if (b1 > 0xbf && b1 < 0xe0) {
                var b2 = bytes[i++];
                str += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
            } else if (b1 > 0xdf && b1 < 0xf0) {
                var b2 = bytes[i++], b3 = bytes[i++];
                str += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
            } else {
                var b2 = bytes[i++], b3 = bytes[i++], b4 = bytes[i++];
                var cp = (((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)) - 0x10000;
                str += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
            }
        }
        return str;
    }

    function makeGrpcFrame(jsonObj) {
        var str = JSON.stringify(jsonObj);
        var payload = utf8Encode(str);
        var frame = new Uint8Array(5 + payload.length);
        frame[0] = 0;
        var len = payload.length;
        frame[1] = (len >>> 24) & 0xff;
        frame[2] = (len >>> 16) & 0xff;
        frame[3] = (len >>> 8) & 0xff;
        frame[4] = len & 0xff;
        frame.set(payload, 5);
        return frame;
    }

    function parseGrpcFrame(arrayBuffer) {
        var u8 = new Uint8Array(arrayBuffer);
        var result = null;
        var offset = 0;
        while (offset + 5 <= u8.length) {
            var flag = u8[offset];
            var len = (u8[offset + 1] * 16777216) + (u8[offset + 2] << 16) + (u8[offset + 3] << 8) + u8[offset + 4];
            offset += 5;
            if (offset + len > u8.length) break;
            if (flag === 0) {
                try {
                    var chunk = u8.subarray(offset, offset + len);
                    var text = utf8Decode(chunk);
                    result = JSON.parse(text);
                } catch (_) {}
            }
            offset += len;
        }
        return result;
    }

    function getCsrf() {
        if (win.__APP_CONFIG__ && win.__APP_CONFIG__.csrfToken) return Promise.resolve(win.__APP_CONFIG__.csrfToken);
        if (cachedCsrf) return Promise.resolve(cachedCsrf);
        if (typeof win.fetch !== 'function') return Promise.resolve(null);
        return win.fetch('/').then(function (r) { return r.text(); }).then(function (html) {
            var m = html.match(/(?:"csrfToken"|csrfToken)\s*:\s*"([^"\r\n]+)"/);
            if (m) cachedCsrf = m[1];
            return cachedCsrf;
        }).catch(function () { return null; });
    }

    function scanBackground() {
        if (stopped || !permitted() || bgScanning || typeof win.fetch !== 'function') return Promise.resolve(0);
        var s = settings(); if (!s.enabled || !s.patterns.length) return Promise.resolve(0);
        var hasAllow = s.patterns.some(function (p) { return /allow|accept|submit/i.test(p); });
        var hasRun = s.patterns.some(function (p) { return /run|submit|allow|accept/i.test(p); });
        var hasSubmit = s.patterns.some(function (p) { return /submit/i.test(p); });
        if (!hasAllow && !hasRun && !hasSubmit) return Promise.resolve(0);

        bgScanning = true;
        return getCsrf().then(function (token) {
            if (!token || stopped || !permitted()) return 0;
            var frame = makeGrpcFrame({});
            return win.fetch('/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/grpc-web+json',
                    'X-Grpc-Web': '1',
                    'x-codeium-csrf-token': token
                },
                body: frame
            }).then(function (res) {
                return res.arrayBuffer();
            }).then(function (buf) {
                var data = parseGrpcFrame(buf);
                if (!data || !data.trajectorySummaries) return 0;
                var now = Date.now();
                recentBgApprovals.forEach(function (val, key) {
                    if (now - val > 60000) recentBgApprovals.delete(key);
                });
                var approvedCount = 0;
                var summaries = Object.values(data.trajectorySummaries);
                for (var j = 0; j < summaries.length; j++) {
                    var sum = summaries[j];
                    if (!sum || !sum.waitingSteps || !sum.waitingSteps.length) continue;
                    for (var k = 0; k < sum.waitingSteps.length; k++) {
                        var w = sum.waitingSteps[k];
                        if (!w || !w.step) continue;
                        var step = w.step;
                        var stepIndex = w.stepIndex != null ? w.stepIndex : 0;
                        var cascadeId = sum.cascadeId || (step.metadata && step.metadata.sourceTrajectoryStepInfo && step.metadata.sourceTrajectoryStepInfo.cascadeId);
                        var trajectoryId = sum.trajectoryId || (step.metadata && step.metadata.sourceTrajectoryStepInfo && step.metadata.sourceTrajectoryStepInfo.trajectoryId);
                        if (!cascadeId || !trajectoryId) continue;

                        var dedupeKey = cascadeId + ':' + stepIndex;
                        if (recentBgApprovals.has(dedupeKey) && now - recentBgApprovals.get(dedupeKey) < Math.max(3000, s.interval * 2)) continue;

                        var reqInt = step.requestedInteraction;
                        if (!reqInt) continue;

                        var payload = null;
                        if (reqInt.permission && (hasAllow || hasRun)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                permission: { allow: true, scope: "PERMISSION_SCOPE_ONCE" }
                            };
                        } else if (reqInt.runCommand && (hasRun || hasSubmit)) {
                            var cmd = (step.generic && step.generic.args && (step.generic.args.CommandLine || step.generic.args.commandLine)) || "";
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                runCommand: { confirm: true, proposedCommandLine: cmd, submittedCommandLine: cmd }
                            };
                        } else if (reqInt.approvalInteraction && (hasAllow || hasSubmit || hasRun)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                approvalInteraction: { confirm: true }
                            };
                        } else if (reqInt.filePermission && (hasAllow || hasRun)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                filePermission: {
                                    allow: true,
                                    scope: "PERMISSION_SCOPE_ONCE",
                                    absolutePathUri: (reqInt.filePermission && reqInt.filePermission.absolutePathUri) || ""
                                }
                            };
                        } else if (reqInt.openBrowserUrl && (hasAllow || hasRun || hasSubmit)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                openBrowserUrl: { confirm: true }
                            };
                        } else if (reqInt.executeBrowserJavascript && (hasRun || hasAllow || hasSubmit)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                executeBrowserJavascript: { confirm: true }
                            };
                        } else if (reqInt.mcp && (hasAllow || hasRun || hasSubmit)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                mcp: { confirm: true }
                            };
                        } else if (reqInt.readUrlContent && (hasAllow || hasSubmit)) {
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                readUrlContent: { confirm: true }
                            };
                        } else if (reqInt.askQuestion && hasSubmit) {
                            var questions = reqInt.askQuestion.questions || [];
                            payload = {
                                trajectoryId: trajectoryId,
                                stepIndex: stepIndex,
                                askQuestion: {
                                    responses: questions.map(function (q) {
                                        return {
                                            id: q.id,
                                            selectedOptionIds: (q.options && q.options.length) ? [q.options[0].id] : [],
                                            writeInResponse: "",
                                            skipped: false
                                        };
                                    }),
                                    cancelled: false
                                }
                            };
                        }

                        if (payload) {
                            recentBgApprovals.set(dedupeKey, now);
                            approvedCount++;
                            var approveFrame = makeGrpcFrame({
                                cascadeId: cascadeId,
                                interaction: payload
                            });
                            win.fetch('/exa.language_server_pb.LanguageServerService/HandleCascadeUserInteraction', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/grpc-web+json',
                                    'X-Grpc-Web': '1',
                                    'x-codeium-csrf-token': token
                                },
                                body: approveFrame
                            }).catch(function () {});
                        }
                    }
                }
                return approvedCount;
            });
        }).catch(function () {
            return 0;
        }).finally(function () {
            bgScanning = false;
        });
    }

    function tick() {
        timer = null; if (stopped) return;
        try { mount(); scan(); scanBackground(); } catch (_) { /* Transient page replacement must not kill remounting. */ }
        schedule();
    }
    function schedule() {
        if (timer != null) win.clearTimeout(timer);
        if (!stopped) timer = win.setTimeout(tick, settings().interval);
    }
    var api = {
        version: '10.5.0', destroyed: false, getSettings: settings, updateSettings: update,
        importSeed: importSeed, resetToSeed: importSeed, scan: scan, scanBackground: scanBackground, mount: mount,
        destroy: function () {
            stopped = true; api.destroyed = true;
            if (timer != null) win.clearTimeout(timer);
            if (managementTimer != null) win.clearTimeout(managementTimer);
            if (ipc && stateListener) ipc.removeListener(config.management.channel + ':state', stateListener);
            if (root) root.remove();
            if (win.__agAutoAgent === api) delete win.__agAutoAgent;
        }
    };
    win.__agAutoAgent = api;
    if (managed) {
        try {
            ipc = require('electron').ipcRenderer;
            stateListener = function (_event, active) {
                if (stopped) return;
                if (active !== true) { api.destroy(); return; }
                acknowledged = true; lastAck = Date.now(); mount();
            };
            ipc.on(config.management.channel + ':state', stateListener);
            ipc.send(config.management.channel + ':state');
            function watch() {
                if (stopped) return;
                if (!permitted() && root) { root.remove(); root = null; }
                ipc.send(config.management.channel + ':state');
                managementTimer = win.setTimeout(watch, 2000);
            }
            managementTimer = win.setTimeout(watch, 2000);
        } catch (_) { api.destroy(); }
    }
    persist(); mount(); schedule(); return api;
};
