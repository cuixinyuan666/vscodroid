(function () {
    if (window.__vscodroidPagerInstalled) return;
    window.__vscodroidPagerInstalled = true;

    var STYLE_ID = 'vscodroid-pager-css';
    var DOTS_ID = 'vscodroid-pager-dots';
    var PINCH_IN = 8;
    var PINCH_OUT = 32;
    var SWIPE_PX = 48;
    var pointers = {};
    var pinchStart = 0;
    var pinchActive = false;
    var swipeStart = null;
    var usedOptional = {};
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

    function pagerHeight() {
        var vv = window.visualViewport;
        var h = vv && vv.height ? vv.height : window.innerHeight;
        return Math.max(1, Math.round(h) - 22);
    }

    if (window.visualViewport && !window.__vscodroidPagerVvHook) {
        window.__vscodroidPagerVvHook = true;
        window.visualViewport.addEventListener('resize', function () {
            if (!pagerOn || !pages.length || layoutBusy) return;
            var page = pages[pageIndex];
            nudgeLayout(page);
            syncOverlays(page);
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
            // The grid may be laid out wider than the viewport while the
            // panel page fits its terminal; keep the status bar on screen.
            'body.vscodroid-pager .monaco-workbench .part.statusbar {',
            '  left: 0 !important;',
            '  width: 100vw !important;',
            '}',
            'body.vscodroid-pager .monaco-workbench .part.vscodroid-pager-active,',
            'body.vscodroid-pager .split-view-view.vscodroid-pager-active {',
            '  position: fixed !important;',
            '  top: 0 !important;',
            '  left: 0 !important;',
            '  right: 0 !important;',
            '  bottom: 22px !important;',
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
            'body.vscodroid-pager .part.statusbar {',
            '  z-index: 100001 !important;',
            '  visibility: visible !important;',
            '}',
            '#' + DOTS_ID + ' {',
            '  position: fixed;',
            '  left: 0; right: 0;',
            '  bottom: 28px;',
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

    function revealPageView(page) {
        if (!page) return;
        if (page.id === 'kai') {
            if (!isKaiSidebar()) clickActivityAny(['kai']);
            return;
        }
        if (page.id === 'explorer') {
            if (isKaiSidebar() || !/explorer|资源管理器|檔案總管/.test(sidebarTitle())) {
                clickActivityAny(['explorer', '资源管理器', '檔案總管']);
            }
            return;
        }
        if (page.view) clickActivityAny([page.view]);
        if (page.id === 'chat') clickActivityAny(['chat', '聊天']);
        if (page.id === 'panel') ensureTerminalPanel();
    }

    function activityHas(needle) {
        var items = document.querySelectorAll('.activitybar .action-label, .activitybar .action-item, .activitybar [aria-label]');
        var i, t;
        needle = needle.toLowerCase();
        for (i = 0; i < items.length; i++) {
            t = (items[i].getAttribute('aria-label') || items[i].title || items[i].textContent || '').toLowerCase();
            if (t.indexOf(needle) >= 0) return true;
        }
        return false;
    }

    function sidebarTitle() {
        var el = document.querySelector('.part.sidebar .composite.title')
            || document.querySelector('.part.sidebar .pane-header');
        return ((el && (el.textContent || el.getAttribute('aria-label'))) || '').toLowerCase();
    }

    function isKaiSidebar() {
        if (sidebarTitle().indexOf('kai') >= 0) return true;
        var items = document.querySelectorAll('.activitybar .action-item.checked .action-label, .activitybar .checked .action-label');
        var i, t;
        for (i = 0; i < items.length; i++) {
            t = (items[i].getAttribute('aria-label') || items[i].title || '').toLowerCase();
            if (t.indexOf('kai') >= 0) return true;
        }
        return false;
    }

    function kaiPageAvailable() {
        return usedOptional.kai || isKaiSidebar() || activityHas('kai');
    }

    function partVisible(sel) {
        var el = document.querySelector(sel);
        if (!el) return false;
        var r = el.getBoundingClientRect();
        return r.width > 24 && r.height > 24;
    }

    function rebuildPages() {
        pages = [
            { id: 'explorer', sel: '.part.sidebar', label: 'Explorer' },
            { id: 'editor', sel: '.part.editor', label: 'Editor' },
            { id: 'panel', sel: '.part.panel', label: 'Terminal' }
        ];
        if (kaiPageAvailable()) {
            pages.splice(1, 0, { id: 'kai', sel: '.webview-overlay-content', label: 'Kai', view: 'kai', overlay: true });
        }
        if (usedOptional.search || partVisible('.part.sidebar .search-view, .part.sidebar .search-editor')) {
            pages.splice(kaiPageAvailable() ? 2 : 1, 0, { id: 'search', sel: '.part.sidebar', label: 'Search', view: 'search' });
        }
        if (usedOptional.scm || partVisible('.part.sidebar .scm-view')) {
            pages.splice(pages.length - 1, 0, { id: 'scm', sel: '.part.sidebar', label: 'Git', view: 'scm' });
        }
        if (usedOptional.extensions) {
            pages.splice(pages.length - 1, 0, {
                id: 'extensions', sel: '.part.sidebar', label: 'Extensions', view: 'extensions'
            });
        }
        if (partVisible('.part.auxiliarybar') || usedOptional.chat) {
            pages.push({ id: 'chat', sel: '.part.auxiliarybar', label: 'Chat' });
        }
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
        setStyle(node, 'width', w + 'px', true);
        setStyle(node, 'height', h + 'px', true);
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
        setStyle(el, 'left', Math.round(-sr.left) + 'px', true);
        setStyle(el, 'top', Math.round(-sr.top) + 'px', true);
        setStyle(el, 'right', 'auto', true);
        setStyle(el, 'bottom', 'auto', true);
        setStyle(el, 'width', w + 'px', true);
        setStyle(el, 'height', h + 'px', true);
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

    function applyLayout(page) {
        var onKai = !!(page && page.id === 'kai');
        if (page && page.id === 'panel') fitPanelGrid(viewportWidth());
        else resetPanelGrid();
        // The Kai webview is an overlay anchored to the Kai view inside the
        // sidebar, so the sidebar is what gets laid out; the overlay follows.
        var el = onKai
            ? document.querySelector('.part.sidebar')
            : (page && page.sel ? document.querySelector(page.sel) : null);
        if (!el) return;
        var w = viewportWidth();
        var h = pagerHeight();
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
        if (title) {
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
            pinInGrid(el, w, h);
            fillAnchors(content || el, w, bodyH);
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
            hidePanelTabStrip(el, w);
        }
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
        var content = page.id === 'kai'
            ? document.querySelector('.webview-overlay-content')
            : (document.querySelector(page.sel + ' .content') || document.querySelector(page.sel));
        if (!content || typeof MutationObserver === 'undefined') return;
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
        if (page.id === 'panel') {
            // xterm rewrites .xterm-screen's inline size whenever VS Code
            // re-fits the terminal; that is the moment to re-check the fit.
            var screen = content.querySelector('.terminal-wrapper.active .xterm-screen');
            if (screen) sidebarWatch.observe(screen, { attributes: true, attributeFilter: ['style'] });
        }
        overlayWatch = new MutationObserver(function () {
            syncOverlays(page);
        });
        var wb = document.querySelector('.monaco-workbench') || document.body;
        overlayWatch.observe(wb, { childList: true });
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
        var onKai = !!(page && page.id === 'kai' && pagerOn);
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
        if (i < 0) i = 0;
        if (i >= pages.length) i = pages.length - 1;
        pageIndex = i;
        var page = pages[pageIndex];
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
        resetPanelGrid();
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
            if (n.classList.contains('sidebar')) return isKaiSidebar() ? 'kai' : 'explorer';
            if (n.classList.contains('editor') || n.classList.contains('editor-container')) return 'editor';
            if (n.classList.contains('panel')) return 'panel';
            if (n.classList.contains('auxiliarybar')) return 'chat';
            n = n.parentElement;
        }
        return isKaiSidebar() ? 'kai' : 'editor';
    }

    function noteActivityClick(target) {
        var n = target;
        while (n && n.getAttribute) {
            var label = (n.getAttribute('aria-label') || n.title || '').toLowerCase();
            if (label.indexOf('search') >= 0) usedOptional.search = true;
            if (label.indexOf('source control') >= 0 || label.indexOf('git') >= 0) usedOptional.scm = true;
            if (label.indexOf('extensions') >= 0) usedOptional.extensions = true;
            if (label.indexOf('chat') >= 0) usedOptional.chat = true;
            if (label.indexOf('kai') >= 0) usedOptional.kai = true;
            n = n.parentElement;
        }
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

    document.addEventListener('click', function (e) {
        noteActivityClick(e.target);
        if (pagerOn) {
            rebuildPages();
            paintDots();
        }
    }, true);

    document.addEventListener('pointerdown', function (e) {
        if (!portrait()) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (pointerCount() >= 2) {
            pinchStart = pairDistance();
            pinchActive = true;
            swipeStart = null;
        } else if (pointerCount() === 1 && pagerOn) {
            swipeStart = { x: e.clientX, y: e.clientY };
        }
    }, true);

    document.addEventListener('pointermove', function (e) {
        if (!pointers[e.pointerId]) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        considerPinch(e.target);
    }, true);

    document.addEventListener('pointerup', function (e) {
        if (pagerOn && swipeStart && e.pointerId in pointers && pointerCount() === 1) {
            var dx = e.clientX - swipeStart.x;
            var dy = e.clientY - swipeStart.y;
            if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
                if (dx > 0) showPage(pageIndex - 1);
                if (dx < 0) showPage(pageIndex + 1);
            }
        }
        delete pointers[e.pointerId];
        if (pointerCount() < 2) pinchActive = false;
        if (pointerCount() === 0) swipeStart = null;
    }, true);

    document.addEventListener('pointercancel', function (e) {
        delete pointers[e.pointerId];
        pinchActive = false;
        swipeStart = null;
    }, true);

    window.addEventListener('orientationchange', function () {
        if (!portrait() && pagerOn) exitPager();
    });

    window.__vscodroidPager = {
        nativePinch: function (dir) {
            if (dir === 'in' && !pagerOn && portrait()) {
                enterPager(isKaiSidebar() ? 'kai' : 'editor');
            } else if (dir === 'out' && pagerOn) {
                exitPager();
            }
        },
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
