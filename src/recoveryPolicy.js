'use strict';

const DEFAULT_RECOVERY_POLICY = Object.freeze({
    startupGraceMs: 60000,
    focusGraceMs: 60000,
    signalStaleMs: 45000,
    requiredMisses: 3,
    reloadHealthyConfirmations: 3,
    attemptWindowMs: 24 * 60 * 60 * 1000,
    attemptCooldownMs: 30 * 60 * 1000,
    maxAttemptsPerWindow: 2
});

function finiteTimestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeRecoveryJournal(value, now = Date.now(), policy = DEFAULT_RECOVERY_POLICY) {
    const source = value && typeof value === 'object' ? value : {};
    const cutoff = now - policy.attemptWindowMs;
    const attempts = Array.isArray(source.attempts)
        ? source.attempts.map(item => ({
            at: finiteTimestamp(item && item.at),
            identity: item && item.identity ? String(item.identity) : '',
            reason: item && item.reason ? String(item.reason) : ''
        })).filter(item => item.at >= cutoff && item.at <= now + 60000)
        : [];
    const pendingSource = source.pending && typeof source.pending === 'object' ? source.pending : null;
    const pendingAt = finiteTimestamp(pendingSource && pendingSource.at);

    return {
        attempts,
        pending: pendingAt ? {
            at: pendingAt,
            identity: pendingSource.identity ? String(pendingSource.identity) : '',
            ownerKey: pendingSource.ownerKey ? String(pendingSource.ownerKey) : '',
            reason: pendingSource.reason ? String(pendingSource.reason) : ''
        } : null,
        lastHealthyAt: finiteTimestamp(source.lastHealthyAt),
        lastFailureAt: finiteTimestamp(source.lastFailureAt),
        lastFailure: source.lastFailure ? String(source.lastFailure) : ''
    };
}

function getRepairBudget(journalValue, now = Date.now(), policy = DEFAULT_RECOVERY_POLICY) {
    const journal = normalizeRecoveryJournal(journalValue, now, policy);
    const latestAttempt = journal.attempts.reduce((latest, attempt) => Math.max(latest, attempt.at), 0);
    if (journal.pending) {
        return {
            allowed: false,
            reason: 'pending-confirmation',
            detail: 'The previous auto repair is waiting for a healthy new renderer; further automatic repair is locked until the user reloads.',
            journal
        };
    }
    if (journal.attempts.length >= policy.maxAttemptsPerWindow) {
        return { allowed: false, reason: 'daily-limit', detail: 'Auto repair limit reached (' + policy.maxAttemptsPerWindow + ' per 24 hours).', journal };
    }
    if (latestAttempt && now - latestAttempt < policy.attemptCooldownMs) {
        return { allowed: false, reason: 'cooldown', detail: 'Previous auto repair was too recent; repeated repair guard is active.', retryAfterMs: policy.attemptCooldownMs - (now - latestAttempt), journal };
    }
    return { allowed: true, reason: '', detail: '', journal };
}

function evaluateRecovery(input, policy = DEFAULT_RECOVERY_POLICY) {
    const now = finiteTimestamp(input && input.now) || Date.now();
    const misses = Math.max(0, Number(input && input.consecutiveMisses) || 0);
    const base = { shouldRepair: false, nextMisses: 0, phase: 'starting', reason: '', detail: '' };
    if (!input || !input.automationEnabled) return { ...base, phase: 'idle', reason: 'automation-off' };
    if (!input.windowFocused) return { ...base, phase: 'background', reason: 'window-background' };

    const activatedAt = finiteTimestamp(input.activatedAt) || now;
    const focusedAt = finiteTimestamp(input.focusedAt) || now;
    const ownerPollAt = finiteTimestamp(input.ownerPollAt);
    const runtimeHeartbeatAt = finiteTimestamp(input.runtimeHeartbeatAt);
    const ownerFresh = ownerPollAt > 0 && now - ownerPollAt <= policy.signalStaleMs;
    const runtimeFresh = runtimeHeartbeatAt > 0 && now - runtimeHeartbeatAt <= policy.signalStaleMs;
    const inGrace = now - activatedAt < policy.startupGraceMs || now - focusedAt < policy.focusGraceMs;
    if (inGrace) {
        if (ownerFresh || runtimeFresh) return { ...base, phase: 'healthy' };
        return { ...base, phase: 'starting', reason: 'grace-period', detail: 'Waiting for renderer startup/focus grace period.' };
    }
    if (!input.serverHealthy) {
        return { ...base, phase: 'connecting', reason: 'host-server-unavailable', detail: 'Extension Host IPC server is recovering; renderer repair is suppressed.' };
    }

    if (ownerFresh || runtimeFresh) return { ...base, phase: 'healthy' };

    const nextMisses = misses + 1;
    if (nextMisses < policy.requiredMisses) {
        return { ...base, nextMisses, phase: 'suspect', reason: 'renderer-signal-stale', detail: 'Renderer heartbeat is stale; waiting for confirmation ' + nextMisses + '/' + policy.requiredMisses + '.' };
    }

    const budget = getRepairBudget(input.journal, now, policy);
    if (!budget.allowed) {
        return { ...base, nextMisses, phase: 'blocked', reason: budget.reason, detail: budget.detail, retryAfterMs: budget.retryAfterMs || 0, journal: budget.journal };
    }
    return {
        ...base,
        nextMisses,
        phase: 'repairing',
        reason: input.injectionValid === false ? 'injection-missing' : 'renderer-heartbeat-lost',
        detail: input.injectionValid === false ? 'Injection marker or renderer script is missing.' : 'Both renderer owner poll and runtime heartbeat remained stale.',
        shouldRepair: true,
        journal: budget.journal
    };
}

function recordRepairAttempt(journalValue, attempt, policy = DEFAULT_RECOVERY_POLICY) {
    const now = finiteTimestamp(attempt && attempt.at) || Date.now();
    const journal = normalizeRecoveryJournal(journalValue, now, policy);
    const entry = {
        at: now,
        identity: attempt && attempt.identity ? String(attempt.identity) : '',
        ownerKey: attempt && attempt.ownerKey ? String(attempt.ownerKey) : '',
        reason: attempt && attempt.reason ? String(attempt.reason) : ''
    };
    journal.attempts.push({ at: entry.at, identity: entry.identity, reason: entry.reason });
    journal.pending = { ...entry };
    journal.lastFailureAt = 0;
    journal.lastFailure = '';
    return journal;
}

function recordRepairFailure(journalValue, failure, policy = DEFAULT_RECOVERY_POLICY) {
    const now = finiteTimestamp(failure && failure.at) || Date.now();
    const journal = normalizeRecoveryJournal(journalValue, now, policy);
    journal.pending = null;
    journal.lastFailureAt = now;
    journal.lastFailure = failure && failure.message ? String(failure.message) : 'auto-repair-failed';
    return journal;
}

function acknowledgeHealthyRenderer(journalValue, now = Date.now(), policy = DEFAULT_RECOVERY_POLICY) {
    const journal = normalizeRecoveryJournal(journalValue, now, policy);
    journal.pending = null;
    journal.lastHealthyAt = now;
    journal.lastFailureAt = 0;
    journal.lastFailure = '';
    // Attempts remain until the 24-hour window expires. A short-lived heartbeat
    // must never reopen the auto-repair budget.
    return journal;
}

function normalizeReloadVerification(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
        healthyCount: Math.max(0, Math.floor(Number(source.healthyCount) || 0)),
        lastHeartbeatAt: finiteTimestamp(source.lastHeartbeatAt),
        rendererInstanceId: source.rendererInstanceId ? String(source.rendererInstanceId) : ''
    };
}

function evaluateReloadVerification(stateValue, input, policy = DEFAULT_RECOVERY_POLICY) {
    const state = normalizeReloadVerification(stateValue);
    const now = finiteTimestamp(input && input.now) || Date.now();
    const heartbeatAt = finiteTimestamp(input && input.heartbeatAt);
    const rendererInstanceId = input && input.rendererInstanceId ? String(input.rendererInstanceId) : '';
    const requiredAt = finiteTimestamp(input && input.requiredAt);

    if (!heartbeatAt || heartbeatAt <= state.lastHeartbeatAt) {
        return { state, confirmed: false, accepted: false, reset: false, reason: 'duplicate-heartbeat' };
    }

    const nextBase = { healthyCount: 0, lastHeartbeatAt: heartbeatAt, rendererInstanceId };
    const reportFresh = heartbeatAt >= requiredAt && heartbeatAt <= now + 60000 && now - heartbeatAt <= policy.signalStaleMs;
    const ownerPollAt = finiteTimestamp(input && input.ownerPollAt);
    const runtimeHeartbeatAt = finiteTimestamp(input && input.runtimeHeartbeatAt);
    const ownerFresh = ownerPollAt > 0 && now - ownerPollAt <= policy.signalStaleMs;
    const runtimeFresh = runtimeHeartbeatAt > 0 && now - runtimeHeartbeatAt <= policy.signalStaleMs;
    const sameRenderer = !state.rendererInstanceId || state.rendererInstanceId === rendererInstanceId;
    const actualAcceptKnown = typeof (input && input.actualAcceptEnabled) === 'boolean';
    const actualScrollKnown = typeof (input && input.actualScrollEnabled) === 'boolean';
    const preferencesMatch = actualAcceptKnown && actualScrollKnown &&
        input.actualAcceptEnabled === !!input.expectedAcceptEnabled &&
        input.actualScrollEnabled === !!input.expectedScrollEnabled;
    const runtimeHealthy = !input.acceptDegraded && !input.scrollDegraded;

    if (!rendererInstanceId || !reportFresh || !ownerFresh || !runtimeFresh || !preferencesMatch || !runtimeHealthy) {
        let reason = 'runtime-degraded';
        if (!rendererInstanceId) reason = 'renderer-identity-missing';
        else if (!reportFresh) reason = 'heartbeat-stale';
        else if (!ownerFresh || !runtimeFresh) reason = 'signals-stale';
        else if (!preferencesMatch) reason = 'runtime-preference-mismatch';
        return { state: nextBase, confirmed: false, accepted: false, reset: state.healthyCount > 0, reason };
    }

    const healthyCount = (sameRenderer ? state.healthyCount : 0) + 1;
    const nextState = { healthyCount, lastHeartbeatAt: heartbeatAt, rendererInstanceId };
    const confirmed = healthyCount >= policy.reloadHealthyConfirmations;
    return {
        state: nextState,
        confirmed,
        accepted: true,
        reset: !sameRenderer && state.healthyCount > 0,
        reason: confirmed ? 'renderer-stably-healthy' : 'awaiting-healthy-confirmations'
    };
}

module.exports = {
    DEFAULT_RECOVERY_POLICY,
    normalizeRecoveryJournal,
    getRepairBudget,
    evaluateRecovery,
    recordRepairAttempt,
    recordRepairFailure,
    acknowledgeHealthyRenderer,
    normalizeReloadVerification,
    evaluateReloadVerification
};