'use strict';
const fs = process.versions.electron ? require('original-fs') : require('fs');
const path = require('path');
const { createAgentLifecycle } = require('./agentLifecycle');

/** Keep UI permissions and messaging out of the injectable lifecycle state machine. */
function attachAgentLifecycle({ vscode, context, integration, output, getSeed, onState }) {
    const cfg = () => vscode.workspace.getConfiguration('ag-auto');
    const vi = () => cfg().get('language', 'vi') === 'vi';
    const text = (vn, en) => vi() ? vn : en;
    const consent = () => cfg().get('autoIntegrateAgent', false) === true;
    let controller, disposed = false, consentGeneration = 0, writingConsent = false;
    let consentWrites = Promise.resolve();
    const publish = state => { if (!disposed) onState(state, consent()); };
    function writeConsent(enabled, generation) {
        const write = consentWrites.then(async () => {
            if (disposed || generation !== consentGeneration) return false;
            writingConsent = true;
            try { await cfg().update('autoIntegrateAgent', enabled, vscode.ConfigurationTarget.Global); }
            finally { writingConsent = false; }
            return !disposed && generation === consentGeneration;
        });
        consentWrites = write.catch(() => {});
        return write;
    }
    async function setConsent(enabled, explicit = false) {
        const generation = ++consentGeneration;
        if (disposed) return false;
        if (enabled && explicit && !consent()) {
            const yes = text('Bật tự tích hợp', 'Enable automatic integration');
            const answer = await vscode.window.showInformationMessage(text(
                'Cho phép AG Auto tự cài/cập nhật tích hợp Antigravity Agent 2.0 khi Agent đã đóng? Không tự đóng ứng dụng. Gỡ extension sẽ yêu cầu gỡ tích hợp theo.',
                'Allow AG Auto to modify Antigravity Agent 2.0 application files to maintain integration while Agent is closed? It never closes Agent. Uninstalling the extension and restarting the IDE requests automation stop and file restoration once Agent exits.'), { modal: true }, yes);
            if (answer !== yes) { publish(controller.getState()); return false; }
        }
        if (disposed || generation !== consentGeneration) return false;
        await context.globalState.update('agentAutomationConsentAsked', true);
        if (!(await writeConsent(enabled, generation))) return false;
        await controller.setConsent(consent());
        publish(controller.getState());
        return consent();
    }
    controller = createAgentLifecycle({
        getConsent: consent,
        requestConsent: async () => {
            if (context.globalState.get('agentAutomationConsentAsked', false)) return false;
            const generation = consentGeneration;
            await context.globalState.update('agentAutomationConsentAsked', true);
            if (disposed || generation !== consentGeneration) return false;
            const yes = text('Bật tự tích hợp', 'Enable automatic integration');
            const answer = await vscode.window.showInformationMessage(text(
                'AG Auto có thể tự tìm và cập nhật tích hợp Antigravity Agent 2.0. Chỉ cài khi Agent đã đóng; không cần chọn thư mục hoặc mở Command Palette.',
                'Allow AG Auto to find and modify Antigravity Agent 2.0 application files for integration while Agent is closed? It never closes Agent. Uninstalling the extension and restarting the IDE requests automation stop and restoration once Agent exits.'), yes, text('Để sau', 'Later'));
            if (answer !== yes || disposed || generation !== consentGeneration) return false;
            return (await writeConsent(true, generation)) && consent();
        },
        discover: async () => {
            const diagnostics = [];
            const found = integration.getAgentPaths({ agentPath: cfg().get('agentPath', ''), allowFallback: true, diagnostics });
            output.appendLine(JSON.stringify({ operation: 'auto-discover', found: found && found.agentRoot, diagnostics }));
            if (!found && diagnostics.some(x => x.code === 'MULTIPLE_AGENTS')) throw new Error('MULTIPLE_AGENTS: ' + text('Chọn một bản Agent trong Detect & Sync.', 'Choose one Agent with Detect & Sync.'));
            return found ? [found] : [];
        },
        inspect: async target => integration.getAgentStatus({ paths: target }),
        fingerprint: async target => JSON.stringify([target.agentRoot, target.resourcesDir, target.asarPath, target.markerPath, target.preloadPath, target.mainPath, target.appDir && path.join(target.appDir, 'package.json'), typeof integration.targetRecord === 'function' ? integration.targetRecord(target) : null].map(file => {
            if (!file) return null;
            try { const s = fs.statSync(file); return [file, s.size, s.mtimeMs, s.ctimeMs]; }
            catch (e) { if (e.code === 'ENOENT') return [file, 'missing']; throw e; }
        })),
        isRunning: async target => integration.isPathRunning(target),
        install: async (target, { shouldContinue } = {}) => {
            if (disposed || !consent() || (shouldContinue && !shouldContinue())) return { ok: false, error: 'CONSENT_REVOKED' };
            const seed = getSeed();
            const result = integration.installAgentHook(seed.patterns, seed.interval, seed.enabled, { agentPath: target.agentRoot, shouldContinue: () => !disposed && consent() && (!shouldContinue || shouldContinue()) });
            output.appendLine(JSON.stringify({ operation: 'auto-install', result }));
            if (result.success && cfg().get('agentPath', '') !== target.agentRoot) await cfg().update('agentPath', target.agentRoot, vscode.ConfigurationTarget.Global);
            return { ...result, ok: result.success, waitingForExit: result.code === 'AGENT_RUNNING', waitingForTransaction: result.code === 'TRANSACTION_BUSY', error: result.error || result.code };
        },
        onState: publish,
        notify: ({ code, state }) => {
            const phase = state && state.phase;
            output.appendLine(JSON.stringify({ operation: 'auto-state', code, state }));
            // Show only actionable transitions; the panel carries detailed progress.
            if (code === 'TRANSACTION_BUSY' || code === 'WAITING_FOR_TRANSACTION' || phase === 'waitingForTransaction') return;
            if (code === 'WAITING_FOR_EXIT' || phase === 'waitingForExit') vscode.window.showInformationMessage(text('Antigravity Agent 2.0 đang mở. Lưu công việc rồi thoát Agent; AG Auto sẽ tự hoàn tất khi IDE vẫn mở.', 'Antigravity Agent 2.0 is open. Save your work and quit Agent; AG Auto will finish automatically while the IDE stays open.'));
            else if (/INSTALLED|updated/i.test([code, phase].filter(Boolean).join(' '))) vscode.window.showInformationMessage(text('Đã cập nhật tích hợp Antigravity Agent 2.0 trên đĩa. Mở lại Agent để dùng AG Auto.', 'Antigravity Agent 2.0 integration updated on disk. Open Agent to use AG Auto.'));
            else if (/error|ambiguous|blocked/i.test([code, phase].filter(Boolean).join(' '))) {
                const action = text('Mở bảng AG Auto', 'Open AG Auto settings');
                vscode.window.showWarningMessage(text('Chưa thể tự tích hợp Antigravity Agent 2.0. Mở bảng AG Auto để xem trạng thái và thử lại.', 'Antigravity Agent 2.0 integration needs attention. Open AG Auto settings to review status and retry.'), action).then(choice => {
                    if (!disposed && choice === action) vscode.commands.executeCommand('ag-auto.openSettings');
                });
            }
        }
    });
    context.subscriptions.push(vscode.commands.registerCommand('ag-auto.setAgentAutomation', enabled => setConsent(enabled === true, true)));
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('ag-auto.autoIntegrateAgent')) {
            if (writingConsent || disposed) return;
            consentGeneration++;
            controller.setConsent(consent()).catch(e => output.appendLine(e.stack || e.message));
        }
        if (event.affectsConfiguration('ag-auto.agentPath')) controller.retry().catch(e => output.appendLine(e.stack || e.message));
    }));
    const timer = setTimeout(() => controller.start().catch(e => output.appendLine(e.stack || e.message)), 3000);
    const api = { retry: () => controller.retry(), getState: () => controller.getState(), setConsent: enabled => setConsent(enabled, true), dispose() { disposed = true; clearTimeout(timer); controller.dispose(); } };
    context.subscriptions.push(api);
    return api;
}
module.exports = { attachAgentLifecycle };
