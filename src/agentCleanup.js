'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const integration = require('./agentIntegration');
function prepareWorker(options = {}) {
    const executable = options.execPath || process.execPath;
    if (!options.skipRuntimeProbe) {
        const output = require('child_process').execFileSync(executable, ['-e', 'process.stdout.write("AG_AUTO_NODE_OK")'], { encoding: 'utf8', timeout: 3000, windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
        if (output !== 'AG_AUTO_NODE_OK') { const error = new Error('Cleanup runtime does not support Node execution'); error.code = 'HELPER_RUNTIME_UNAVAILABLE'; throw error; }
    }
    const dir = path.join(integration.managementRoot(options), 'worker-' + integration.VERSION + '-' + (options.generation || 'shared'));
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['agentCleanup.js', 'agentIntegration.js']) {
        const destination = path.join(dir, name);
        if (!fs.existsSync(destination) || !fs.readFileSync(destination).equals(fs.readFileSync(path.join(__dirname, name)))) fs.copyFileSync(path.join(__dirname, name), destination);
    }
    return path.join(dir, 'agentCleanup.js');
}
function spawnWorker(record, options = {}) {
    if (!record.workerPath || !fs.existsSync(record.workerPath)) return false;
    const child = (options.spawn || spawn)(options.execPath || record.helperExecPath || process.execPath, [record.workerPath, '--cleanup', record.recordPath, record.generation], { cwd: path.dirname(record.workerPath), detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    child.on('error', error => { try { fs.appendFileSync(record.recordPath + '.log', JSON.stringify({ time: Date.now(), code: 'HELPER_LAUNCH_FAILED', error: error.message }) + '\n'); } catch (_) {} }); child.unref(); return true;
}
function ownsRecord(record, options) {
    if (!options.extensionPath || path.resolve(record.extensionPath || '').toLowerCase() === path.resolve(options.extensionPath).toLowerCase()) return true;
    const current = String(options.extensionVersion || integration.VERSION).split('.').map(Number);
    const previous = String(record.version || '').split('.').map(Number);
    if (current.length !== 3 || previous.length !== 3 || [...current, ...previous].some(n => !Number.isSafeInteger(n))) return false;
    for (let i = 0; i < 3; i++) if (current[i] !== previous[i]) return current[i] > previous[i];
    return false;
}
function requestCleanup(options = {}) {
    const outcomes = [];
    for (const record of integration.getManagedTargets(options)) {
        // Normal updates do not invoke vscode:uninstall; stale versions cannot stop a newer owner.
        if (!ownsRecord(record, options) || record.completed) { outcomes.push({ code: 'SUPERSEDED', agentRoot: record.agentRoot }); continue; }
        let release;
        try {
            integration.atomicJSON(record.recordPath + '.' + record.generation + '.stop', { owner: integration.OWNER, generation: record.generation, requested: Date.now() });
            try { release = integration.acquireLock(integration.pathsFor(record.agentRoot)); }
            catch (error) {
                if (error.code !== 'TRANSACTION_BUSY') throw error;
                outcomes.push({ code: 'CLEANUP_PENDING', agentRoot: record.agentRoot, spawned: spawnWorker(record, options) });
                continue;
            }
            const current = JSON.parse(fs.readFileSync(record.recordPath, 'utf8'));
            if (current.generation !== record.generation || current.completed || !ownsRecord(current, options)) { outcomes.push({ code: 'SUPERSEDED' }); continue; }
            const next = { ...current, runtimeEnabled: false, pending: true, requested: Date.now() };
            integration.atomicJSON(record.recordPath, next);
            outcomes.push({ code: 'CLEANUP_PENDING', agentRoot: record.agentRoot, spawned: spawnWorker({ ...next, recordPath: record.recordPath }, options) });
        } catch (error) { outcomes.push({ code: error.code || 'CLEANUP_FAILED', error: error.message }); }
        finally { if (release) release(); }
    }
    return outcomes;
}
function cleanupOnce(recordPath, generation, options = {}) {
    let record;
    try { record = JSON.parse(fs.readFileSync(recordPath, 'utf8')); } catch (_) { return { success: true, code: 'RECORD_GONE' }; }
    if (record.owner !== integration.OWNER || record.generation !== generation || (!record.pending && !fs.existsSync(recordPath + '.' + generation + '.stop'))) return { success: true, code: 'SUPERSEDED' };
    return integration.uninstallAgentHook({ ...options, agentPath: record.agentRoot, generation, cleanupRecord: recordPath });
}
async function runWorker(recordPath, generation, options = {}) {
    const deadline = Date.now() + (options.maxDuration || 30 * 60 * 1000);
    do {
        const result = cleanupOnce(recordPath, generation, options);
        try { fs.appendFileSync(recordPath + '.log', JSON.stringify({ time: Date.now(), generation, code: result.code }) + '\n'); } catch (_) {}
        if (result.success || !['AGENT_RUNNING', 'TRANSACTION_BUSY', 'PROCESS_QUERY_FAILED'].includes(result.code)) {
            if (result.code === 'HOOK_REMOVED') {
                try {
                    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
                    const dir = path.dirname(record.workerPath || '');
                    if (record.generation === generation && record.completed && path.dirname(dir) === path.dirname(recordPath) && path.basename(dir) === 'worker-' + integration.VERSION + '-' + generation) fs.rmSync(dir, { recursive: true, force: true });
                } catch (_) { /* Completed cleanup is safe even if its bundle cannot be removed. */ }
            }
            return result;
        }
        await new Promise(resolve => setTimeout(resolve, options.retryMs || 5000));
    } while (Date.now() < deadline);
    // Pending survives the bounded worker and resumes at the next Agent startup.
    return { success: false, code: 'CLEANUP_PENDING' };
}
module.exports = { prepareWorker, spawnWorker, requestCleanup, cleanupOnce, runWorker };
if (require.main === module && process.argv[2] === '--cleanup') runWorker(process.argv[3], process.argv[4]).catch(() => { process.exitCode = 1; });
