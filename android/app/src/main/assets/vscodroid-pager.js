(function () {
    if (window.__vscodroidPagerInstalled) return;
    window.__vscodroidPagerInstalled = true;

    var STYLE_ID = 'vscodroid-pager-css';
    var DOTS_ID = 'vscodroid-pager-dots';
    var PINCH_IN = 8;
    var PINCH_OUT = 32;
    var pointers = {};
    var pinchStart = 0;
    var pinchActive = false;
    var pages = [];
    var pageIndex = 0;
    var pagerOn = false;
    var sidebarWatch = null;
    var overlayWatch = null;
    // One record per (element, property) we override. Restoring puts back
    // only those properties, so inline styles VS Code writes while the pager
    // is active (e.g. the webview overlay's `position-anchor`) survive.
    var styleSnaps = [];
    var snappedProps = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    var layoutBusy = false;
    var nudgeCount = 0;
    var nudgeWindow = 0;
    var watchQueued = false;

    function portrait() {
        return window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    }

    // Cline/task auto-scroll lock: while the user has scrolled up to read,
    // nudgeLayout must resize only and never pull the view back to bottom.
    // Cline scrolls its own webview to bottom on every new token; without
    // this lock that plus our forced reflow yanks the user down.
    var SCROLL_LOCK_PX = 80;
    var userScrollLock = false;
    var userScrollLockEl = null;

    function isNearBottom(el) {
        if (!el) return true;
        try {
            var dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            return dist <= SCROLL_LOCK_PX;
        } catch (e) { return true; }
    }

    function findClineScroller() {
        // Cline/Roo/Kai chat webviews all mount a scrollable task container;
        // pick the tallest scrollable ancestor of the focused node first,
        // falling back to document scroll.
        var node = document.activeElement;
        while (node && node !== document.body) {
            try {
                var st = window.getComputedStyle(node);
                var oy = st && st.overflowY;
                if ((oy === 'auto' || oy === 'scroll') &&
                    node.scrollHeight > node.clientHeight + SCROLL_LOCK_PX) {
                    return node;
                }
            } catch (e) { /* keep climbing */ }
            node = node.parentElement;
        }
        return document.scrollingElement || document.documentElement;
    }

    // Any upward intent arms the lock; returning near bottom releases it.
    // Capture phase: Cline's own scrollToBottom listener must not pre-empt.
    ['wheel', 'touchmove'].forEach(function (evt) {
        document.addEventListener(evt, function (e) {
            var el = findClineScroller();
            userScrollLockEl = el;
            if (!isNearBottom(el)) {
                userScrollLock = true;
            } else if (userScrollLock && isNearBottom(el)) {
                userScrollLock = false;
            }
        }, { capture: true, passive: true });
    });
    document.addEventListener('scroll', function () {
        var el = userScrollLockEl || findClineScroller();
        if (isNearBottom(el)) userScrollLock = false;
        else userScrollLock = true;
    }, true);

    function pagerHeight() {
        var vv = window.visualViewport;
        var h = vv && vv.height ? vv.height : window.innerHeight;
        return Math.max(1, Math.round(h));
    }

    // One relayout per settled size, not one per event.
    //
    // The window is adjustResize, so the soft keyboard shrinking it fires a
    // burst of visualViewport resizes as it animates. Each one ran a full
    // layout pass, and a layout pass writes the chat webview's size through
    // fillImportant -- which Chromium resizes the iframe for even when the
    // value is unchanged, and which a chat webview answers by scrolling itself
    // back to the latest message. So the animation produced a run of forced
    // reflows, and with the keyboard up that read as the composer jumping.
    //
    // The trailing pass is what keeps the composer above the keyboard once it
    // has settled; the intermediate ones were never a state worth painting.
    // IME_SETTLE_MS is short enough that the gap is not visible as a delay.
    var IME_SETTLE_MS = 120;
    var vvTimer = null;

    if (window.visualViewport && !window.__vscodroidPagerVvHook) {
        window.__vscodroidPagerVvHook = true;
        window.visualViewport.addEventListener('resize', function () {
            if (!pagerOn || !pages.length) return;
            if (vvTimer) clearTimeout(vvTimer);
            vvTimer = setTimeout(function () {
                vvTimer = null;
                if (!pagerOn || !pages.length || layoutBusy) return;
                var page = pages[pageIndex];
                nudgeLayout(page);
                syncOverlays(page);
            }, IME_SETTLE_MS);
        });
    }

    function ensureStyle() {
        var s = document.getElementById(STYLE_ID);
        if (!s) {
            s = document.createElement('style');
            s.id = STYLE_ID;
        }
        s.textContent = [
            'body.vscodroid-pager .part.activitybar { display: none !important; }',
            'body.vscodroid-pager .part.titlebar { display: none !important; }',
            'body.vscodroid-pager .monaco-workbench .part.editor,',
            'body.vscodroid-pager .monaco-workbench .part.panel,',
            'body.vscodroid-pager .monaco-workbench .part.auxiliarybar {',
            '  visibility: hidden !important;',
            '}',
            'body.vscodroid-pager:not(.vscodroid-pager-kai) .monaco-workbench .part.sidebar {',
            '  visibility: hidden !important;',
            '}',
            'body.vscodroid-pager.vscodroid-pager-kai .part.sidebar {',
            '  visibility: visible !important;',
            '  display: block !important;',
            '}',
            // While a fullscreen page is up, the workbench may still reveal the
            // editor or the panel because an agent opened a file or a terminal.
            // Those parts keep running; they do not paint over the page.
            'body.vscodroid-pager-hold .part.editor,',
            'body.vscodroid-pager-hold .part.panel,',
            'body.vscodroid-pager-hold .part.auxiliarybar,',
            'body.vscodroid-pager-hold .part.sidebar {',
            '  visibility: hidden !important;',
            '  pointer-events: none !important;',
            '}',
            'body.vscodroid-pager-hold .part.vscodroid-pager-active {',
            '  visibility: visible !important;',
            '  pointer-events: auto !important;',
            '  z-index: 100000 !important;',
            '}',
            // An anchor-positioned box paints in the stacking position of its
            // anchor, not by its own z-index, so the Kai overlay only wins
            // over the sidebar when the sidebar has no positive z-index.
            'body.vscodroid-pager.vscodroid-pager-kai .monaco-workbench .part.sidebar.vscodroid-pager-active {',
            '  z-index: auto !important;',
            '}',
            'body.vscodroid-pager .webview-overlay-content {',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '}',
            'body.vscodroid-pager.vscodroid-pager-kai .webview-overlay-content,',
            'body.vscodroid-pager .webview-overlay-content.vscodroid-pager-active {',
            '  opacity: 1 !important;',
            '  pointer-events: auto !important;',
            '  visibility: visible !important;',
            '  z-index: 100003 !important;',
            '}',
            'body.vscodroid-pager .part.panel.vscodroid-pager-active .split-view-view.vscodroid-pager-tabstrip {',
            '  display: none !important;',
            '}',
            // The status bar, the side-bar view header and the panel title are
            // chrome a phone cannot spare. The editor keeps its tabs.
            'body.vscodroid-pager .monaco-workbench .part.statusbar {',
            '  height: 0 !important;',
            '  min-height: 0 !important;',
            '  overflow: hidden !important;',
            '  padding: 0 !important;',
            '  border: 0 !important;',
            '  opacity: 0 !important;',
            '  pointer-events: none !important;',
            '}',
            'body.vscodroid-pager .part.sidebar.vscodroid-pager-active > .title,',
            'body.vscodroid-pager .part.sidebar.vscodroid-pager-active > .composite.title,',
            'body.vscodroid-pager .part.panel.vscodroid-pager-active > .title,',
            'body.vscodroid-pager .part.panel.vscodroid-pager-active > .composite.title {',
            '  display: none !important;',
            '  height: 0 !important;',
            '  max-height: 0 !important;',
            '  overflow: hidden !important;',
            '}',
            'body.vscodroid-pager .monaco-workbench .part.vscodroid-pager-active,',
            'body.vscodroid-pager .split-view-view.vscodroid-pager-active {',
            '  position: fixed !important;',
            '  top: 0 !important;',
            '  left: 0 !important;',
            '  right: 0 !important;',
            '  bottom: 0 !important;',
            '  width: 100% !important;',
            '  height: auto !important;',
            '  max-width: none !important;',
            '  max-height: none !important;',
            '  visibility: visible !important;',
            '  z-index: 100000 !important;',
            '  overflow: hidden !important;',
            '}',
            'body.vscodroid-pager .split-view-view.vscodroid-pager-active > .part:not(.vscodroid-pager-active) {',
            '  visibility: hidden !important;',
            '}',
            'body.vscodroid-pager .part.vscodroid-pager-active > .composite.title {',
            '  width: 100% !important;',
            '  height: auto !important;',
            '  max-height: 48px !important;',
            '}',
            'body.vscodroid-pager .part.vscodroid-pager-active > .content {',
            '  position: absolute !important;',
            '  left: 0 !important;',
            '  right: 0 !important;',
            '  bottom: 0 !important;',
            '  width: auto !important;',
            '  height: auto !important;',
            '  max-width: none !important;',
            '  max-height: none !important;',
            '}',
            'body.vscodroid-pager .part.vscodroid-pager-active .split-view-view,',
            'body.vscodroid-pager .part.vscodroid-pager-active .split-view-container,',
            'body.vscodroid-pager .part.vscodroid-pager-active .monaco-split-view2,',
            'body.vscodroid-pager .part.vscodroid-pager-active .monaco-grid-branch-node,',
            'body.vscodroid-pager .part.vscodroid-pager-active .monaco-pane-view,',
            'body.vscodroid-pager .part.vscodroid-pager-active .composite.viewlet,',
            'body.vscodroid-pager .part.vscodroid-pager-active .pane-body,',
            'body.vscodroid-pager .part.vscodroid-pager-active iframe,',
            'body.vscodroid-pager .part.vscodroid-pager-active .webview,',
            'body.vscodroid-pager .part.vscodroid-pager-active .webview-container,',
            'body.vscodroid-pager .part.vscodroid-pager-active .terminal-wrapper,',
            'body.vscodroid-pager .part.vscodroid-pager-active .terminal-split-pane,',
            'body.vscodroid-pager .part.vscodroid-pager-active .terminal-xterm-host,',
            'body.vscodroid-pager .part.vscodroid-pager-active .terminal-outer-container {',
            '  width: 100% !important;',
            '  height: 100% !important;',
            '  max-width: none !important;',
            '  max-height: none !important;',
            '}',
            '#' + DOTS_ID + ' {',
            '  position: fixed;',
            '  left: 0; right: 0;',
            '  top: 6px;',
            '  display: none;',
            '  justify-content: center;',
            '  gap: 8px;',
            '  z-index: 100002;',
            '  pointer-events: none;',
            '}',
            'body.vscodroid-pager #' + DOTS_ID + ' { display: flex; }',
            '#' + DOTS_ID + ' i {',
            '  width: 7px; height: 7px; border-radius: 50%;',
            '  background: rgba(255,255,255,0.35);',
            '}',
            '#' + DOTS_ID + ' i.on { background: rgba(255,255,255,0.95); }'
        ].join('\n');
        if (!s.parentNode) document.documentElement.appendChild(s);
    }

    function ensureDots() {
        if (document.getElementById(DOTS_ID)) return;
        var d = document.createElement('div');
        d.id = DOTS_ID;
        document.documentElement.appendChild(d);
    }

    function clickActivity(needle) {
        var items = document.querySelectorAll('.activitybar .action-label, .activitybar .action-item');
        var i, t;
        needle = needle.toLowerCase();
        for (i = 0; i < items.length; i++) {
            t = (items[i].getAttribute('aria-label') || items[i].title || items[i].textContent || '').toLowerCase();
            if (t.indexOf(needle) >= 0) {
                var clickable = items[i].classList && items[i].classList.contains('action-label')
                    ? items[i]
                    : items[i].querySelector('.action-label') || items[i];
                clickable.click();
                return true;
            }
        }
        return false;
    }

    function clickActivityAny(needles) {
        var i;
        for (i = 0; i < needles.length; i++) {
            if (clickActivity(needles[i])) return true;
        }
        return false;
    }

    function clickLabeled(selector, needles) {
        var items = document.querySelectorAll(selector);
        var i, j, t;
        for (i = 0; i < items.length; i++) {
            t = (items[i].getAttribute('aria-label') || items[i].title || items[i].textContent || '').toLowerCase();
            for (j = 0; j < needles.length; j++) {
                if (t.indexOf(needles[j]) >= 0) {
                    items[i].click();
                    return true;
                }
            }
        }
        return false;
    }

    function ensureTerminalPanel() {
        var panel = document.querySelector('.part.panel');
        if (panel && !panel.classList.contains('empty')) return true;
        if (clickLabeled(
            '.statusbar [aria-label], .statusbar .statusbar-item, .panel .composite.title [aria-label]',
            ['terminal', '终端', '終端', 'panel', '面板']
        )) return true;
        try {
            var ev = new KeyboardEvent('keydown', {
                key: '`', code: 'Backquote', ctrlKey: true, bubbles: true, cancelable: true
            });
            document.dispatchEvent(ev);
        } catch (_e) {}
        return false;
    }

    function snapProp(el, prop) {
        if (!el || !el.style) return false;
        var seen;
        if (snappedProps) {
            seen = snappedProps.get(el);
            if (!seen) {
                seen = {};
                snappedProps.set(el, seen);
            }
        } else {
            seen = el.__vscodroidPagerSnap || (el.__vscodroidPagerSnap = {});
        }
        if (seen[prop]) return true;
        seen[prop] = true;
        styleSnaps.push({
            el: el,
            prop: prop,
            val: el.style.getPropertyValue(prop),
            prio: el.style.getPropertyPriority(prop)
        });
        return true;
    }

    function setStyle(el, prop, val, important) {
        if (!snapProp(el, prop)) return;
        el.style.setProperty(prop, val, important ? 'important' : '');
    }

    function unsetStyle(el, prop) {
        if (!snapProp(el, prop)) return;
        el.style.removeProperty(prop);
    }

    function restoreStyles() {
        var i, rec;
        for (i = styleSnaps.length - 1; i >= 0; i--) {
            rec = styleSnaps[i];
            if (!rec || !rec.el || !rec.el.style) continue;
            if (rec.val) rec.el.style.setProperty(rec.prop, rec.val, rec.prio);
            else rec.el.style.removeProperty(rec.prop);
            if (!snappedProps && rec.el.__vscodroidPagerSnap) delete rec.el.__vscodroidPagerSnap;
        }
        styleSnaps = [];
        snappedProps = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
    }

    function clearImportantStyles() {
        restoreStyles();
    }

    // Lower rank wins. Cline first, then other sidebar agents that paint a
    // webview the same way (overlay anchored inside the side bar).
    var AGENT_NEEDLES = [
        'cline', 'claude', 'roo', 'continue', 'aider',
        'augment', 'cody', 'codeium', 'blackbox', 'windsurf', 'kai'
    ];

    function isOverlayPage(page) {
        return !!(page && page.overlay);
    }

    function sidebarShown() {
        var el = document.querySelector('.part.sidebar');
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return r.width > 24 && r.height > 24;
    }

    function itemChecked(node) {
        var item = node;
        while (item && !(item.classList && item.classList.contains('action-item'))) {
            item = item.parentElement;
        }
        return !!(item && item.classList && item.classList.contains('checked'));
    }

    // The label an activity bar item can be named by, in the order that has
    // actually produced a name on this workbench.
    //
    // textContent is not a belt-and-braces addition here, it is the difference
    // between finding Cline and not: the name is carried on the inner
    // .action-label's text, while the .action-item wrapper this loop reads
    // first often has an aria-label that names the category ("Views", or
    // nothing at all). Reading only the two attributes left `label` empty for
    // the installed agent, every needle missed, and the fallback below opened
    // the extension marketplace instead: a chevron press answered with a
    // catalogue rather than with the chat that was already on screen.
    //
    // clickActivity in this same file already reads textContent and queries
    // .action-label as well, which is why ensureTerminalPanel found its
    // terminal and this did not find Cline.
    function itemLabel(node) {
        var inner = node.querySelector ? node.querySelector('.action-label') : null;
        return (
            (node.getAttribute('aria-label') || '') + ' ' +
            (inner ? (inner.getAttribute('aria-label') || '') : '') + ' ' +
            (node.title || '') + ' ' +
            (inner ? (inner.title || '') : '') + ' ' +
            (inner ? (inner.textContent || '') : (node.textContent || ''))
        ).toLowerCase();
    }

    function revealAgent() {
        var items = document.querySelectorAll('.activitybar .action-item');
        var i, n, label, clickable, best = null, bestRank = 99;
        for (i = 0; i < items.length; i++) {
            label = itemLabel(items[i]);
            var rank = -1;
            for (n = 0; n < AGENT_NEEDLES.length; n++) {
                if (label.indexOf(AGENT_NEEDLES[n]) >= 0) { rank = n; break; }
            }
            if (rank < 0) continue;
            clickable = items[i].querySelector('.action-label') || items[i];
            if (best === null || rank < bestRank) {
                best = clickable;
                bestRank = rank;
            }
        }
        if (best) {
            // A click on the icon that is already showing toggles the side bar
            // shut. Opening a file used to do that and take this page with it.
            //
            // Checked before the click rather than after, and against the
            // wrapper rather than the inner node: itemChecked walks up to the
            // .action-item, so passing the already-wrapped `best` is what makes
            // this a no-op when the agent the user opened is the one we found.
            if (!itemChecked(best)) best.click();
            return true;
        }
        clickActivityAny(['extensions', '扩展', '擴充']);
        return false;
    }

    var enforcing = false;

    // The editor and the terminal may be focused by the agent. The fullscreen
    // page stays the one the user is on: the other parts are kept invisible
    // until a chevron changes the page.
    function foreignPartVisible() {
        if (!pagerOn || !pages[pageIndex]) return false;
        var page = pages[pageIndex];
        var parts = document.querySelectorAll('.part.sidebar, .part.editor, .part.panel');
        var i, el, keep, style;
        for (i = 0; i < parts.length; i++) {
            el = parts[i];
            keep = (page.id === 'agent' && el.classList.contains('sidebar'))
                || (page.id === 'editor' && el.classList.contains('editor'))
                || (page.id === 'panel' && el.classList.contains('panel'));
            if (keep) continue;
            style = window.getComputedStyle(el);
            if (style.visibility !== 'hidden' && style.display !== 'none') return true;
        }
        return false;
    }

    function enforceCurrentPage(reopen) {
        if (!pagerOn || enforcing || !pages[pageIndex]) return;
        enforcing = true;
        try {
            var page = pages[pageIndex];
            // A workbench layout pass can drop the marker class while it
            // reveals a terminal or an editor. Putting it back is what keeps
            // this a fullscreen page instead of the desktop grid.
            document.body.classList.add('vscodroid-pager');
            document.body.classList.add('vscodroid-pager-hold');
            var parts = document.querySelectorAll('.part.sidebar, .part.editor, .part.panel, .part.auxiliarybar');
            var i, el, keep, kept = null;
            for (i = 0; i < parts.length; i++) {
                el = parts[i];
                keep = false;
                if (page.id === 'agent' && el.classList.contains('sidebar')) keep = true;
                if (page.id === 'editor' && el.classList.contains('editor')) keep = true;
                if (page.id === 'panel' && el.classList.contains('panel')) keep = true;
                if (keep) kept = el;
            }
            // No target part: hiding the rest would be a blank screen.
            if (!kept) return;
            for (i = 0; i < parts.length; i++) {
                el = parts[i];
                if (el === kept) {
                    unsetStyle(el, 'visibility');
                    unsetStyle(el, 'pointer-events');
                    if (window.getComputedStyle(el).display === 'none') {
                        setStyle(el, 'display', 'flex', true);
                    }
                    el.classList.add('vscodroid-pager-active');
                } else {
                    el.classList.remove('vscodroid-pager-active');
                    setStyle(el, 'visibility', 'hidden', true);
                    setStyle(el, 'pointer-events', 'none', true);
                }
            }
            if (reopen && page.agent && !sidebarShown()) revealAgent();
            syncOverlays(page);
            nudgeLayout(page);
        } finally {
            enforcing = false;
        }
    }

    function revealPageView(page) {
        if (!page) return;
        if (page.agent) {
            revealAgent();
            return;
        }
        if (page.view) clickActivityAny([page.view]);
        if (page.id === 'panel') ensureTerminalPanel();
    }

    function rebuildPages() {
        pages = [
            { id: 'agent', sel: '.part.sidebar', label: 'Agent', overlay: true, agent: true },
            { id: 'editor', sel: '.part.editor', label: 'Editor' },
            { id: 'panel', sel: '.part.panel', label: 'Terminal' }
        ];
        if (pageIndex >= pages.length) pageIndex = pages.length - 1;
        if (pageIndex < 0) pageIndex = 0;
    }

    function paintDots() {
        var host = document.getElementById(DOTS_ID);
        if (!host) return;
        host.innerHTML = '';
        var i, d;
        for (i = 0; i < pages.length; i++) {
            d = document.createElement('i');
            if (i === pageIndex) d.className = 'on';
            host.appendChild(d);
        }
    }

    function clearActive() {
        var marked = document.querySelectorAll('.vscodroid-pager-active');
        var i;
        for (i = 0; i < marked.length; i++) marked[i].classList.remove('vscodroid-pager-active');
    }

    function fillImportant(node, w, h) {
        if (!node || !node.style) return;
        var wantW = w + 'px';
        var wantH = h + 'px';
        // Writing the same size again still resizes the iframe in Chromium.
        // A chat webview (Cline and the same kind of agent) treats that resize
        // as "stick to the latest message", so scrolling up to read a finished
        // task is pulled back to the bottom. The editor and the terminal do
        // the same with the caret and the prompt.
        if (node.style.getPropertyValue('width') === wantW
            && node.style.getPropertyValue('height') === wantH) return;
        setStyle(node, 'width', wantW, true);
        setStyle(node, 'height', wantH, true);
        setStyle(node, 'max-width', 'none', true);
        setStyle(node, 'max-height', 'none', true);
    }

    function fillShadowIframes(root, w, h) {
        if (!root) return;
        var all = root.querySelectorAll('*');
        var i, sr, iframe;
        for (i = 0; i < all.length; i++) {
            sr = all[i].shadowRoot;
            if (!sr) continue;
            iframe = sr.querySelector('iframe');
            if (iframe) fillImportant(iframe, w, h);
        }
    }

    function isXtermNode(node) {
        if (!node || !node.classList) return false;
        return node.classList.contains('xterm')
            || node.classList.contains('xterm-screen')
            || node.classList.contains('xterm-scrollable-element')
            || node.tagName === 'CANVAS';
    }

    // VS Code positions the webview overlay with CSS anchor positioning: the
    // overlay and its clip host follow the `anchor-name` element that lives
    // inside the view pane. Give those anchors the page size and the overlay
    // follows on its own, so nothing here has to force the overlay's box.
    function fillAnchors(root, w, h) {
        if (!root) return 0;
        var nodes = root.querySelectorAll('[style*="anchor-name"]');
        var i;
        for (i = 0; i < nodes.length; i++) fillImportant(nodes[i], w, h);
        return nodes.length;
    }

    function stretchInner(el, w, h) {
        var sel = [
            '.split-view-view',
            '.split-view-container',
            '.monaco-split-view2',
            '.monaco-grid-branch-node',
            '.monaco-pane-view',
            '.composite.viewlet',
            '.pane-body',
            '.pane',
            '.terminal-wrapper',
            '.terminal-split-pane',
            '.terminal-xterm-host',
            '.terminal-outer-container',
            '.webview',
            '.webview-container',
            'iframe'
        ].join(',');
        var nodes = el.querySelectorAll(sel);
        var i, node;
        for (i = 0; i < nodes.length; i++) {
            node = nodes[i];
            if (node.classList && node.classList.contains('title')) continue;
            if (isXtermNode(node)) continue;
            fillImportant(node, w, h);
        }
        fillShadowIframes(el, w, h);
    }

    function hidePanelTabStrip(el, pageW) {
        if (!el) return;
        var splits = el.querySelectorAll('.split-view-view');
        var i, r;
        for (i = 0; i < splits.length; i++) {
            r = splits[i].getBoundingClientRect();
            if (r.width < 48 || r.height < 48) continue;
            if (r.left > pageW * 0.35) {
                splits[i].classList.add('vscodroid-pager-tabstrip');
                setStyle(splits[i], 'display', 'none', true);
            }
        }
    }

    // The Kai webview is anchor-positioned (CSS `anchor()`) to a node inside
    // the sidebar, and so is the host that clips it. An anchor inside a
    // `position: fixed` subtree is laid out after the host and gets
    // rejected; the host then collapses and the webview is never painted.
    // So the Kai page keeps the sidebar absolutely positioned in the grid
    // and offsets it to the viewport origin instead of pinning it fixed.
    function pinInGrid(el, w, h) {
        var slot = el.parentElement;
        if (!slot) return;
        var sr = slot.getBoundingClientRect();
        setStyle(el, 'position', 'absolute', true);
        var nextLeft = Math.round(-sr.left);
        var nextTop = Math.round(-sr.top);
        var haveLeft = parseInt(el.style.getPropertyValue('left'), 10);
        var haveTop = parseInt(el.style.getPropertyValue('top'), 10);
        // A 1px wobble here moves the anchor, the webview resizes, and the
        // chat scrolls itself back to the bottom.
        if (isNaN(haveLeft) || Math.abs(haveLeft - nextLeft) > 1) {
            setStyle(el, 'left', nextLeft + 'px', true);
        }
        if (isNaN(haveTop) || Math.abs(haveTop - nextTop) > 1) {
            setStyle(el, 'top', nextTop + 'px', true);
        }
        setStyle(el, 'right', 'auto', true);
        setStyle(el, 'bottom', 'auto', true);
        fillImportant(el, w, h);
        var p = slot;
        while (p && p !== document.body && !(p.classList && p.classList.contains('monaco-workbench'))) {
            setStyle(p, 'overflow', 'visible', true);
            p = p.parentElement;
        }
    }

    function nudgeKaiOverlay() {
        var el = document.querySelector('.webview-overlay-content');
        if (!el) return;
        unsetStyle(el, 'visibility');
        setStyle(el, 'opacity', '1', true);
        setStyle(el, 'pointer-events', 'auto', true);
        setStyle(el, 'z-index', '100003', true);
    }

    function nudgeLayout(page) {
        // Scroll-locked (user reading a Cline task): resize only via the
        // cheap grid-fit path, never a full applyLayout. A full pass writes
        // the chat webview size through fillImportant, which Chromium
        // resizes the iframe for even when unchanged, and Cline answers
        // that with scrollToBottom.
        if (userScrollLock) {
            try {
                if (page && page.id === 'panel') {
                    var w = viewportWidth();
                    fitPanelGrid(w);
                }
            } catch (e) { /* size-only best effort */ }
            return;
        }
        var now = Date.now();
        if (now - nudgeWindow > 1000) {
            nudgeWindow = now;
            nudgeCount = 0;
        }
        nudgeCount += 1;
        if (layoutBusy || nudgeCount > 20) return;
        layoutBusy = true;
        try {
            applyLayout(page);
        } finally {
            layoutBusy = false;
        }
    }

    // VS Code sizes the terminal (xterm cols) from its grid, and on every
    // layout the grid takes its width from the workbench's parent (body).
    // In portrait the grid is wider than the viewport (min widths), so the
    // panel column is only ~300px. While the panel page is shown, widen the
    // body so the panel column grows until VS Code itself fits xterm to the
    // page width; the pinned pages are viewport-fixed so nothing else moves.
    // VS Code's workbench measures the main window with window.innerWidth
    // (getClientArea on body), so that is the only knob that reaches the
    // grid. innerWidth is [Replaceable]; shadow it with a getter while the
    // panel page is shown and put the original accessor back afterwards.
    var XTERM_CHROME_PX = 40; // scrollbar + padding VS Code keeps beside .xterm-screen
    var XTERM_FIT_TOLERANCE_PX = 12; // just over one terminal cell
    var gridWidened = 0;
    var innerWidthDesc = null;
    try {
        innerWidthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth') || null;
    } catch (e) {
        innerWidthDesc = null;
    }
    if (innerWidthDesc && typeof innerWidthDesc.get !== 'function') innerWidthDesc = null;

    // Page width that is immune to the innerWidth shadow.
    function viewportWidth() {
        var w = document.documentElement && document.documentElement.clientWidth;
        if (!w && window.visualViewport) w = window.visualViewport.width;
        if (!w) w = innerWidthDesc ? innerWidthDesc.get.call(window) : window.innerWidth;
        return Math.max(1, Math.round(w));
    }

    function shadowInnerWidth(px) {
        if (!innerWidthDesc) return false;
        Object.defineProperty(window, 'innerWidth', {
            configurable: true,
            enumerable: true,
            get: function () { return px; }
        });
        return true;
    }

    function unshadowInnerWidth() {
        if (!innerWidthDesc) return;
        Object.defineProperty(window, 'innerWidth', innerWidthDesc);
    }

    function fitPanelGrid(w) {
        var screen = document.querySelector('.terminal-wrapper.active .xterm-screen');
        if (!screen || !innerWidthDesc) return null;
        var screenW = parseFloat(screen.style.width) || 0;
        if (!screenW) return null;
        var target = w - XTERM_CHROME_PX;
        var delta = target - screenW;
        var current = gridWidened || w;
        var info = { screenW: screenW, target: target, delta: delta, current: current, applied: false };
        if (Math.abs(delta) <= XTERM_FIT_TOLERANCE_PX) return info;
        var next = Math.round(Math.max(w, Math.min(w * 3, current + delta)));
        if (Math.abs(next - current) < 4) return info;
        if (!shadowInnerWidth(next)) return info;
        gridWidened = next;
        info.applied = true;
        info.next = next;
        window.dispatchEvent(new Event('resize'));
        return info;
    }

    function resetPanelGrid() {
        if (!gridWidened) return;
        gridWidened = 0;
        unshadowInnerWidth();
        window.dispatchEvent(new Event('resize'));
    }

    var laidOutKey = '';

    function applyLayout(page) {
        var onKai = isOverlayPage(page);
        var w = viewportWidth();
        var h = pagerHeight();
        var id = page && page.id ? page.id : '';
        // Same page, same viewport: do not touch the webview. Scrolling a
        // finished Cline task, a file, or the terminal must not be answered
        // with another layout pass.
        var collapsed = id === 'agent' && !sidebarShown();
        var key = id + '@' + w + 'x' + h;
        if (!collapsed && key === laidOutKey) {
            // The grid fit is allowed to settle after the page size is already
            // recorded. It does not resize the agent or editor webview.
            // Opening a file or a terminal shifts the grid under the pinned
            // page. The offset has to follow or the page slides off and the
            // hidden parts show through, which is the fullscreen being broken.
            if (id === 'panel') fitPanelGrid(w);
            if (id === 'agent') {
                var pinned = document.querySelector('.part.sidebar');
                if (pinned) pinInGrid(pinned, w, h);
            }
            return;
        }
        if (page && page.id === 'panel') fitPanelGrid(w);
        else resetPanelGrid();
        // The Kai webview is an overlay anchored to the Kai view inside the
        // sidebar, so the sidebar is what gets laid out; the overlay follows.
        var el = onKai
            ? document.querySelector('.part.sidebar')
            : (page && page.sel ? document.querySelector(page.sel) : null);
        if (!el) return;
        var title = null;
        var content = null;
        var child;
        var ci;
        for (ci = 0; ci < el.children.length; ci++) {
            child = el.children[ci];
            if (!title && child.classList && child.classList.contains('title')) title = child;
            if (!content && child.classList && child.classList.contains('content')) content = child;
        }
        var titleH = 0;
        fillImportant(el, w, h);
        // Agent and terminal pages spend their header on a label the page
        // itself already shows. The editor's title is the tab strip.
        if (title && id !== 'agent' && id !== 'panel') {
            setStyle(title, 'width', '100%', true);
            setStyle(title, 'height', 'auto', true);
            setStyle(title, 'max-height', '48px', true);
            titleH = Math.round(title.getBoundingClientRect().height) || 35;
        }
        var bodyH = Math.max(1, h - titleH);
        if (content) {
            setStyle(content, 'position', 'absolute', true);
            setStyle(content, 'left', '0', true);
            setStyle(content, 'right', '0', true);
            setStyle(content, 'bottom', '0', true);
            setStyle(content, 'top', titleH + 'px', true);
            setStyle(content, 'width', 'auto', true);
            setStyle(content, 'height', 'auto', true);
            setStyle(content, 'max-width', 'none', true);
            setStyle(content, 'max-height', 'none', true);
        }
        stretchInner(content || el, w, bodyH);
        var viewlet = el.querySelector('.composite.viewlet, iframe.webview');
        if (viewlet) fillImportant(viewlet, w, bodyH);
        if (onKai) {
            setStyle(el, 'display', 'block', true);
            pinInGrid(el, w, h);
            var anchored = fillAnchors(content || el, w, bodyH);
            var overlay = document.querySelector('.webview-overlay-content');
            if (overlay) {
                // Anchor positioning is what VS Code uses for these webviews.
                // When the anchor is missing or rejected inside a fixed subtree,
                // size the overlay itself so the composer is not a short strip.
                if (!anchored) fillImportant(overlay, w, h);
                fillShadowIframes(overlay, w, bodyH);
                var frame = overlay.querySelector('iframe');
                if (frame) fillImportant(frame, w, bodyH);
            }
            nudgeKaiOverlay();
        }
        if (page && page.id === 'panel') {
            var composite = el.querySelector('.composite.panel');
            var paneBody = el.querySelector('.pane-body');
            var splits = el.querySelectorAll('.split-view-view, .terminal-split-pane, .terminal-wrapper.active');
            var si;
            if (composite) fillImportant(composite, w, bodyH);
            if (paneBody) fillImportant(paneBody, w, bodyH);
            for (si = 0; si < splits.length; si++) {
                if (!splits[si].classList.contains('vscodroid-pager-tabstrip')) {
                    fillImportant(splits[si], w, bodyH);
                }
            }
            // Terminal/xterm completeness: xterm fits cols from the pixel
            // width it measures, and a 1px shortfall drops the last column
            // plus the bottom row under the pager. Re-run the grid fit AFTER
            // the fills above so VS Code re-fits xterm to the final width,
            // and nudge the active xterm-screen to the full body height so
            // no row is clipped when the IME is up.
            try {
                fitPanelGrid(w);
                var xscreen = el.querySelector('.terminal-wrapper.active .xterm-screen');
                if (xscreen) fillImportant(xscreen, w, bodyH);
                var xrows = el.querySelector('.terminal-wrapper.active .xterm-rows');
                if (xrows) fillImportant(xrows, w, bodyH);
            } catch (e) { /* completeness best effort */ }
            hidePanelTabStrip(el, w);
        }
        // Editor completeness: Monaco measures its container on layout; if the
        // fill above left it 1px short the last line/hscroll sits under the
        // pager. Re-assert the editor content box to the full body height.
        if (page && page.id === 'editor') {
            try {
                var edContent = el.querySelector('.content');
                if (edContent) fillImportant(edContent, w, bodyH);
                var monaco = el.querySelector('.monaco-editor');
                if (monaco) fillImportant(monaco, w, bodyH);
            } catch (e) { /* completeness best effort */ }
        }
        laidOutKey = key;
    }

    function watchPage(page) {
        if (sidebarWatch) {
            sidebarWatch.disconnect();
            sidebarWatch = null;
        }
        if (overlayWatch) {
            overlayWatch.disconnect();
            overlayWatch = null;
        }
        if (!page) return;
        var content = isOverlayPage(page)
            ? (document.querySelector('.webview-overlay-content')
                || document.querySelector(page.sel + ' .content')
                || document.querySelector(page.sel))
            : (document.querySelector(page.sel + ' .content') || document.querySelector(page.sel));
        if (!content || typeof MutationObserver === 'undefined') return;
        // Not the subtree. Monaco rewrites a line on every scroll of a file,
        // and a webview host updates while a chat is scrolled; either one used
        // to run a layout pass, resize the iframe, and pull the viewport back
        // to the caret or the latest message.
        if (!isOverlayPage(page) && page.id !== 'editor') {
            sidebarWatch = new MutationObserver(function () {
                if (watchQueued || layoutBusy) return;
                watchQueued = true;
                requestAnimationFrame(function () {
                    watchQueued = false;
                    if (!pagerOn || !pages[pageIndex] || pages[pageIndex].id !== page.id) return;
                    nudgeLayout(page);
                    syncOverlays(page);
                });
            });
            sidebarWatch.observe(content, { childList: true, subtree: true });
        }
        if (isOverlayPage(page)) {
            // Opening a file asks the workbench to collapse the side bar. On
            // this page the side bar IS the screen, so a width of zero has to
            // be put back or the agent webview vanishes under the editor.
            // Class only: the style attribute is what layout itself writes,
            // and watching it relaid out on every scroll-sized tweak.
            var sidePart = document.querySelector('.part.sidebar');
            if (sidePart) {
                sidebarWatch = new MutationObserver(function () {
                    if (watchQueued || layoutBusy || sidebarShown()) return;
                    watchQueued = true;
                    requestAnimationFrame(function () {
                        watchQueued = false;
                        if (!pagerOn || !pages[pageIndex] || pages[pageIndex].id !== page.id) return;
                        if (!sidebarShown()) nudgeLayout(page);
                    });
                });
                sidebarWatch.observe(sidePart, { attributes: true, attributeFilter: ['class'] });
            }
        }
        if (page.id === 'panel') {
            // xterm rewrites .xterm-screen's inline size whenever VS Code
            // re-fits the terminal; that is the moment to re-check the fit.
            var screen = content.querySelector('.terminal-wrapper.active .xterm-screen');
            if (screen) sidebarWatch.observe(screen, { attributes: true, attributeFilter: ['style'] });
        }
        overlayWatch = new MutationObserver(function () {
            syncOverlays(page);
            // An agent opening a file or a terminal reveals that part with an
            // inline visibility that beats the stylesheet. Re-hide it when it
            // actually paints; a part we already hid must not schedule again.
            if (foreignPartVisible()) queueEnforce();
        });
        var wb = document.querySelector('.monaco-workbench') || document.body;
        overlayWatch.observe(wb, { childList: true });
        var revealed = document.querySelectorAll('.part.editor, .part.panel');
        var ri;
        for (ri = 0; ri < revealed.length; ri++) {
            overlayWatch.observe(revealed[ri], { attributes: true, attributeFilter: ['class', 'style'] });
        }
    }

    function scheduleNudges(page, left) {
        if (!left) left = 5;
        requestAnimationFrame(function () {
            if (!pagerOn || !pages[pageIndex] || pages[pageIndex].id !== page.id) return;
            nudgeLayout(page);
            syncOverlays(page);
            if (left > 1) scheduleNudges(page, left - 1);
        });
    }

    function syncOverlays(page) {
        var onKai = isOverlayPage(page) && pagerOn;
        document.body.classList.toggle('vscodroid-pager-kai', onKai);
        var overlays = document.querySelectorAll('.webview-overlay-content');
        var i, el;
        for (i = 0; i < overlays.length; i++) {
            el = overlays[i];
            if (onKai) {
                unsetStyle(el, 'visibility');
                setStyle(el, 'opacity', '1', true);
                setStyle(el, 'pointer-events', 'auto', true);
                setStyle(el, 'z-index', '100003', true);
            } else if (pagerOn) {
                setStyle(el, 'opacity', '0', true);
                setStyle(el, 'pointer-events', 'none', true);
                unsetStyle(el, 'z-index');
            }
        }
    }

    function showPage(i) {
        if (!pages.length) rebuildPages();
        if (i < 0 || i >= pages.length) return false;
        var page = pages[i];
        if (page.id === 'panel') {
            var openedTerminal = ensureTerminalPanel();
            var panel = document.querySelector('.part.panel');
            // A panel that is still empty, and that nothing managed to open,
            // is a blank page. Stay where we are.
            if ((!panel || panel.classList.contains('empty')) && !openedTerminal) return false;
        }
        // Switching onto a part that is not in the document hides the page the
        // user can see and leaves nothing in its place.
        if (!document.querySelector(page.sel)) return false;
        pageIndex = i;
        revealPageView(page);
        clearActive();
        var el = document.querySelector(page.sel);
        if (el) {
            el.classList.add('vscodroid-pager-active');
            if (!page.overlay) {
                var host = el.parentElement;
                if (host && host.classList && host.classList.contains('split-view-view')) {
                    host.classList.add('vscodroid-pager-active');
                }
            }
        }
        if (page.overlay) {
            var side = document.querySelector('.part.sidebar');
            if (side) side.classList.add('vscodroid-pager-active');
        }
        syncOverlays(page);
        paintDots();
        watchPage(page);
        scheduleNudges(page, 5);
        enforceCurrentPage();
        return true;
    }

    function enterPager(startId) {
        if (!portrait()) return;
        ensureStyle();
        ensureDots();
        clearImportantStyles();
        rebuildPages();
        pagerOn = true;
        document.body.classList.add('vscodroid-pager');
        var idx = 1;
        var i;
        for (i = 0; i < pages.length; i++) {
            if (pages[i].id === startId) { idx = i; break; }
        }
        showPage(idx);
    }

    function exitPager() {
        pagerOn = false;
        document.body.classList.remove('vscodroid-pager');
        if (sidebarWatch) {
            sidebarWatch.disconnect();
            sidebarWatch = null;
        }
        if (overlayWatch) {
            overlayWatch.disconnect();
            overlayWatch = null;
        }
        clearActive();
        document.body.classList.remove('vscodroid-pager-kai');
        document.body.classList.remove('vscodroid-pager-hold');
        resetPanelGrid();
        laidOutKey = '';
        restoreStyles();
        paintDots();
        try {
            window.dispatchEvent(new Event('resize'));
            if (window.visualViewport) {
                window.visualViewport.dispatchEvent(new Event('resize'));
            }
        } catch (_e) {}
    }

    function pointerCount() {
        return Object.keys(pointers).length;
    }

    function pairDistance() {
        var ids = Object.keys(pointers);
        if (ids.length < 2) return 0;
        var a = pointers[ids[0]];
        var b = pointers[ids[1]];
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function startIdFromTarget(target) {
        var n = target;
        while (n && n.classList) {
            if (n.classList.contains('sidebar')) return 'agent';
            if (n.classList.contains('editor') || n.classList.contains('editor-container')) return 'editor';
            if (n.classList.contains('panel')) return 'panel';
            n = n.parentElement;
        }
        return 'editor';
    }

    function stepPage(delta) {
        if (!portrait() || !delta) return false;
        if (!pagerOn) enterPager(startIdFromTarget(document.activeElement));
        var next = pageIndex + delta;
        if (next < 0 || next >= pages.length) return false;
        return showPage(next);
    }

    function considerPinch(target) {
        if (!pinchActive || pointerCount() < 2) return;
        var dist = pairDistance();
        if (!pagerOn && pinchStart - dist > PINCH_IN) {
            enterPager(startIdFromTarget(target));
            pinchStart = dist;
        } else if (pagerOn && dist - pinchStart > PINCH_OUT) {
            exitPager();
            pinchStart = dist;
        }
    }

    var holdQueued = false;
    function queueEnforce() {
        if (!pagerOn || holdQueued) return;
        holdQueued = true;
        requestAnimationFrame(function () {
            holdQueued = false;
            if (!pagerOn) return;
            enforceCurrentPage(true);
        });
    }

    document.addEventListener('focusin', function (e) {
        if (!pagerOn) return;
        var n = e.target;
        while (n && n.classList) {
            if (n.classList.contains('editor') || n.classList.contains('panel')
                || n.classList.contains('terminal') || n.classList.contains('xterm')) {
                queueEnforce();
                return;
            }
            n = n.parentElement;
        }
    }, true);

    document.addEventListener('pointerdown', function (e) {
        if (!portrait()) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (pointerCount() >= 2) {
            pinchStart = pairDistance();
            pinchActive = true;
        }
    }, true);

    document.addEventListener('pointermove', function (e) {
        if (!pointers[e.pointerId]) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        considerPinch(e.target);
    }, true);

    document.addEventListener('pointerup', function (e) {
        delete pointers[e.pointerId];
        if (pointerCount() < 2) pinchActive = false;
    }, true);

    document.addEventListener('pointercancel', function (e) {
        delete pointers[e.pointerId];
        pinchActive = false;
    }, true);

    window.addEventListener('orientationchange', function () {
        if (!portrait() && pagerOn) exitPager();
    });

    window.__vscodroidPager = {
        nativePinch: function (dir) {
            if (dir === 'in' && !pagerOn && portrait()) {
                enterPager(startIdFromTarget(document.activeElement));
            } else if (dir === 'out' && pagerOn) {
                exitPager();
            }
        },
        stepPage: stepPage,
        go: function (id) {
            if (!pagerOn) return false;
            rebuildPages();
            var i;
            for (i = 0; i < pages.length; i++) {
                if (pages[i].id === id) {
                    showPage(i);
                    return true;
                }
            }
            return false;
        }
    };
})();
