// @ts-nocheck
'use strict';

/**
 * VSCodroid Terminal Auto Close.
 *
 * Cline (saoudrizwan.claude-dev) creates one terminal per command run and
 * never disposes them, so a long session accumulates dozens of idle shells
 * that each cost a phantom-process slot (Android limit: 32 per app). This
 * extension watches shell-execution ends and disposes the terminal after the
 * configured delay. Off by default; enabling it never touches a terminal
 * that still has a running process.
 */

const vscode = require('vscode');

function cfg() {
    const c = vscode.workspace.getConfiguration('vscodroid.terminalAutoClose');
    return {
        enabled: c.get('enabled') === true,
        delaySeconds: Math.max(0, Math.min(600, Number(c.get('delaySeconds')) || 0)),
    };
}

function activate(context) {
    const pending = new Map(); // terminal -> Timeout

    function clearTimer(term) {
        const t = pending.get(term);
        if (t) {
            clearTimeout(t);
            pending.delete(term);
        }
    }

    function scheduleClose(term) {
        const { enabled, delaySeconds } = cfg();
        if (!enabled) return;
        clearTimer(term);
        pending.set(term, setTimeout(() => {
            pending.delete(term);
            try {
                const stillThere = (vscode.window.terminals || []).indexOf(term) >= 0;
                if (!stillThere) return;
                // Do not kill a terminal that started something new while waiting.
                if (term.exitStatus !== undefined && term.exitStatus !== null) return;
                term.dispose();
            } catch { /* terminal already gone */ }
        }, delaySeconds * 1000));
    }

    // Fires when a shell command finishes (exit code known), even though the
    // terminal stays open. This is the signal Cline never acts on.
    if (vscode.window.onDidEndTerminalShellExecution) {
        context.subscriptions.push(
            vscode.window.onDidEndTerminalShellExecution((e) => {
                try {
                    if (e && e.terminal) scheduleClose(e.terminal);
                } catch { /* ignore */ }
            }),
        );
    }
    // Any new output cancels a pending close: the terminal is alive again.
    context.subscriptions.push(
        vscode.window.onDidWriteTerminalData((e) => {
            try {
                if (e && e.terminal) clearTimer(e.terminal);
            } catch { /* ignore */ }
        }),
    );
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((term) => clearTimer(term)),
    );
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((e) => {
            try {
                if (e.affectsConfiguration('vscodroid.terminalAutoClose') && !cfg().enabled) {
                    for (const t of Array.from(pending.keys())) clearTimer(t);
                }
            } catch { /* ignore */ }
        }),
    );
}

function deactivate() {}

module.exports = { activate, deactivate };
