(function () {
    if (window.__vscodroidPagerInstalled) return;
    window.__vscodroidPagerInstalled = true;

    var STYLE_ID = 'vscodroid-pager-css';
    var DOTS_ID = 'vscodroid-pager-dots';
    var EDGE_PX = 28;
    var PINCH_IN = 48;
    var PINCH_OUT = 48;
    var SWIPE_PX = 56;
    var pointers = {};
    var pinchStart = 0;
    var pinchActive = false;
    var edgeStart = null;
    var usedOptional = {};
    var pages = [];
    var pageIndex = 0;
    var pagerOn = false;

    function portrait() {
        return window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
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
            'body.vscodroid-pager .monaco-workbench .part.sidebar,',
            'body.vscodroid-pager .monaco-workbench .part.editor,',
            'body.vscodroid-pager .monaco-workbench .part.panel,',
            'body.vscodroid-pager .monaco-workbench .part.auxiliarybar {',
            '  visibility: hidden !important;',
            '}',
            'body.vscodroid-pager .monaco-workbench .part.vscodroid-pager-active,',
            'body.vscodroid-pager .split-view-view.vscodroid-pager-active {',
            '  position: fixed !important;',
            '  top: 0 !important;',
            '  left: 0 !important;',
            '  right: 0 !important;',
            '  bottom: 22px !important;',
            '  width: auto !important;',
            '  height: auto !important;',
            '  max-width: none !important;',
            '  max-height: none !important;',
            '  visibility: visible !important;',
            '  z-index: 100000 !important;',
            '  overflow: visible !important;',
            '}',
            'body.vscodroid-pager .split-view-view.vscodroid-pager-active .part {',
            '  visibility: visible !important;',
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
        var items = document.querySelectorAll('.activitybar .action-label');
        var i, t;
        needle = needle.toLowerCase();
        for (i = 0; i < items.length; i++) {
            t = (items[i].getAttribute('aria-label') || items[i].title || '').toLowerCase();
            if (t.indexOf(needle) >= 0) {
                items[i].click();
                return true;
            }
        }
        return false;
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
        if (usedOptional.search || partVisible('.part.sidebar .search-view, .part.sidebar .search-editor')) {
            pages.splice(1, 0, { id: 'search', sel: '.part.sidebar', label: 'Search', view: 'search' });
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

    function showPage(i) {
        if (!pages.length) rebuildPages();
        if (i < 0) i = 0;
        if (i >= pages.length) i = pages.length - 1;
        pageIndex = i;
        var page = pages[pageIndex];
        if (page.view) clickActivity(page.view);
        if (page.id === 'explorer') clickActivity('explorer');
        if (page.id === 'chat') clickActivity('chat');
        clearActive();
        var el = document.querySelector(page.sel);
        if (el) {
            el.classList.add('vscodroid-pager-active');
            var host = el.parentElement;
            if (host && host.classList && host.classList.contains('split-view-view')) {
                host.classList.add('vscodroid-pager-active');
            }
        }
        paintDots();
    }

    function enterPager(startId) {
        if (!portrait()) return;
        ensureStyle();
        ensureDots();
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
        clearActive();
        paintDots();
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
            if (n.classList.contains('sidebar')) return 'explorer';
            if (n.classList.contains('editor') || n.classList.contains('editor-container')) return 'editor';
            if (n.classList.contains('panel')) return 'panel';
            if (n.classList.contains('auxiliarybar')) return 'chat';
            n = n.parentElement;
        }
        return 'editor';
    }

    function noteActivityClick(target) {
        var n = target;
        while (n && n.getAttribute) {
            var label = (n.getAttribute('aria-label') || n.title || '').toLowerCase();
            if (label.indexOf('search') >= 0) usedOptional.search = true;
            if (label.indexOf('source control') >= 0 || label.indexOf('git') >= 0) usedOptional.scm = true;
            if (label.indexOf('extensions') >= 0) usedOptional.extensions = true;
            if (label.indexOf('chat') >= 0) usedOptional.chat = true;
            n = n.parentElement;
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
        if (pointerCount() === 2) {
            pinchStart = pairDistance();
            pinchActive = true;
            edgeStart = null;
        } else if (pointerCount() === 1 && pagerOn) {
            var x = e.clientX;
            if (x <= EDGE_PX || x >= window.innerWidth - EDGE_PX) {
                edgeStart = { x: x, y: e.clientY, fromLeft: x <= EDGE_PX };
            } else {
                edgeStart = null;
            }
        }
    }, true);

    document.addEventListener('pointermove', function (e) {
        if (!pointers[e.pointerId]) return;
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
        if (pinchActive && pointerCount() >= 2) {
            var dist = pairDistance();
            if (!pagerOn && pinchStart - dist > PINCH_IN) {
                enterPager(startIdFromTarget(e.target));
                pinchStart = dist;
            } else if (pagerOn && dist - pinchStart > PINCH_OUT) {
                exitPager();
                pinchStart = dist;
            }
        }
    }, true);

    document.addEventListener('pointerup', function (e) {
        if (pagerOn && edgeStart && e.pointerId in pointers && pointerCount() === 1) {
            var dx = e.clientX - edgeStart.x;
            var dy = e.clientY - edgeStart.y;
            if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
                if (edgeStart.fromLeft && dx > 0) showPage(pageIndex - 1);
                if (!edgeStart.fromLeft && dx < 0) showPage(pageIndex + 1);
            }
        }
        delete pointers[e.pointerId];
        if (pointerCount() < 2) pinchActive = false;
        if (pointerCount() === 0) edgeStart = null;
    }, true);

    document.addEventListener('pointercancel', function (e) {
        delete pointers[e.pointerId];
        pinchActive = false;
        edgeStart = null;
    }, true);

    window.addEventListener('orientationchange', function () {
        if (!portrait() && pagerOn) exitPager();
    });
})();
