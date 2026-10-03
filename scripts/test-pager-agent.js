/**
 * Self-check for the portrait pager's agent lookup.
 *
 *   node scripts/test-pager-agent.js
 *
 * The failure this exists for: a chevron press on the agent page answered with
 * the extension marketplace instead of the chat already on screen. revealAgent
 * scans the activity bar for a name matching AGENT_NEEDLES and, finding none,
 * falls through to clickActivityAny(['extensions', ...]). It read each item's
 * label from aria-label and title only, while the workbench carries the agent's
 * name on the inner .action-label's text, so every needle missed and the
 * fallback ran.
 *
 * The pager installs itself against window/document at load time and exports no
 * internals, so it is evaluated in a DOM stub rather than required: the stub is
 * the only way to reach revealAgent without adding a test hook to shipped code.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PAGER = path.join(
    __dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'vscodroid-pager.js'
);

/** A node with what itemLabel, itemChecked and showPage touch. */
function el(props) {
    const node = {
        _attrs: props.attrs || {},
        title: props.title || '',
        textContent: props.text || '',
        classList: props.classes || [],
        children: props.children || [],
        // Layout writes land here, so counting them counts the layout passes:
        // nudgeLayout's only outward effect on these nodes is setStyle.
        writes: 0,
        style: {
            setProperty() {
                node.writes++;
            },
            removeProperty() {
                node.writes++;
            },
            getPropertyValue: () => '',
            getPropertyPriority: () => '',
        },
        parentElement: props.parent || null,
        clicked: 0,
        getBoundingClientRect() {
            return { width: 320, height: 720, top: 0, left: 0, right: 320, bottom: 720 };
        },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this._attrs, name)
                ? this._attrs[name]
                : null;
        },
        querySelector(sel) {
            if (sel === '.action-label') return this._label || null;
            return null;
        },
        setAttribute() {},
        appendChild() {},
        removeChild() {},
        querySelectorAll() {
            return [];
        },
        click() {
            this.clicked++;
        },
    };
    node.classList.contains = (c) => node.classList.indexOf(c) >= 0;
    node.classList.add = () => {};
    node.classList.remove = () => {};
    node.classList.toggle = () => {};
    if (props.label) {
        node._label = props.label;
        node._label.parentElement = node;
    }
    return node;
}

/**
 * Run the pager against a stub whose activity bar holds `items`, open the agent
 * page, and report which item it acted on.
 */
function runRevealAgent(items) {
    // showPage refuses a page whose part is not in the document, which is what
    // stops a chevron from hiding everything and leaving a blank screen. The
    // sidebar therefore has to exist here or revealAgent is never reached and
    // every case below would pass for the wrong reason.
    const sidebar = el({ classes: ['part', 'sidebar'] });
    const editor = el({ classes: ['part', 'editor'] });
    const panel = el({ classes: ['part', 'panel'] });
    const parts = { '.part.sidebar': sidebar, '.part.editor': editor, '.part.panel': panel };

    const document = {
        querySelectorAll(sel) {
            if (sel === '.activitybar .action-item') return items;
            if (sel.indexOf('.part.sidebar') >= 0) return [sidebar];
            if (sel.indexOf('.part.editor') >= 0) return [editor];
            if (sel.indexOf('.part.panel') >= 0) return [panel];
            return [];
        },
        querySelector(sel) {
            return parts[sel] || null;
        },
        getElementById() {
            return null;
        },
        createElement() {
            return el({});
        },
        addEventListener() {},
        body: el({}),
        documentElement: el({}),
        activeElement: null,
    };

    const window = {
        matchMedia: () => ({ matches: true }),
        addEventListener() {},
        removeEventListener() {},
        getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
        requestAnimationFrame: (f) => f(),
        cancelAnimationFrame() {},
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        dispatchEvent() {},
        visualViewport: null,
        document,
    };
    window.window = window;
    const ctx = vm.createContext(window);
    ctx.document = document;
    vm.runInContext(fs.readFileSync(PAGER, 'utf8'), ctx, { filename: 'vscodroid-pager.js' });

    const pager = window.__vscodroidPager;
    assert.ok(pager, 'the pager did not install itself');
    const inner = items.map((i) => i._label || i);

    // The agent page is index 0, so the pager has to be on before `go` will
    // take it. stepPage is not the way in: from index 0 a +1 lands on the
    // editor, which reveals nothing.
    pager.nativePinch('in');
    const opened = pager.go('agent');
    assert.strictEqual(opened, true, 'the agent page was refused outright');

    return {
        acted: inner.findIndex((n) => n.clicked > 0),
        clicks: inner,
    };
}

/**
 * The shape that actually shipped: the wrapper names a category, and the name
 * the pager looks for is only on the inner .action-label's text.
 */
function namesOnInnerTextOnly() {
    const label = el({ text: 'Cline' });
    const item = el({ attrs: { 'aria-label': 'Views' }, classes: ['action-item'], label });
    runRevealAgent([item]);
    assert.strictEqual(
        label.clicked, 1,
        'Cline was named only as inner text and the agent page still failed to open it'
    );
}

function namesOnAriaLabel() {
    const label = el({});
    const item = el({ attrs: { 'aria-label': 'Cline' }, classes: ['action-item'], label });
    runRevealAgent([item]);
    assert.strictEqual(label.clicked, 1, 'an aria-label name must still match');
}

function doesNotClickTheOpenAgent() {
    // `checked` is how the workbench marks the view already showing. Clicking it
    // toggles the sidebar shut and takes the page with it.
    const label = el({ text: 'Cline' });
    const item = el({
        attrs: { 'aria-label': 'Views' },
        classes: ['action-item', 'checked'],
        label,
    });
    runRevealAgent([item]);
    assert.strictEqual(
        label.clicked, 0,
        'clicking the agent that is already open toggles the sidebar shut'
    );
}

function prefersClineOverOtherAgents() {
    const roo = el({ text: 'Roo Code' });
    const cline = el({ text: 'Cline' });
    runRevealAgent([
        el({ attrs: { 'aria-label': 'Views' }, classes: ['action-item'], label: roo }),
        el({ attrs: { 'aria-label': 'Views' }, classes: ['action-item'], label: cline }),
    ]);
    assert.strictEqual(roo.clicked, 0, 'Cline outranks Roo by needle order, not position');
    assert.strictEqual(cline.clicked, 1, 'Cline outranks Roo by needle order, not position');
}

function ignoresNonAgentItems() {
    const explorer = el({ attrs: { 'aria-label': 'Explorer' }, classes: ['action-item'] });
    const search = el({ attrs: { 'aria-label': 'Search' }, classes: ['action-item'] });
    runRevealAgent([explorer, search]);
    assert.strictEqual(
        explorer.clicked + search.clicked, 0,
        'neither is an agent, so the agent page must not have opened either'
    );
}

/**
 * The soft keyboard shrinking an adjustResize window fires a burst of
 * visualViewport resizes as it animates. Each one used to run a layout pass,
 * and a layout pass forces the chat webview's size -- which Chromium resizes
 * the iframe for, and which a chat webview answers by scrolling itself back to
 * the latest message. With the keyboard up that read as the composer jumping.
 */
function resizeBurstCollapsesToOneLayout() {
    const slot = el({});
    // pinInGrid offsets the sidebar by its slot's rect and writes that onto the
    // sidebar, so a sidebar with no parent is never written to and the settled
    // size would look like it produced no layout at all.
    const sidebar = el({ classes: ['part', 'sidebar'], parent: slot });
    const editor = el({ classes: ['part', 'editor'] });
    const panel = el({ classes: ['part', 'panel'] });
    let vvHeight = 720;
    const vvListeners = [];
    const parts = { '.part.sidebar': sidebar, '.part.editor': editor, '.part.panel': panel };

    // viewportWidth() reads documentElement.clientWidth and pagerHeight() reads
    // visualViewport.height, so a stub without real numbers on both makes every
    // layout key identical and the settled pass looks like it did nothing.
    const root = el({});
    root.clientWidth = 412;
    const document = {
        querySelectorAll(sel) {
            if (sel.indexOf('.part.sidebar') >= 0) return [sidebar];
            if (sel.indexOf('.part.editor') >= 0) return [editor];
            if (sel.indexOf('.part.panel') >= 0) return [panel];
            return [];
        },
        querySelector(sel) {
            return parts[sel] || null;
        },
        getElementById() {
            return null;
        },
        createElement() {
            return el({});
        },
        addEventListener() {},
        body: el({}),
        documentElement: root,
        activeElement: null,
    };
    const visualViewport = {
        get height() {
            return vvHeight;
        },
        addEventListener(_n, f) {
            vvListeners.push(f);
        },
        dispatchEvent() {},
    };
    const timers = new Map();
    let timerId = 0;
    const window = {
        matchMedia: () => ({ matches: true }),
        addEventListener() {},
        removeEventListener() {},
        getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
        requestAnimationFrame: (f) => f(),
        cancelAnimationFrame() {},
        setTimeout(f) {
            timerId += 1;
            timers.set(timerId, f);
            return timerId;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        setInterval,
        clearInterval,
        dispatchEvent() {},
        visualViewport,
        document,
    };
    window.window = window;
    const ctx = vm.createContext(window);
    ctx.document = document;
    // The pager calls the bare global setTimeout, which inside a vm context is
    // the context's own -- not window's property. Without this the settle timer
    // is a real one and never runs inside the test.
    ctx.setTimeout = window.setTimeout;
    ctx.clearTimeout = window.clearTimeout;
    vm.runInContext(fs.readFileSync(PAGER, 'utf8'), ctx, { filename: 'vscodroid-pager.js' });

    window.__vscodroidPager.nativePinch('in');
    const fired = vvListeners.length;
    assert.ok(fired > 0, 'the pager installed no visualViewport listener at all');

    // One keyboard animation: several intermediate heights, then the settled
    // one. How many forced style writes that costs is the whole question --
    // a write here is a size written onto the chat webview.
    const baseline = sidebar.writes;
    for (const h of [700, 660, 620, 600, 580]) {
        vvHeight = h;
        for (const notify of vvListeners) notify({ type: 'resize' });
    }
    assert.strictEqual(
        sidebar.writes - baseline, 0,
        `${sidebar.writes - baseline} style write(s) landed during the ` +
        'animation itself; each one resizes the chat webview, which is the jump'
    );

    // And the settled size is still honoured, or the composer sits behind the
    // keyboard once it is up. Only the one surviving timer is a real one: the
    // four before it were cleared as the animation went on.
    assert.strictEqual(
        timers.size, 1,
        `${timers.size} settle timer(s) survived the burst; the pager must ` +
        'coalesce to the last one, or it lays out on every frame of the animation'
    );
    assert.strictEqual(
        vvHeight, 580,
        'the stub must end on the settled height for this to mean anything'
    );
}

const cases = {
    namesOnInnerTextOnly,
    namesOnAriaLabel,
    doesNotClickTheOpenAgent,
    prefersClineOverOtherAgents,
    ignoresNonAgentItems,
    resizeBurstCollapsesToOneLayout,
};

let failed = 0;
const names = Object.keys(cases);
for (const name of names) {
    try {
        cases[name]();
        console.log(`  ok     ${name}`);
    } catch (e) {
        failed++;
        console.log(`  FAIL   ${name}: ${e.message}`);
    }
}
console.log(
    `  ${failed ? 'FAILED' : 'ok'}     ${names.length - failed}/${names.length} agent-lookup cases`
);
process.exit(failed ? 1 : 0);

