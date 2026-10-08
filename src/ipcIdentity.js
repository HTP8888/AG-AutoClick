'use strict';
const crypto = require('crypto');

// Delivered through this window's status-item DOM, never a shared file/probe.
function createIpcIdentity() {
    const hostId = crypto.randomBytes(16).toString('hex');
    const pairingToken = crypto.randomBytes(32).toString('hex');
    let current = null;
    const retired = new Set();
    const validKey = value => typeof value === 'string' && /^[\w:-]{1,160}$/.test(value);
    const equal = (a, b) => typeof a === 'string' && typeof b === 'string' &&
        /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) &&
        crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    return {
        hostId,
        marker: 'ag-ipc-v3-' + hostId + '-' + pairingToken,
        claim(data, generation) {
            if (!data || !equal(data.pairingToken, pairingToken) || data.hostId !== hostId ||
                data.serverGeneration !== generation || !validKey(data.windowKey) || !validKey(data.rendererInstanceId)) return null;
            if (retired.has(data.rendererInstanceId)) return null;
            if (current && current.rendererInstanceId !== data.rendererInstanceId) {
                // Delayed handshakes cannot reclaim a replaced renderer session.
                if (retired.size >= 1024) return null;
                retired.add(current.rendererInstanceId);
                current = null;
            }
            if (!current || current.generation !== generation) {
                current = { windowKey: data.windowKey, rendererInstanceId: data.rendererInstanceId,
                    generation, sessionToken: crypto.randomBytes(32).toString('hex') };
            }
            if (current.windowKey !== data.windowKey) return null;
            return { sessionToken: current.sessionToken };
        },
        matches(data, generation) {
            return !!(current && data && data.windowKey === current.windowKey &&
                data.rendererInstanceId === current.rendererInstanceId && data.serverGeneration === generation &&
                current.generation === generation && equal(data.sessionToken, current.sessionToken));
        }
    };
}
module.exports = { createIpcIdentity };
