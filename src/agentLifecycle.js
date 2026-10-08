'use strict';

/** Injectable, consent-gated maintenance for Antigravity Agent 2.0. */
function createAgentLifecycle({ discover, inspect, fingerprint, isRunning, install,
    getConsent = () => false, requestConsent = async () => false,
    notify = () => {}, onState = () => {}, clock = {}, options = {} }) {
    const positive = (v, fallback) => Number.isFinite(v) && v > 0 ? v : fallback;
    const interval = positive(options.pollIntervalMs, 60000);
    const initialDelay = positive(options.initialBackoffMs, 1000);
    const maxDelay = positive(options.maxBackoffMs, 30000);
    const busyTimeout = positive(options.busyTimeoutMs, 300000);
    const now = () => typeof clock.now === 'function' ? clock.now() : Date.now();
    const later = clock.setTimeout ? clock.setTimeout.bind(clock) : setTimeout;
    const cancel = clock.clearTimeout ? clock.clearTimeout.bind(clock) : clearTimeout;
    let generation = 0, disposed = false, started = false, explicitConsent = null;
    let timer = null, active = null, pending = false, forceDiscovery = false, promptPending = false;
    let target = null, signature = null, status = null, busySince = null, backoff = initialDelay;
    let transactionSince = null, transactionBackoff = initialDelay;
    let state = { phase: 'idle', appFound: false, hookInstalled: false,
        hookVersion: null, updateNeeded: false, waitingForExit: false, waitingForTransaction: false, consent: false, error: null, target: null };
    const consent = () => explicitConsent !== false && getConsent() === true;
    const valid = token => !disposed && token === generation;
    const writable = token => valid(token) && consent();
    const observe = (fn, value) => { try { const result = fn(value); if (result && result.catch) result.catch(() => {}); } catch (_) { /* Observers cannot break maintenance. */ } };
    function publish(phase, extra = {}) {
        state = { ...state, transactionReason: null, transactionDiagnostics: null, ...extra, phase, consent: consent(), waitingForExit: phase === 'waitingForExit', waitingForTransaction: phase === 'waitingForTransaction', error: extra.error || null };
        observe(onState, { ...state });
    }
    const announced = new Set();
    function announce(code) {
        const key = code + ':' + (state.error || '');
        if (announced.has(key)) return;
        announced.add(key);
        observe(notify, { code, state: { ...state } });
    }
    function clearTimer() { if (timer !== null) cancel(timer); timer = null; }
    function schedule(delay = interval) {
        clearTimer();
        if (disposed || !started || explicitConsent === false) return;
        timer = later(() => { timer = null; enqueue(false, false); }, delay);
        if (timer && timer.unref) timer.unref();
    }
    function resetTarget() { target = null; signature = null; status = null; busySince = null; backoff = initialDelay; }
    function waitForExit() {
        if (busySince === null) busySince = now();
        publish('waitingForExit'); announce('WAITING_FOR_EXIT');
        // Expiring the fast polling budget must not abandon eventual maintenance.
        const delay = now() - busySince >= busyTimeout ? interval : Math.min(backoff, maxDelay);
        backoff = Math.min(backoff * 2, maxDelay); schedule(delay);
    }
    function resetTransaction() { transactionSince = null; transactionBackoff = initialDelay; }
    function waitForTransaction(result) {
        if (transactionSince === null) transactionSince = now();
        // Another installer may complete the work; inspect again before attempting a write.
        status = null;
        publish('waitingForTransaction', {
            transactionReason: result.reason || result.error || 'TRANSACTION_BUSY',
            transactionDiagnostics: result.diagnostics || null
        });
        const delay = now() - transactionSince >= busyTimeout ? interval : Math.min(transactionBackoff, maxDelay);
        transactionBackoff = Math.min(transactionBackoff * 2, maxDelay);
        schedule(delay);
    }
    async function cycle(token, force, mayPrompt) {
        try {
            if (target && !force) {
                const nextSignature = await fingerprint(target);
                if (!valid(token)) return;
                if (nextSignature !== signature) force = true;
            }
            if (!target || force) {
                publish('discovering');
                const targets = await discover();
                if (!valid(token)) return;
                resetTarget();
                if (!Array.isArray(targets)) throw new Error('INVALID_DISCOVERY_RESULT');
                if (targets.length !== 1) {
                    publish(targets.length ? 'ambiguous' : 'notFound', { appFound: targets.length > 0, target: null, hookInstalled: false, hookVersion: null, updateNeeded: false });
                    if (targets.length) announce('ambiguous');
                    schedule(); return;
                }
                target = targets[0];
                signature = await fingerprint(target);
                if (!valid(token)) return;
            }
            if (!status) {
                publish('checking', { appFound: true, target });
                const inspected = await inspect(target);
                if (!valid(token)) return;
                status = inspected;
                if (!status || status.appFound === false) {
                    resetTarget();
                    publish('notFound', { appFound: false, target: null, hookInstalled: false, hookVersion: null, updateNeeded: false });
                    schedule(); return;
                }
                publish('checking', { ...status, target });
            }
            if (status.blocked || status.error) throw new Error(status.error || status.reason || 'TARGET_BLOCKED');
            if (!consent() && mayPrompt && explicitConsent !== false) {
                publish('consentRequired');
                await requestConsent();
                if (!valid(token)) return;
            }
            if (!consent()) { publish(explicitConsent === false ? 'disabled' : 'consentRequired'); schedule(); return; }
            if (status.hookInstalled && !status.updateNeeded) {
                resetTransaction();
                publish('current', { ...status, target }); schedule(); return;
            }
            const running = await isRunning(target);
            if (!valid(token)) return;
            if (!consent()) { publish('disabled'); schedule(); return; }
            if (running) { waitForExit(); return; }
            busySince = null; backoff = initialDelay;
            publish('installing');
            if (!writable(token)) return;
            const result = await install(target, { shouldContinue: () => writable(token) });
            if (!valid(token)) return;
            if (!consent()) { publish('disabled'); schedule(); return; }
            if (result && (result.waitingForTransaction || result.code === 'TRANSACTION_BUSY' || result.error === 'TRANSACTION_BUSY')) { waitForTransaction(result); return; }
            resetTransaction();
            if (result && result.waitingForExit) { waitForExit(); return; }
            if (!result || !result.ok) throw new Error(result && result.error || 'INSTALL_FAILED');
            signature = await fingerprint(target);
            if (!valid(token)) return;
            if (!consent()) { publish('disabled'); schedule(); return; }
            status = { ...status, hookInstalled: true, updateNeeded: false, waitingForExit: false };
            publish('updated', { ...status, target });
            announced.delete('WAITING_FOR_EXIT:'); announce('INSTALLED'); schedule();
        } catch (error) {
            if (!valid(token)) return;
            if (error.code === 'TRANSACTION_BUSY' || error.message === 'TRANSACTION_BUSY') {
                if (!consent()) { publish('disabled'); schedule(); return; }
                waitForTransaction(error); return;
            }
            resetTransaction();
            status = null;
            publish(/MULTIPLE_AGENTS/.test(error.message || '') ? 'ambiguous' : 'error', { error: error.message || String(error) });
            announce(state.phase); schedule();
        }
    }
    function enqueue(force, mayPrompt) {
        if (disposed) return Promise.resolve({ ...state });
        pending = true; forceDiscovery = forceDiscovery || force; promptPending = promptPending || mayPrompt;
        if (!active) {
            // Assign the single flight before invoking user-supplied dependencies.
            active = Promise.resolve().then(async () => {
                while (pending && !disposed) {
                    pending = false;
                    const token = generation, force = forceDiscovery, prompt = promptPending;
                    forceDiscovery = false; promptPending = false;
                    await cycle(token, force, prompt);
                }
            }).finally(() => { active = null; });
        }
        return active.then(() => ({ ...state }));
    }
    return {
        start() {
            if (disposed || started) return active || Promise.resolve({ ...state });
            started = true; return enqueue(true, true);
        },
        retry() {
            if (disposed) return Promise.resolve({ ...state });
            started = true; generation++; resetTransaction(); clearTimer(); return enqueue(true, false);
        },
        setConsent(enabled) {
            if (disposed) return Promise.resolve({ ...state });
            explicitConsent = enabled === true; generation++; resetTransaction(); clearTimer();
            if (!explicitConsent) {
                pending = false; promptPending = false; publish('disabled');
                return Promise.resolve({ ...state });
            }
            started = true; return enqueue(true, false);
        },
        getState: () => ({ ...state }),
        dispose() {
            if (!disposed) { disposed = true; generation++; pending = false; clearTimer(); publish('disposed'); }
            return Promise.resolve({ ...state });
        }
    };
}
module.exports = { createAgentLifecycle };
