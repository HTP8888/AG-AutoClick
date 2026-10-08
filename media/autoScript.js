(function () {
    if (window._agAutoLoaded) return;
    window._agAutoLoaded = true;

    if (window._agToolIntervals) {
        window._agToolIntervals.forEach(clearInterval);
        window.removeEventListener('scroll', window._agScrollListener, true);
    }
    window._agToolIntervals = [];

    (function suppressCorruptBanner() {
        function dismissCorrupt() {
            var banners = document.querySelectorAll('.notifications-toasts .notification-toast, .notification-list-item');
            banners.forEach(function (banner) {
                var text = banner.textContent || '';
                if (text.indexOf('corrupt') === -1 && text.indexOf('reinstall') === -1) return;

                var closeBtn = banner.querySelector('.codicon-notifications-clear, .codicon-close, .action-label[aria-label*="Close"], .action-label[aria-label*="clear"], .clear-notification-action');
                if (closeBtn) {
                    closeBtn.click();
                    console.log('[AG Auto] Dismissed corrupt notification');
                } else {
                    banner.style.display = 'none';
                    console.log('[AG Auto] Hid corrupt notification');
                }
            });
        }

        dismissCorrupt();

        var attempts = 0;
        var timer = setInterval(function () {
            dismissCorrupt();
            if (++attempts > 30) clearInterval(timer);
        }, 1000);

        try {
            var observer = new MutationObserver(function () { dismissCorrupt(); });
            observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); }, 30000);
        } catch (e) { }
    })();

    var PAUSE_SCROLL_MS = /*{{PAUSE_SCROLL_MS}}*/7000;
    var CLICK_INTERVAL_MS = /*{{CLICK_INTERVAL_MS}}*/1000;
    var SCROLL_INTERVAL_MS = /*{{SCROLL_INTERVAL_MS}}*/500;
    var CLICK_PATTERNS = /*{{CLICK_PATTERNS}}*/["Allow", "Always Allow", "Allow in Workspace", "Run", "Submit", "Keep Waiting", "Accept all"];
    var CLICK_LIMITS = {}; // { pattern: maxClicks } — 0 or missing = unlimited
    var _agPatternClickCounts = {}; // { pattern: currentCount }

    window._agAcceptChatOnly = false;
    window._agAutoEnabled = false; // Default OFF — only server can turn ON
    window._agScrollEnabled = false; // Default OFF — requires server confirmation
    var _agExpectedEnabled = false;
    var _agExpectedScrollEnabled = false;
    var _agServerEverConnected = false;

    var AG_HTTP_PORT_START = 48787;
    var AG_HTTP_PORT_END = 48850;
    var AG_HTTP_PORT = 0;
    var _agPollCount = 0;
    var _agPollErrors = 0;
    var _agPollFailureStartedAt = 0;
    var _agPollInFlight = false;
    var _agPollRequestSeq = 0;
    var _agConnectionGeneration = 0;
    var _agConnectionState = 'disconnected';
    var _agPortScanning = false;
    var _agDiscoveryCallbacks = [];
    var _agDiscoveryRetryTimer = 0;
    var _agDiscoveryAttempts = 0;
    var _agLastPollSuccessAt = 0;
    var _agLastHealthReport = '';
    var _agLastHealthReportAt = 0;
    var _agRuntimeReportInFlight = false;
    var _agConnectedServerStartedAt = 0;
    var _agConnectedServerGeneration = '';
    var _agPendingStatsBatch = null;
    var _agStatsBatchSeq = 0;
    var _agSessionStats = {};
    var _agSessionTotal = 0;
    var _agLastContentChange = 0;
    var _agContentActiveUntil = 0;
    var _agManualPauseUntil = 0;
    var _agAutoScrollGuardUntil = 0;
    var _agScrollObserver = null;
    var _agObservedChatPanel = null;
    var _agObserverWatchdog = 0;
    var _agAutoScrollInterval = 0;
    var _agAutoScrollKickTimer = 0;
    var _agLastJumpButtonClickAt = 0;
    var isAutoScrolling = false;
    var WORKBENCH_DIR = /*{{WORKBENCH_DIR}}*/"";
    var _agWindowBindingKey = '';
    var _agWindowStartedAt = Date.now();
    var _agRendererInstanceId = 'renderer_' + _agWindowStartedAt + '_' + Math.random().toString(36).slice(2, 12);
    var _agHostId = '';
    var _agPairingToken = '';
    var _agSessionToken = '';
    var _agRequests = new Set();
    var _agScanGeneration = 0;
    var _agScanDeadline = 0;
    var _agRuntimeRequestSeq = 0;
    var _agLastWakeAt = 0;
    var AG_CONFIG_LEASE_MS = 15000;

    try {
        _agWindowBindingKey = sessionStorage.getItem('agAutoWindowBindingKey') || '';
        if (!_agWindowBindingKey) {
            _agWindowBindingKey = 'win_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
            sessionStorage.setItem('agAutoWindowBindingKey', _agWindowBindingKey);
        }
    } catch (_agStorageErr) {
        _agWindowBindingKey = 'win_fallback_' + Math.random().toString(36).slice(2, 10);
    }

    function _agOnce(fn) {
        var called = false;
        return function () {
            if (called) return false;
            called = true;
            fn.apply(null, arguments);
            return true;
        };
    }

    // Status-item containers remain in the DOM when hidden (no layout reads).
    // Require one unambiguous host marker; never guess by port or startup time.
    function _agReadPairingMarker() {
        var nodes = document.querySelectorAll('.part.statusbar .statusbar-item[id*=".ag-ipc-v3-"]');
        var found = null;
        for (var i = 0; i < nodes.length; i++) {
            var match = /\.ag-ipc-v3-([a-f0-9]{32})-([a-f0-9]{64})-(accept|scroll)$/.exec(nodes[i].id || '');
            if (!match) continue;
            if (found && (found.hostId !== match[1] || found.token !== match[2])) return null;
            found = { hostId: match[1], token: match[2] };
        }
        return found;
    }

    function _agRefreshPairing() {
        var marker = _agReadPairingMarker();
        if (!marker || (marker.hostId === _agHostId && marker.token === _agPairingToken)) return false;
        _agHostId = marker.hostId;
        _agPairingToken = marker.token;
        _agPauseForRecovery('host-changed', 'Window host identity changed; pairing again.', true);
        return true;
    }

    function _agGetBoundPort() {
        try {
            var port = Number(sessionStorage.getItem('agAutoBoundPort') || 0);
            return port >= AG_HTTP_PORT_START && port <= AG_HTTP_PORT_END ? port : 0;
        } catch (_) { return 0; }
    }
    function _agSetBoundPort(port) {
        try { sessionStorage.setItem('agAutoBoundPort', String(port)); } catch (_) { }
    }
    function _agInvalidateBoundPort() {
        try { sessionStorage.removeItem('agAutoBoundPort'); } catch (_) { }
    }
    function _agScoreCandidate(port, cfg) {
        return cfg && cfg.hostId === _agHostId ? 1 : 0;
    }

    function _agNextRetryDelay(attempt) {
        var delays = [1000, 2000, 4000, 8000, 15000, 30000];
        return delays[Math.min(Math.max(0, Number(attempt) || 0), delays.length - 1)];
    }

    function _agClampMs(value, fallback, minValue, maxValue) {
        var num = Number(value);
        if (!isFinite(num)) num = Number(fallback);
        if (!isFinite(num)) num = minValue;
        return Math.max(minValue, Math.min(maxValue, Math.round(num)));
    }

    function _agScrollPauseWindowMs() {
        return _agClampMs(PAUSE_SCROLL_MS, 7000, 1000, 60000);
    }

    function _agScrollTickMs() {
        return _agClampMs(SCROLL_INTERVAL_MS, 500, 100, 5000);
    }

    function _agContentActivityWindowMs() {
        return Math.max(2500, Math.min(8000, Math.round(_agScrollPauseWindowMs() * 0.6)));
    }

    function _agNormalizeNode(node) {
        if (!node) return null;
        if (node === window) return document.documentElement;
        if (node.nodeType === 3) return node.parentElement;
        return node.nodeType === 1 ? node : null;
    }

    function _agGetChatPanel() {
        return document.querySelector('.antigravity-agent-side-panel');
    }

    function _agIsInsideChatPanel(node) {
        var el = _agNormalizeNode(node);
        return !!(el && el.closest && el.closest('.antigravity-agent-side-panel'));
    }

    function _agIsInputArea(node) {
        var el = _agNormalizeNode(node);
        return !!(el && (
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'INPUT' ||
            el.isContentEditable ||
            (el.closest && (
                el.closest('textarea') ||
                el.closest('[contenteditable="true"]') ||
                el.closest('[contenteditable="plaintext-only"]') ||
                el.closest('.chat-input') ||
                el.closest('.interactive-input-part') ||
                el.closest('.interactive-input') ||
                el.closest('.monaco-inputbox') ||
                el.closest('.input-editor')
            ))
        ));
    }

    function _agKickAutoScrollSoon(delayMs) {
        if (_agAutoScrollKickTimer) return;
        _agAutoScrollKickTimer = setTimeout(function () {
            _agAutoScrollKickTimer = 0;
            _agRunAutoScrollTick();
        }, delayMs || 40);
    }

    function _agMarkContentActivity() {
        var now = Date.now();
        _agLastContentChange = now;
        _agContentActiveUntil = now + _agContentActivityWindowMs();
        _agKickAutoScrollSoon(40);
    }

    function _agSetConnectionState(nextState, detail) {
        if (_agConnectionState === nextState) return;
        _agConnectionState = nextState;
        console.log('[AG Auto] IPC state -> ' + nextState + (detail ? ' | ' + detail : ''));
    }

    function _agBuildStatusUrl(port, probe, extraQuery) {
        return 'http://127.0.0.1:' + port + '/ag-status?t=' + Date.now() +
            '&windowKey=' + encodeURIComponent(_agWindowBindingKey) +
            '&rendererInstanceId=' + encodeURIComponent(_agRendererInstanceId) +
            '&serverGeneration=' + encodeURIComponent(_agConnectedServerGeneration) +
            '&serverStartedAt=' + _agConnectedServerStartedAt +
            (probe ? '&probe=1' : '') + (extraQuery || '');
    }

    function _agStatusIsCompatible(cfg, probe) {
        if (!cfg || cfg.service !== 'ag-auto-click-scroll' || Number(cfg.protocolVersion) !== 3 ||
            !_agHostId || cfg.hostId !== _agHostId || !cfg.serverGeneration || cfg.bindRejected) return false;
        if (probe) return true;
        return typeof cfg.enabled === 'boolean' && cfg.ownerKey === _agWindowBindingKey &&
            cfg.rendererInstanceId === _agRendererInstanceId && cfg.serverGeneration === _agConnectedServerGeneration;
    }

    // Every request owns its timer and is also swept by wall-clock on wake/tick.
    function _agRequest(method, url, body, session, callback, timeoutMs) {
        var xhr = new XMLHttpRequest();
        var started = Date.now();
        var timeout = timeoutMs || 3000;
        var timer = 0;
        var request = { deadline: started + timeout, cancel: null };
        var finish = _agOnce(function (err, value) {
            clearTimeout(timer);
            _agRequests.delete(request);
            xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
            if (err) { try { xhr.abort(); } catch (_) { } }
            callback(err, value);
        });
        request.cancel = function () { finish(new Error('cancelled')); };
        request.expire = function () { finish(new Error('deadline')); };
        _agRequests.add(request);
        timer = setTimeout(request.expire, timeout);
        try {
            xhr.open(method, url, true);
            xhr.timeout = timeout;
            if (body !== null) xhr.setRequestHeader('Content-Type', 'application/json');
            if (session) xhr.setRequestHeader('X-AG-Session', session);
            xhr.onload = function () {
                if (Date.now() >= request.deadline || Date.now() < started) { request.expire(); return; }
                if (xhr.status !== 200) { finish(new Error('HTTP ' + xhr.status)); return; }
                var value;
                try { value = JSON.parse(xhr.responseText); } catch (err) { finish(err); return; }
                finish(null, value);
            };
            xhr.onerror = function () { finish(new Error('network-error')); };
            xhr.ontimeout = request.expire;
            xhr.onabort = request.cancel;
            xhr.send(body === null ? null : JSON.stringify(body));
        } catch (err) { finish(err); }
        return request;
    }

    function _agRequestStatus(port, options, callback) {
        options = options || {};
        return _agRequest('GET', _agBuildStatusUrl(port, !!options.probe, options.extraQuery), null,
            options.probe ? '' : _agSessionToken, callback, options.timeout || 3000);
    }

    function _agRunDiscoveryCallbacks(port, cfg) {
        var callbacks = _agDiscoveryCallbacks.slice();
        _agDiscoveryCallbacks = [];
        callbacks.forEach(function (callback) {
            try { callback(port, cfg); } catch (_callbackErr) { }
        });
    }

    function _agScheduleDiscovery(reason, immediate) {
        if (AG_HTTP_PORT > 0 || _agPortScanning) return;
        if (_agDiscoveryRetryTimer) {
            if (!immediate) return;
            clearTimeout(_agDiscoveryRetryTimer);
            _agDiscoveryRetryTimer = 0;
        }
        var delay = immediate ? 0 : _agNextRetryDelay(_agDiscoveryAttempts);
        _agSetConnectionState(delay ? 'backoff' : 'disconnected', reason + (delay ? '; retry in ' + delay + 'ms' : ''));
        _agDiscoveryRetryTimer = setTimeout(function () {
            _agDiscoveryRetryTimer = 0;
            _agDiscoverPort();
        }, delay);
    }

    function _agAcceptDiscoveredPort(port, cfg) {
        AG_HTTP_PORT = Number(port);
        _agConnectionGeneration++;
        _agPollErrors = 0;
        _agPollFailureStartedAt = 0;
        _agDiscoveryAttempts = 0;
        _agServerEverConnected = true;
        _agLastPollSuccessAt = Date.now();
        _agConnectedServerStartedAt = Number(cfg.serverStartedAt) || 0;
        _agConnectedServerGeneration = String(cfg.serverGeneration || '');
        _agSetBoundPort(port, cfg);
        _agSetConnectionState('connected', 'port ' + port + ', owner ' + _agWindowBindingKey);
        _agApplyConfig(cfg);
        _agRunDiscoveryCallbacks(port, cfg);
    }

    function _agDiscoverPort(callback) {
        if (callback) _agDiscoveryCallbacks.push(callback);
        if (_agPortScanning) return;
        _agRefreshPairing();
        if (!_agHostId) { _agScheduleDiscovery('waiting for window pairing marker', false); return; }
        if (_agDiscoveryRetryTimer) clearTimeout(_agDiscoveryRetryTimer);
        _agDiscoveryRetryTimer = 0;
        _agPortScanning = true;
        var scan = ++_agScanGeneration;
        _agScanDeadline = Date.now() + 30000;
        _agSetConnectionState('discovering', 'attempt ' + (_agDiscoveryAttempts + 1));
        function active() { return _agPortScanning && scan === _agScanGeneration; }
        function failScan(reason) {
            if (!active()) return;
            _agPortScanning = false;
            _agDiscoveryAttempts++;
            _agScheduleDiscovery(reason, false);
        }
        function pair(port, cfg) {
            _agRequest('POST', 'http://127.0.0.1:' + port + '/ag-pair', {
                hostId: _agHostId, pairingToken: _agPairingToken, windowKey: _agWindowBindingKey,
                rendererInstanceId: _agRendererInstanceId, serverGeneration: cfg.serverGeneration
            }, '', function (err, reply) {
                if (!active()) return;
                if (err || !reply || reply.hostId !== _agHostId || reply.ownerKey !== _agWindowBindingKey ||
                    reply.rendererInstanceId !== _agRendererInstanceId || reply.serverGeneration !== cfg.serverGeneration ||
                    !/^[a-f0-9]{64}$/.test(reply.sessionToken || '')) { failScan('pairing retry'); return; }
                _agSessionToken = reply.sessionToken;
                _agConnectedServerGeneration = reply.serverGeneration;
                _agConnectedServerStartedAt = Number(reply.serverStartedAt);
                _agRequestStatus(port, {}, function (error, config) {
                    if (!active()) return;
                    if (error || !_agStatusIsCompatible(config, false)) { failScan('config verification retry'); return; }
                    _agPortScanning = false;
                    _agAcceptDiscoveredPort(port, config);
                });
            });
        }
        var ports = [];
        var bound = _agGetBoundPort();
        if (bound) ports.push(bound);
        for (var p = AG_HTTP_PORT_START; p <= AG_HTTP_PORT_END; p++) if (p !== bound) ports.push(p);
        function batch(offset) {
            if (!active()) return;
            if (offset >= ports.length) { failScan('host unavailable'); return; }
            var slice = ports.slice(offset, offset + 8);
            var pending = slice.length;
            var candidate = null;
            slice.forEach(function (port) {
                _agRequestStatus(port, { probe: true, timeout: 1200 }, function (err, cfg) {
                    if (!active()) return;
                    if (!err && _agStatusIsCompatible(cfg, true)) candidate = { port: port, cfg: cfg };
                    if (--pending !== 0) return;
                    if (candidate) pair(candidate.port, candidate.cfg);
                    else batch(offset + slice.length);
                });
            });
        }
        batch(0);
    }

    function _agReportRuntimeState(payload, force) {
        if (!AG_HTTP_PORT || _agConnectionState !== 'connected' || _agRuntimeReportInFlight) return;
        var report = {
            acceptDegraded: !!(payload && payload.acceptDegraded),
            scrollDegraded: !!(payload && payload.scrollDegraded),
            actualAcceptEnabled: !!window._agAutoEnabled,
            actualScrollEnabled: !!window._agScrollEnabled,
            reason: payload && payload.reason ? String(payload.reason) : '',
            detail: payload && payload.detail ? String(payload.detail) : '',
            source: 'autoScript',
            windowKey: _agWindowBindingKey,
            startedAt: _agWindowStartedAt,
            rendererInstanceId: _agRendererInstanceId,
            serverStartedAt: _agConnectedServerStartedAt,
            serverGeneration: _agConnectedServerGeneration,
            sessionToken: _agSessionToken,
            sentAt: Date.now()
        };
        var signature = JSON.stringify([
            report.acceptDegraded,
            report.scrollDegraded,
            report.actualAcceptEnabled,
            report.actualScrollEnabled,
            report.reason,
            report.detail,
            AG_HTTP_PORT,
            report.serverGeneration
        ]);
        if (!force && signature === _agLastHealthReport && Date.now() - _agLastHealthReportAt < 15000) return;

        var requestPort = AG_HTTP_PORT;
        var requestGeneration = _agConnectionGeneration;
        var seq = ++_agRuntimeRequestSeq;
        _agRuntimeReportInFlight = true;
        _agRequest('POST', 'http://127.0.0.1:' + requestPort + '/api/runtime-state', report, '', function (err, response) {
            if (seq !== _agRuntimeRequestSeq) return;
            _agRuntimeReportInFlight = false;
            if (err || !response || response.ok !== true || requestPort !== AG_HTTP_PORT || requestGeneration !== _agConnectionGeneration) return;
            _agLastHealthReport = signature;
            _agLastHealthReportAt = Date.now();
        });
    }

    function _agApplyConfig(cfg) {
        _agConnectedServerStartedAt = Number(cfg.serverStartedAt) || _agConnectedServerStartedAt;
        _agConnectedServerGeneration = String(cfg.serverGeneration || _agConnectedServerGeneration || '');
        if (typeof cfg.enabled === 'boolean') {
            _agExpectedEnabled = cfg.enabled;
            if (window._agAutoEnabled !== cfg.enabled) {
                console.log('[AG Auto] ' + (cfg.enabled ? 'ON' : 'OFF') + ' (live toggle via HTTP)');
            }
            window._agAutoEnabled = cfg.enabled;
        }

        if (typeof cfg.scrollEnabled === 'boolean') {
            _agExpectedScrollEnabled = cfg.scrollEnabled;
            window._agScrollEnabled = cfg.scrollEnabled;
        }

        if (cfg.clickPatterns && Array.isArray(cfg.clickPatterns)) {
            CLICK_PATTERNS = cfg.clickPatterns.filter(function (pattern) { return pattern !== 'Accept'; });
        }

        if (typeof cfg.acceptInChatOnly === 'boolean') window._agAcceptChatOnly = cfg.acceptInChatOnly;

        if (cfg.clickLimits && typeof cfg.clickLimits === 'object') {
            var hasLimits = Object.keys(cfg.clickLimits).length > 0;
            if (hasLimits && JSON.stringify(CLICK_LIMITS) !== JSON.stringify(cfg.clickLimits)) {
                console.log('[AG Auto] Click limits updated:', JSON.stringify(cfg.clickLimits));
            }
            CLICK_LIMITS = cfg.clickLimits;
        }

        if (typeof cfg.pauseScrollMs === 'number') {
            PAUSE_SCROLL_MS = _agClampMs(cfg.pauseScrollMs, PAUSE_SCROLL_MS, 1000, 60000);
        }

        if (typeof cfg.scrollIntervalMs === 'number') {
            var nextScrollInterval = _agClampMs(cfg.scrollIntervalMs, SCROLL_INTERVAL_MS, 100, 5000);
            if (nextScrollInterval !== SCROLL_INTERVAL_MS) {
                SCROLL_INTERVAL_MS = nextScrollInterval;
                _agRestartAutoScrollLoop();
            }
        }

        if (typeof cfg.clickIntervalMs === 'number') {
            var nextClickInterval = _agClampMs(cfg.clickIntervalMs, CLICK_INTERVAL_MS, 100, 120000);
            if (nextClickInterval !== CLICK_INTERVAL_MS) {
                CLICK_INTERVAL_MS = nextClickInterval;
                _agRestartClickLoop();
            }
        }

        if (cfg.clickStats) window._agClickStats = cfg.clickStats;
        if (typeof cfg.totalClicks === 'number') window._agTotalClicks = cfg.totalClicks;

        if (cfg.resetStats) {
            window._agClickStats = {};
            window._agTotalClicks = 0;
            _agSessionStats = {};
            _agSessionTotal = 0;
            _agPendingStatsBatch = null;
            console.log('[AG Auto] Stats reset by user');
        }

        _agReportRuntimeState({
            acceptDegraded: false,
            scrollDegraded: false,
            reason: '',
            detail: ''
        });
    }

    function _agHasMeaningfulMutation(mutation) {
        var node = _agNormalizeNode(mutation.target);
        if (!node || !_agIsInsideChatPanel(node) || _agIsInputArea(node)) return false;

        if (mutation.type === 'characterData') return true;

        if (mutation.type === 'childList') {
            return mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0;
        }

        if (mutation.type === 'attributes') {
            return ['class', 'style', 'aria-expanded', 'aria-busy', 'open', 'data-state'].indexOf(mutation.attributeName || '') !== -1;
        }

        return false;
    }

    function _agEnsureScrollObserver() {
        var chatPanel = _agGetChatPanel();
        if (!chatPanel) return false;

        if (_agObservedChatPanel === chatPanel && _agScrollObserver) return true;

        if (_agScrollObserver) {
            try { _agScrollObserver.disconnect(); } catch (e) { }
        }

        _agObservedChatPanel = chatPanel;
        _agScrollObserver = new MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                if (_agHasMeaningfulMutation(mutations[i])) {
                    _agMarkContentActivity();
                    return;
                }
            }
        });

        _agScrollObserver.observe(chatPanel, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'aria-expanded', 'aria-busy', 'open', 'data-state']
        });

        _agMarkContentActivity();
        console.log('[AG Auto] Smart scroll observer attached/refreshed');
        return true;
    }

    function _agElementDepth(el) {
        var depth = 0;
        while (el && el.parentElement) {
            depth++;
            el = el.parentElement;
        }
        return depth;
    }

    function _agCollectScrollTargets(chatPanel) {
        var nodes = [chatPanel].concat(Array.from(chatPanel.querySelectorAll('*')));
        return nodes.filter(function (el) {
            if (!el || el.nodeType !== 1) return false;
            if (!el.closest || !el.closest('.antigravity-agent-side-panel')) return false;
            if (el.closest('.monaco-editor') || el.closest('.part.editor')) return false;
            if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return false;

            var style = window.getComputedStyle(el);
            var overflowY = style.overflowY;
            var hasScrollbar = el.scrollHeight > (el.clientHeight + 4);
            if (!hasScrollbar) return false;

            return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
        }).sort(function (a, b) {
            return _agElementDepth(b) - _agElementDepth(a);
        });
    }

    function _agScrollElementToBottom(el) {
        var maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        var gap = maxScrollTop - el.scrollTop;
        if (gap <= 2) return false;

        try {
            el.scrollTo({ top: maxScrollTop, behavior: 'auto' });
        } catch (e) {
            el.scrollTop = maxScrollTop;
        }

        return true;
    }

    function _agGetLargestScrollGap(scrollables) {
        var maxGap = 0;
        scrollables.forEach(function (el) {
            var gap = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
            if (gap > maxGap) maxGap = gap;
        });
        return maxGap;
    }

    function _agFindJumpToBottomButton(chatPanel) {
        if (!chatPanel) return null;

        var panelRect = chatPanel.getBoundingClientRect();
        if (!panelRect || panelRect.width <= 0 || panelRect.height <= 0) return null;

        var candidates = Array.from(chatPanel.querySelectorAll('button, [role="button"]'));
        var best = null;
        var bestScore = -Infinity;

        candidates.forEach(function (btn) {
            if (!btn || btn.offsetParent === null) return;
            if (_agIsInputArea(btn)) return;
            if (btn.closest && (btn.closest('.monaco-editor') || btn.closest('.part.editor'))) return;

            var rect = btn.getBoundingClientRect();
            if (!rect || rect.width < 16 || rect.height < 16 || rect.width > 72 || rect.height > 72) return;

            var gapRight = panelRect.right - rect.right;
            var gapBottom = panelRect.bottom - rect.bottom;
            if (gapRight < -4 || gapBottom < -4) return;
            if (gapRight > 120 || gapBottom > 160) return;

            var rawText = ((btn.innerText || btn.textContent || '') + ' ' + (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '')).trim();
            var text = rawText.replace(/\s+/g, ' ').trim();
            var lower = text.toLowerCase();
            var hasSvg = !!btn.querySelector('svg, path, [data-icon], .codicon');

            var isDownSemantic = lower === '↓' ||
                lower === '▼' ||
                lower === '⌄' ||
                /scroll|bottom|latest|new|down|jump/.test(lower);

            var isIconOnly = text.length === 0 && hasSvg;
            if (!isDownSemantic && !isIconOnly) return;

            var horizontalBias = Math.max(0, 160 - gapRight);
            var verticalBias = Math.max(0, 180 - gapBottom);
            var iconBonus = isIconOnly ? 35 : 0;
            var semanticBonus = isDownSemantic ? 55 : 0;
            var score = horizontalBias + verticalBias + iconBonus + semanticBonus;

            if (score > bestScore) {
                bestScore = score;
                best = btn;
            }
        });

        return best;
    }

    function _agClickJumpToBottomButton(btn) {
        if (!btn) return false;

        var now = Date.now();
        if (now - _agLastJumpButtonClickAt < 700) return false;

        _agLastJumpButtonClickAt = now;
        _agAutoScrollGuardUntil = now + 250;

        try {
            btn.click();
            console.log('[AG Auto] Jump-to-bottom button clicked');
        } catch (e) {
            return false;
        }

        _agContentActiveUntil = Math.max(_agContentActiveUntil, now + 1500);
        _agKickAutoScrollSoon(120);
        return true;
    }

    function _agRunAutoScrollTick() {
        _agEnsureScrollObserver();

        if (!_agConfigIsFresh()) return false;
        if (!window._agAutoEnabled) return false;
        if (!window._agScrollEnabled) return false;

        var now = Date.now();
        if (now < _agManualPauseUntil) return false;
        if (_agLastContentChange === 0 || now > _agContentActiveUntil) return false;

        var chatPanel = _agObservedChatPanel || _agGetChatPanel();
        if (!chatPanel) return false;

        var scrollables = _agCollectScrollTargets(chatPanel);
        if (scrollables.length === 0) return false;

        var scrolledAny = false;
        var largestGap = _agGetLargestScrollGap(scrollables);
        _agAutoScrollGuardUntil = now + 150;
        isAutoScrolling = true;

        try {
            if (largestGap > 48) {
                var jumpBtn = _agFindJumpToBottomButton(chatPanel);
                if (_agClickJumpToBottomButton(jumpBtn)) scrolledAny = true;
            }

            scrollables.forEach(function (el) {
                if (_agScrollElementToBottom(el)) scrolledAny = true;
            });
        } finally {
            setTimeout(function () { isAutoScrolling = false; }, 100);
        }

        return scrolledAny;
    }

    function _agStartAutoScrollLoop() {
        if (_agAutoScrollInterval) {
            clearInterval(_agAutoScrollInterval);
            window._agToolIntervals = window._agToolIntervals.filter(function (id) { return id !== _agAutoScrollInterval; });
        }

        var tickMs = _agScrollTickMs();
        _agAutoScrollInterval = setInterval(function () {
            _agRunAutoScrollTick();
        }, tickMs);

        window._agToolIntervals.push(_agAutoScrollInterval);
        console.log('[AG Auto] Smart auto-scroll loop started (' + tickMs + 'ms)');
    }

    function _agRestartAutoScrollLoop() {
        _agStartAutoScrollLoop();
    }

    function _agPrepareStatsBatch() {
        if (_agPendingStatsBatch || _agSessionTotal <= 0) return;
        _agStatsBatchSeq++;
        _agPendingStatsBatch = {
            id: _agRendererInstanceId + ':' + _agStatsBatchSeq,
            seq: _agStatsBatchSeq,
            stats: JSON.parse(JSON.stringify(_agSessionStats)),
            total: _agSessionTotal
        };
        _agSessionStats = {};
        _agSessionTotal = 0;
    }

    function _agPauseForRecovery(reason, detail, immediate) {
        var lostPort = AG_HTTP_PORT;
        window._agAutoEnabled = false;
        window._agScrollEnabled = false;
        AG_HTTP_PORT = 0;
        _agConnectionGeneration++;
        _agScanGeneration++;
        _agPortScanning = false;
        _agPollRequestSeq++;
        _agRuntimeRequestSeq++;
        _agPollInFlight = false;
        _agRuntimeReportInFlight = false;
        _agSessionToken = '';
        _agLastHealthReport = '';
        Array.from(_agRequests).forEach(function (request) { request.cancel(); });
        _agSetConnectionState('disconnected', reason + ' on port ' + lostPort);
        _agScheduleDiscovery(reason, !!immediate);
    }

    function _agPollServer() {
        if (!AG_HTTP_PORT || _agPollInFlight) return;

        _agPrepareStatsBatch();
        var batch = _agPendingStatsBatch;
        var extraQuery = '';
        if (batch) {
            extraQuery = '&statsBatchId=' + encodeURIComponent(batch.id) +
                '&statsSeq=' + batch.seq +
                '&total=' + Number(batch.total || 0) +
                '&stats=' + encodeURIComponent(JSON.stringify(batch.stats || {}));
        }

        var requestPort = AG_HTTP_PORT;
        var requestGeneration = _agConnectionGeneration;
        var requestSeq = ++_agPollRequestSeq;
        var finish = _agOnce(function (err, cfg) {
            if (requestSeq === _agPollRequestSeq) _agPollInFlight = false;
            if (requestPort !== AG_HTTP_PORT || requestGeneration !== _agConnectionGeneration) return;

            if (err) {
                _agPollErrors++;
                if (!_agPollFailureStartedAt) _agPollFailureStartedAt = Date.now();
                if (_agPollErrors === 1 || _agPollErrors === 5) {
                    console.log('[AG Auto] HTTP poll failure #' + _agPollErrors + ' on port ' + requestPort + ': ' + (err.message || err));
                }
                if (_agPollErrors > 8) {
                    _agPauseForRecovery('server-lost', 'HTTP poll failed ' + _agPollErrors + ' consecutive times; rediscovery will continue automatically.', true);
                }
                return;
            }

            if (cfg && cfg.bindRejected) {
                _agPauseForRecovery('bind-rejected', String(cfg.rejectReason || 'unknown') + '; rediscovery will retry with owner validation.', false);
                return;
            }
            if (!_agStatusIsCompatible(cfg, false) || cfg.ownerKey !== _agWindowBindingKey) {
                _agPauseForRecovery('identity-mismatch', 'Status response did not confirm this renderer owner key.', true);
                return;
            }

            if (batch && cfg.statsBatchId === batch.id && _agPendingStatsBatch && _agPendingStatsBatch.id === batch.id) {
                _agPendingStatsBatch = null;
            }
            _agPollErrors = 0;
            _agPollFailureStartedAt = 0;
            _agLastPollSuccessAt = Date.now();
            _agServerEverConnected = true;
            _agSetConnectionState('connected', 'port ' + requestPort);
            _agApplyConfig(cfg);
            if (_agPollCount <= 2) {
                console.log('[AG Auto] HTTP poll #' + _agPollCount + ' OK on port ' + requestPort + ', enabled=' + window._agAutoEnabled + ', patterns=' + CLICK_PATTERNS.length);
            }
        });

        _agPollInFlight = true;
        _agRequestStatus(requestPort, { extraQuery: extraQuery }, finish);
    }

    function _agConfigIsFresh() {
        var age = Date.now() - _agLastPollSuccessAt;
        if (AG_HTTP_PORT && _agConnectionState === 'connected' && age >= 0 && age < AG_CONFIG_LEASE_MS) return true;
        if (AG_HTTP_PORT) _agPauseForRecovery('config-expired', 'Waiting for fresh verified config.', true);
        return false;
    }

    function _agCheckLiveness() {
        _agRefreshPairing();
        _agConfigIsFresh();
        if (_agPortScanning && Date.now() >= _agScanDeadline) {
            _agPauseForRecovery('scan-expired', 'Retry discovery after deadline.', false);
        }
        Array.from(_agRequests).forEach(function (request) {
            if (Date.now() >= request.deadline) request.expire();
        });
    }
    function _agOnWake() {
        if (Date.now() - _agLastWakeAt < 1000) return;
        _agLastWakeAt = Date.now();
        _agCheckLiveness();
        if (AG_HTTP_PORT) _agPollServer();
        else _agScheduleDiscovery('window resumed', true);
    }
    window.addEventListener('focus', _agOnWake);
    window.addEventListener('pageshow', _agOnWake);
    window.addEventListener('visibilitychange', _agOnWake);

    // Discovery never stops permanently: failed scans schedule bounded backoff retries.
    _agScheduleDiscovery('initial startup', false);

    var _agConfigReload = setInterval(function () {
        _agCheckLiveness();
        _agPollCount++;
        if (AG_HTTP_PORT === 0) {
            _agScheduleDiscovery('periodic disconnected check', false);
            return;
        }
        _agPollServer();
    }, 2000);
    window._agToolIntervals.push(_agConfigReload);

    var REJECT_WORDS = ['Reject', 'Deny', 'Cancel', 'Dismiss', 'Don\'t Allow', 'Decline'];
    var EDITOR_SKIP_WORDS = ['Accept Changes', 'Accept All', 'Accept Incoming', 'Accept Current', 'Accept Both', 'Accept Combination'];
    var _clicked = new Map();
    var _clickedGcTimer = setInterval(function () {
        var now = Date.now();
        var expired = [];
        _clicked.forEach(function (entry, el) {
            var ts = typeof entry === 'number' ? entry : (entry && entry.ts) || 0;
            if (now - ts > 30000) expired.push(el);
        });
        expired.forEach(function (el) { _clicked.delete(el); });
    }, 15000);
    window._agToolIntervals.push(_clickedGcTimer);

    function _agNormalizeButtonText(rawText) {
        // Strip keyboard shortcut suffixes like "RunAlt+Enter", "AllowCtrl+Shift+A"
        // Common patterns: Alt+X, Ctrl+X, Shift+X, ⌘+X, and combinations
        return rawText.replace(/(?:Alt|Ctrl|Shift|Cmd|⌘|⌥|⇧)\+.*/i, '').replace(/\s+/g, ' ').trim();
    }

    function _agIsInsideAgentPanel(el) {
        if (!el || !el.closest) return false;
        return !!(el.closest('.antigravity-agent-side-panel') ||
            el.closest('[class*="agent"]') ||
            el.closest('[class*="chat-widget"]') ||
            el.closest('[class*="interactive-session"]') ||
            el.closest('.chat-input-toolbars') ||
            el.closest('[class*="tool-confirmation"]') ||
            el.closest('[class*="confirmation-widget"]') ||
            el.closest('[class*="terminal-command"]') ||
            el.closest('[class*="tool-invocation"]') ||
            el.closest('[class*="tool-call"]') ||
            el.closest('[class*="approval"]') ||
            el.closest('[class*="permission"]') ||
            el.closest('[class*="confirm"]') ||
            el.closest('[class*="chat-panel"]') ||
            el.closest('[class*="chat-response"]') ||
            el.closest('[class*="chat-message"]') ||
            el.closest('[class*="step-widget"]'));
    }

    function _agIsInsidePermissionCard(el) {
        var parent = el && el.parentElement;
        for (var level = 0; level < 10 && parent; level++) {
            var txt = (parent.innerText || parent.textContent || '').replace(/\s+/g, ' ').trim();
            if (/Agent\s+needs\s+permission\s+to\s+execute\s+JavaScript\s+on/i.test(txt)) return true;
            if (/Always\s+run/i.test(txt) && /\bDeny\b/i.test(txt) && /\bAllow\b/i.test(txt)) return true;
            parent = parent.parentElement;
        }
        return false;
    }

    function _agHasDenySibling(btn, maxLevels) {
        // Search up to N levels for a sibling reject/deny button
        var parent = btn.parentElement;
        for (var level = 0; level < (maxLevels || 8); level++) {
            if (!parent) break;

            var siblingBtns = parent.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background, [class*="secondary"], [class*="cancel"], [class*="deny"], [class*="reject"]');
            for (var i = 0; i < siblingBtns.length; i++) {
                var sibling = siblingBtns[i];
                if (sibling === btn) continue;

                var siblingRaw = (sibling.innerText || sibling.textContent || sibling.getAttribute && (sibling.getAttribute('aria-label') || sibling.getAttribute('title')) || '').trim();
                var siblingText = _agNormalizeButtonText(siblingRaw);
                for (var j = 0; j < REJECT_WORDS.length; j++) {
                    if (siblingText === REJECT_WORDS[j] || siblingText.indexOf(REJECT_WORDS[j]) === 0 ||
                        siblingRaw === REJECT_WORDS[j] || siblingRaw.indexOf(REJECT_WORDS[j]) === 0) {
                        return true;
                    }
                }
            }

            parent = parent.parentElement;
        }
        return false;
    }

    function isApprovalButton(btn) {
        // Fast path: if button is inside the agent/chat panel, it's safe to click
        if (_agIsInsideAgentPanel(btn) || _agIsInsidePermissionCard(btn)) {
            return true;
        }

        // Key fix: if this button has a Deny/Reject sibling nearby, it's an approval button
        // regardless of where it is in the DOM (editor area, side panel, etc.)
        if (_agHasDenySibling(btn, 8)) {
            return true;
        }

        return false;
    }

    if (!window._agClickStats) window._agClickStats = {};
    if (!window._agTotalClicks) window._agTotalClicks = 0;

    var _agAutoClickInterval = 0;

    function _agStartClickLoop() {
        if (_agAutoClickInterval) {
            clearInterval(_agAutoClickInterval);
            window._agToolIntervals = window._agToolIntervals.filter(function (id) { return id !== _agAutoClickInterval; });
        }

        var tickMs = _agClampMs(CLICK_INTERVAL_MS, 1000, 100, 120000);
        _agAutoClickInterval = setInterval(function () {
        if (!_agConfigIsFresh()) return;
        if (!window._agAutoEnabled) return;

        var clickables = Array.from(document.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background, [class*="ide-button"]'));
        document.querySelectorAll('span.cursor-pointer').forEach(function (span) { clickables.push(span); });

        var targetBtn = null;
        var matchedPattern = '';

        for (var i = 0; i < clickables.length; i++) {
            var btn = clickables[i];
            if (btn.offsetParent === null) continue;
            var clickedEntry = _clicked.get(btn);
            var clickedAt = typeof clickedEntry === 'number' ? clickedEntry : (clickedEntry && clickedEntry.ts) || 0;
            var clickedPattern = clickedEntry && clickedEntry.pattern ? clickedEntry.pattern : '';
            if (clickedAt && (Date.now() - clickedAt) < 30000) continue;

            var rawText = (btn.innerText || btn.textContent || btn.getAttribute && (btn.getAttribute('aria-label') || btn.getAttribute('title')) || '').trim();
            if (!rawText || rawText.length > 120) continue;
            // Never click VS Code navigation/activity controls such as "Run and Debug".
            // They can expose aria-label/title text that starts with "Run" and would
            // otherwise be mistaken for the chat approval Run button.
            if (/^Run\s+and\s+Debug\b/i.test(rawText)) continue;
            if (btn.closest && (
                btn.closest('.activitybar') ||
                btn.closest('.part.activitybar') ||
                btn.closest('[id*="workbench.parts.activitybar"]') ||
                btn.closest('.composite-bar') ||
                btn.closest('.pane-composite-part') ||
                btn.closest('[aria-label="Activity Bar"]')
            )) continue;
            // Normalize: strip keyboard shortcut suffixes (e.g., "RunAlt+Enter" → "Run")
            var text = _agNormalizeButtonText(rawText);
            if (!text) continue;

            // Check if text matches any configured pattern
            var matchesPattern = false;
            for (var p = 0; p < CLICK_PATTERNS.length; p++) {
                var pattern = CLICK_PATTERNS[p];
                if (text === pattern || text.indexOf(pattern) === 0 || rawText === pattern || rawText.indexOf(pattern) === 0) {
                    matchesPattern = true;
                    matchedPattern = pattern;
                    break;
                }
            }
            if (!matchesPattern) continue;

            // Check click limit for this pattern
            var limit = CLICK_LIMITS[matchedPattern];
            if (limit && limit > 0) {
                var currentCount = _agPatternClickCounts[matchedPattern] || 0;
                console.log('[AG Auto] Limit check: ' + matchedPattern + ' count=' + currentCount + '/' + limit);
                if (currentCount >= limit) {
                    console.log('[AG Auto] BLOCKED by limit: ' + matchedPattern);
                    continue; // Skip — limit reached for this pattern
                }
            }

            // PRIORITY CHECK: If this is an Allow/Deny pair, click it immediately
            // regardless of editor ancestor — this is the key fix for Allow buttons
            // that appear inside editor-like containers
            if (_agHasDenySibling(btn, 8)) {
                targetBtn = btn;
                console.log('[AG Auto] Priority match: ' + matchedPattern + ' with Deny sibling');
                break;
            }

            var skipEditor = false;
            for (var se = 0; se < EDITOR_SKIP_WORDS.length; se++) {
                if (text.indexOf(EDITOR_SKIP_WORDS[se]) === 0 || rawText.indexOf(EDITOR_SKIP_WORDS[se]) === 0) {
                    skipEditor = true;
                    break;
                }
            }
            if (skipEditor) continue;

            if (btn.closest && (
                btn.closest('.monaco-diff-editor') ||
                btn.closest('.merge-editor-view') ||
                btn.closest('.inline-merge-region') ||
                btn.closest('.merged-editor') ||
                btn.closest('.view-zones') ||
                btn.closest('.view-lines') ||
                btn.closest('.statusbar') ||
                btn.closest('.part.statusbar') ||
                btn.closest('[id*="workbench.parts.statusbar"]')
            )) continue;

            // Relaxed editor check: only skip if inside editor AND not an approval context
            if (btn.closest && btn.closest('[id*="workbench.parts.editor"]')) {
                if (!isApprovalButton(btn)) continue;
            }

            if (btn.classList && (btn.classList.contains('diff-hunk-button') || btn.classList.contains('accept') || btn.classList.contains('revert'))) {
                var editorAncestor = btn.closest && btn.closest('[class*="editor"], [id*="editor"]');
                if (editorAncestor && !_agHasDenySibling(btn, 4)) continue;
            }

            if (btn.tagName === 'SPAN' && btn.classList.contains('cursor-pointer')) {
                targetBtn = btn;
                break;
            }

            if (isApprovalButton(btn)) {
                targetBtn = btn;
                break;
            }
        }

        if (!targetBtn && window._agAcceptChatOnly) {
            // Check Accept limit before scanning
            var acceptLimit = CLICK_LIMITS['Accept'];
            var acceptCount = _agPatternClickCounts['Accept'] || 0;
            var acceptBlocked = acceptLimit && acceptLimit > 0 && acceptCount >= acceptLimit;
            if (!acceptBlocked) {
                for (var ai = 0; ai < clickables.length; ai++) {
                    var acceptBtn = clickables[ai];
                    if (acceptBtn.offsetParent === null) continue;
                    var acceptEntry = _clicked.get(acceptBtn);
                    var acceptClickedAt = typeof acceptEntry === 'number' ? acceptEntry : (acceptEntry && acceptEntry.ts) || 0;
                    if (acceptClickedAt && (Date.now() - acceptClickedAt) < 30000) continue;

                    var acceptText = (acceptBtn.innerText || acceptBtn.textContent || '').trim();
                    if (acceptText.indexOf('Accept') !== 0) continue;
                    if (/^Accept\s+(all|changes|incoming|current|both|combination|on|off)/i.test(acceptText)) continue;

                    if (acceptBtn.closest && (
                        acceptBtn.closest('.editor-scrollable') ||
                        acceptBtn.closest('.monaco-diff-editor') ||
                        acceptBtn.closest('.view-zones') ||
                        acceptBtn.closest('.merge-editor-view')
                    )) {
                        console.log('[AG Auto] Blocked Accept inside editor: [' + acceptText.substring(0, 20) + ']');
                        continue;
                    }

                    if (acceptBtn.classList && (acceptBtn.classList.contains('diff-hunk-button') || acceptBtn.classList.contains('revert'))) {
                        console.log('[AG Auto] Blocked Accept diff-hunk: [' + acceptText.substring(0, 20) + ']');
                        continue;
                    }

                    targetBtn = acceptBtn;
                    matchedPattern = 'Accept';
                    console.log('[AG Auto] Accept clicked in chat: [' + acceptText.substring(0, 25) + ']');
                    break;
                }
            }
        }

        if (targetBtn) {

            var rawClickedText = (targetBtn.innerText || targetBtn.textContent || '').trim();
            if (matchedPattern === 'Allow' && /^Allow\s+in\s+Workspace/i.test(rawClickedText)) {
                matchedPattern = 'Allow in Workspace';
            }
            if (matchedPattern !== 'Continue') {
                try {
                    _agRequest('POST', 'http://127.0.0.1:' + AG_HTTP_PORT + '/api/click-log', {
                        button: rawClickedText.substring(0, 100),
                        pattern: matchedPattern,
                        windowKey: _agWindowBindingKey,
                        rendererInstanceId: _agRendererInstanceId,
                        sessionToken: _agSessionToken,
                        serverStartedAt: _agConnectedServerStartedAt,
                        serverGeneration: _agConnectedServerGeneration
                    }, '', function () {});
                } catch (e) { }
            }

            // (duplicate canonicalize removed — already handled above)

            console.log('[AG Auto] Click: [' + rawClickedText + ']');
            _clicked.set(targetBtn, { ts: Date.now(), pattern: matchedPattern });
            targetBtn.click();

            _agSessionTotal++;
            if (!_agSessionStats[matchedPattern]) _agSessionStats[matchedPattern] = 0;
            _agSessionStats[matchedPattern]++;

            // Track click count for limits
            if (!_agPatternClickCounts[matchedPattern]) _agPatternClickCounts[matchedPattern] = 0;
            _agPatternClickCounts[matchedPattern]++;
            var patLimit = CLICK_LIMITS[matchedPattern];
            if (patLimit && patLimit > 0 && _agPatternClickCounts[matchedPattern] >= patLimit) {
                console.log('[AG Auto] Limit reached for ' + matchedPattern + ': ' + _agPatternClickCounts[matchedPattern] + '/' + patLimit);
            }

            window._agTotalClicks++;
            if (!window._agClickStats[matchedPattern]) window._agClickStats[matchedPattern] = 0;
            window._agClickStats[matchedPattern]++;
        }
    }, tickMs);
        window._agToolIntervals.push(_agAutoClickInterval);
        console.log('[AG Auto] Click loop started (' + tickMs + 'ms)');
    }

    function _agRestartClickLoop() {
        console.log('[AG Auto] Click interval changed to ' + CLICK_INTERVAL_MS + 'ms — restarting click loop');
        _agStartClickLoop();
    }

    _agStartClickLoop();

    function _agStartScrollObserver() {
        _agEnsureScrollObserver();
        if (_agObserverWatchdog) return;

        _agObserverWatchdog = setInterval(function () {
            _agEnsureScrollObserver();
        }, 1500);

        window._agToolIntervals.push(_agObserverWatchdog);
    }

    _agStartScrollObserver();

    window._agScrollListener = function (e) {
        if (!e.isTrusted) return;
        if (isAutoScrolling && Date.now() < _agAutoScrollGuardUntil) return;
        if (!_agIsInsideChatPanel(e.target)) return;

        _agManualPauseUntil = Date.now() + _agScrollPauseWindowMs();
    };
    window.addEventListener('scroll', window._agScrollListener, true);

    _agStartAutoScrollLoop();

    if (window.__AG_AUTO_TEST__) {
        window.__agAutoTestHooks = {
            once: _agOnce,
            nextRetryDelay: _agNextRetryDelay,
            scoreCandidate: _agScoreCandidate,
            statusIsCompatible: _agStatusIsCompatible,
            getBoundPort: _agGetBoundPort,
            setBoundPort: _agSetBoundPort,
            invalidateBoundPort: _agInvalidateBoundPort,
            discover: _agDiscoverPort,
            poll: _agPollServer,
            checkLiveness: _agCheckLiveness,
            configIsFresh: _agConfigIsFresh,
            scrollTick: _agRunAutoScrollTick,
            readPairingMarker: _agReadPairingMarker,
            pendingRequests: function () { return _agRequests.size; },
            getConnectionState: function () { return _agConnectionState; },
            getClickPatterns: function () { return CLICK_PATTERNS.slice(); }
        };
    }

    console.log('[AG Auto] smart scroll ready | Patterns:', JSON.stringify(CLICK_PATTERNS));
})();
