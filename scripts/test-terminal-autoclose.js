/**
 * Self-check for the terminal-autoclose extension.
 *
 * Cline opens one terminal per command run and never closes them, which is
 * the fastest route to Android's 32 phantom-process limit. This extension
 * schedules a dispose after onDidEndTerminalShellExecution and cancels it on
 * new output. Off by default; enabling it must never touch a live terminal.
 *
 *   node scripts/test-terminal-autoclose.js
 */

const assert = require('assert');
const path = require('path');
const Module = require('module');

const EXTENSION = path.join(
    __dirname, '..', 'android', 'app', 'src', 'main', 'assets',
    'extensions', 'vscodroid.vscodroid-terminal-autoclose-1.0.0', 'extension.js',
);

let config = { enabled: false, delaySeconds: 30 };
const disposed = [];
const timers = new Map();
let shellEndHandler = null;
let dataHandler = null;
let closeHandler = null;

const fakeTerminals = [];
function makeTerminal(name) {
    const t = { name, exitStatus: undefined, dispose() { disposed.push(name); } };
    fakeTerminals.push(t);
    return t;
}

const vscodeStub = {
    workspace: {
        getConfiguration: () => ({ get: (k) => config[k] }),
        onDidChangeConfiguration: () => ({ dispose() {} }),
    },
    window: {
        terminals: fakeTerminals,
        onDidEndTerminalShellExecution: (fn) => { shellEndHandler = fn; return { dispose() {} }; },
        onDidWriteTerminalData: (fn) => { dataHandler = fn; return { dispose() {} }; },
        onDidCloseTerminal: (fn) => { closeHandler = fn; return { dispose() {} }; },
    },
};

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
    return request === 'vscode' ? 'vscode' : resolveFilename.call(this, request, ...rest);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscodeStub };

// Fake timers: capture the delay, run manually.
const realSetTimeout = global.setTimeout;
const realClearTimeout = global.clearTimeout;
global.setTimeout = (fn, ms) => {
    const id = Symbol('timer');
    timers.set(id, { fn, ms });
    return id;
};
global.clearTimeout = (id) => { timers.delete(id); };
function runTimers() {
    for (const [id, t] of Array.from(timers)) {
        timers.delete(id);
        t.fn();
    }
}

delete require.cache[require.resolve(EXTENSION)];
const extension = require(EXTENSION);
extension.activate({ subscriptions: [] });
assert.ok(shellEndHandler && dataHandler && closeHandler, 'extension did not subscribe to terminal events');

// 1. Disabled by default: execution end schedules nothing.
{
    const term = makeTerminal('cline-1');
    shellEndHandler({ terminal: term });
    assert.strictEqual(timers.size, 0, 'disabled extension scheduled a close');
}

// 2. Enabled: execution end schedules a close at the configured delay.
{
    config = { enabled: true, delaySeconds: 30 };
    const term = makeTerminal('cline-2');
    shellEndHandler({ terminal: term });
    assert.strictEqual(timers.size, 1, 'enabled extension scheduled nothing');
    const [{ ms }] = Array.from(timers.values());
    assert.strictEqual(ms, 30_000, `expected 30000ms delay, got ${ms}`);
    runTimers();
    assert.deepStrictEqual(disposed, ['cline-2'], 'terminal was not disposed after delay');
}

// 3. New output cancels the pending close.
{
    disposed.length = 0;
    const term = makeTerminal('cline-3');
    shellEndHandler({ terminal: term });
    assert.strictEqual(timers.size, 1, 'expected a pending close');
    dataHandler({ terminal: term });
    assert.strictEqual(timers.size, 0, 'new output did not cancel the close');
    runTimers();
    assert.deepStrictEqual(disposed, [], 'cancelled close still disposed');
}

// 4. Closed terminal clears its timer.
{
    const term = makeTerminal('cline-4');
    shellEndHandler({ terminal: term });
    assert.strictEqual(timers.size, 1, 'expected a pending close');
    closeHandler(term);
    assert.strictEqual(timers.size, 0, 'close did not clear the timer');
}

global.setTimeout = realSetTimeout;
global.clearTimeout = realClearTimeout;
extension.deactivate();

console.log('ok -- terminal-autoclose stays off by default, closes after the delay, and backs off on new output');
