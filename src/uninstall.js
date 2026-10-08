/**
 * AG Auto Click & Scroll - Standalone Uninstaller
 * Chạy tự động khi extension bị gỡ cài đặt từ VS Code / Antigravity IDE (hook: vscode:uninstall)
 */

const path = require('path');
const { requestCleanup } = require('./agentCleanup');

function runUninstall(options = {}) {
    // VS Code limits this hook to five seconds. Never discover apps or query
    // processes here: the independently copied worker performs disk restoration.
    const outcomes = requestCleanup({ extensionPath: path.resolve(__dirname, '..'), ...options });
    for (const outcome of outcomes) {
        console.log('[AG Auto Uninstaller]', outcome.code, outcome.agentRoot || '', outcome.error || '');
        if (outcome.code === 'CLEANUP_PENDING') console.log('Runtime stop requested; disk restoration waits for Agent to close. Pending cleanup resumes at Agent startup.');
        else if (!['SUPERSEDED'].includes(outcome.code)) process.exitCode = 1;
    }
    return outcomes;
}

module.exports = { runUninstall };
if (require.main === module) runUninstall();
