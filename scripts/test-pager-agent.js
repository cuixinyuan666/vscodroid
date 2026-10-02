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
        style: {
            setProperty() {},
            removeProperty() {},
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

const cases = {
    namesOnInnerTextOnly,
    namesOnAriaLabel,
    doesNotClickTheOpenAgent,
    prefersClineOverOtherAgents,
    ignoresNonAgentItems,
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

