'use strict';

/**
 * Offline observer of JSON JetboxSubscribeToSummaries responses.
 * This factory has no external dependencies and can be serialized on its own.
 * It deliberately exposes no write/approval/dispatch/focus callback or transport.
 * Conversation IDs in policy are exact native cascade IDs, not titles or prefixes.
 */
function createAgentBackgroundAnalyzer(initialPolicy) {
  const kinds = ['permission', 'runCommand', 'approvalInteraction'];
  const summaries = new Map();
  let enabled = false;
  let allowed = new Set();

  function record(value) {
    return value !== null && typeof value === 'object' &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null);
  }
  function identity(value) {
    return typeof value === 'string' && value.length > 0 && value.trim() === value;
  }
  function counts() {
    return { permission: 0, runCommand: 0, approvalInteraction: 0 };
  }
  function reset() {
    summaries.clear();
  }
  function setPolicy(policy) {
    // Replacing policy always invalidates the snapshot, including when disabled.
    reset();
    enabled = false;
    allowed = new Set();
    if (!record(policy) || policy.enabled !== true ||
        (policy.dryRun !== undefined && policy.dryRun !== true) ||
        !Array.isArray(policy.conversationIds) ||
        !policy.conversationIds.every(identity)) return;
    allowed = new Set(policy.conversationIds);
    enabled = allowed.size > 0;
  }
  function summarize(cascadeId, summary) {
    if (!record(summary) || !identity(summary.trajectoryId) ||
        (Object.hasOwn(summary, 'waitingSteps') && !Array.isArray(summary.waitingSteps))) return null;
    // Some JSON producers include the identity redundantly: it must agree.
    if (Object.hasOwn(summary, 'cascadeId') && summary.cascadeId !== cascadeId) return null;
    const result = counts();
    const seen = new Set();
    for (const waiting of summary.waitingSteps || []) {
      if (!record(waiting)) return null;
      const index = Object.hasOwn(waiting, 'stepIndex') ? waiting.stepIndex : 0;
      if (!Number.isSafeInteger(index) || index < 0 || seen.has(index)) return null;
      seen.add(index);
      const step = waiting.step;
      if (!record(step) || step.status !== 'CORTEX_STEP_STATUS_WAITING' ||
          !record(step.metadata) || !record(step.metadata.sourceTrajectoryStepInfo)) return null;
      const source = step.metadata.sourceTrajectoryStepInfo;
      const sourceIndex = Object.hasOwn(source, 'stepIndex') ? source.stepIndex : 0;
      if (source.cascadeId !== cascadeId || source.trajectoryId !== summary.trajectoryId ||
          sourceIndex !== index) return null;
      const interaction = step.requestedInteraction;
      if (!record(interaction)) return null;
      const keys = Object.keys(interaction);
      // Native JSON union only. Protobuf-es {case,value}, unknown cases and
      // ambiguous multiple interaction fields are intentionally unsupported.
      if (keys.length !== 1 || !kinds.includes(keys[0]) || !record(interaction[keys[0]])) return null;
      result[keys[0]] += 1;
    }
    return result;
  }
  function report() {
    const total = counts();
    const conversations = [];
    for (const [id, value] of [...summaries.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const copy = counts();
      for (const kind of kinds) {
        copy[kind] = value[kind];
        total[kind] += value[kind];
      }
      conversations.push({ id: id.slice(0, Math.min(8, Math.max(1, id.length - 1))) + '…', counts: copy });
    }
    // No raw steps, commands, file names, titles, trajectories or full IDs.
    return { conversations, counts: total };
  }
  function ingest(input) {
    if (!enabled) return report();
    let response = input;
    if (typeof response === 'string') {
      try { response = JSON.parse(response); } catch (_) { reset(); return report(); }
    }
    if (!record(response) ||
        (Object.hasOwn(response, 'updates') && !record(response.updates)) ||
        (Object.hasOwn(response, 'deletes') &&
          (!Array.isArray(response.deletes) || !response.deletes.every(identity))) ||
        Object.keys(response).some(key => key !== 'updates' && key !== 'deletes')) {
      reset();
      return report();
    }
    for (const [id, summary] of Object.entries(response.updates || {})) {
      if (!allowed.has(id)) continue;
      // Invalid replacement must never preserve an earlier waiting snapshot.
      summaries.delete(id);
      const value = summarize(id, summary);
      if (value !== null) summaries.set(id, value);
    }
    // Deletes win over updates when both contain the same identity.
    for (const id of response.deletes || []) summaries.delete(id);
    return report();
  }
  setPolicy(initialPolicy);
  return Object.freeze({ ingest, report, setPolicy, reset, reconnect: reset });
}

module.exports = { createAgentBackgroundAnalyzer };
