// @ts-nocheck
'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');
const catalog = require('./catalog');
const keysUtil = require('./keys');
const desktopSettings = require('./desktop-settings');
const { writeMergedOpenCodeConfig } = require('./opencode-config');
const { runWarTask, PHASE } = require('./war');
const benchmark = require('./benchmark');
const { chatWithRetry } = require('./llm');

const TERMINAL_NAME = 'OpenCode';
const VIEW_ID = 'vscodroid.kai.panel';
const MODE_KEY = 'vscodroid.kai.chatMode';
const WAR_CONFIG_KEY = 'vscodroid.kai.warConfig';
const BENCHMARK_KEY = 'vscodroid.kai.benchmarks';
const HISTORY_KEY = 'vscodroid.kai.warHistory';
const SINGLE_MODEL_KEY = 'vscodroid.kai.singleModelKey';
const KAI_DESKTOP_IMPORT_KEY = 'vscodroid.kai.importedKaiDesktopKeys';
const HISTORY_CAP = 50;

const DEFAULT_WAR_CONFIG = {
    minScoreThreshold: catalog.DEFAULT_MIN_SCORE,
    maxWaitSeconds: 60,
    retryCount: 2,
    voteRounds: 2,
    notifyOnFailure: true,
    notifyOnComplete: true,
    summaryModelKey: null,
};

function homeDir() {
    return process.env.HOME || os.homedir();
}

function workspaceCwd() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length) return folders[0].uri.fsPath;
    return homeDir();
}

function zenModelSetting() {
    const raw = vscode.workspace.getConfiguration('vscodroid.kai').get('zenModel');
    return catalog.resolveZenModel(raw);
}

function autoStartEnabled() {
    const value = vscode.workspace.getConfiguration('vscodroid.kai').get('autoStartOpenCode');
    return value === true;
}

function findOpenCodeTerminal() {
    return vscode.window.terminals.find((t) => t.name === TERMINAL_NAME);
}

/**
 * Start the bundled OpenCode CLI the way a user does: type `opencode` in a
 * bash terminal so the FirstRunSetup wrapper (LD_PRELOAD libtmpfix.so) runs.
 * Never spawn the symlink or libopencode.so from this process.
 */
function startOpenCodeTerminal() {
    const existing = findOpenCodeTerminal();
    if (existing) {
        existing.show(true);
        return existing;
    }
    const term = vscode.window.createTerminal({
        name: TERMINAL_NAME,
        cwd: workspaceCwd(),
    });
    term.show(true);
    term.sendText('opencode');
    return term;
}

function prepareOpenCodeConfig() {
    writeMergedOpenCodeConfig(homeDir(), zenModelSetting());
}

function nonce() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let out = '';
    for (let i = 0; i < 32; i++) {
        out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return out;
}

function panelHtml(webview, extensionUri, token) {
    const media = vscode.Uri.joinPath(extensionUri, 'media');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'));
    const csp = [
        `default-src 'none'`,
        `style-src ${webview.cspSource}`,
        `script-src 'nonce-${token}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${css}">
<title>Kai</title>
</head>
<body>
<div id="app"></div>
<script nonce="${token}" src="${js}"></script>
</body>
</html>`;
}

class KaiViewProvider {
    constructor(context) {
        this.context = context;
        this.view = undefined;
        this.editorPanel = undefined;
        this.cancelled = false;
        this.running = false;
        this.speedTesting = false;
        this.speedCancelled = false;
        this.singleBusy = false;
        this.editorMaximized = false;
    }

    webviews() {
        const list = [];
        if (this.view) list.push(this.view.webview);
        if (this.editorPanel) list.push(this.editorPanel.webview);
        return list;
    }

    postToViews(message) {
        this.webviews().forEach((webview) => {
            try {
                webview.postMessage(message);
            } catch (_e) {
                // disposed
            }
        });
    }

    bindWebview(webview) {
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        };
        webview.html = panelHtml(webview, this.context.extensionUri, nonce());
        webview.onDidReceiveMessage((msg) => this.onMessage(msg));
    }

    resolveWebviewView(webviewView) {
        this.view = webviewView;
        this.bindWebview(webviewView.webview);
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) this.pushState();
        });
        this.pushState();
        this.maybeAutoStartSingle();
    }

    async openInEditor(opts) {
        const fullscreen = Boolean(opts && opts.fullscreen);
        if (this.editorPanel) {
            this.editorPanel.reveal(vscode.ViewColumn.Active, false);
        } else {
            this.editorPanel = vscode.window.createWebviewPanel(
                'vscodroid.kai.editor',
                'Kai',
                { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
                },
            );
            this.bindWebview(this.editorPanel.webview);
            this.editorPanel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kai.svg');
            this.editorPanel.onDidDispose(() => {
                this.editorPanel = undefined;
                this.editorMaximized = false;
                this.pushState();
            });
        }
        this.pushState();
        if (fullscreen) {
            await this.enterFullscreen();
        }
    }

    async enterFullscreen() {
        try {
            // Hide side bars and maximize the editor group for a near-fullscreen Kai.
            await vscode.commands.executeCommand('workbench.action.closeSidebar');
            await vscode.commands.executeCommand('workbench.action.closeAuxiliaryBar');
            await vscode.commands.executeCommand('workbench.action.closePanel');
            await vscode.commands.executeCommand('workbench.action.maximizeEditorHideSidebar');
            this.editorMaximized = true;
        } catch (_e) {
            try {
                await vscode.commands.executeCommand('workbench.action.toggleMaximizeEditorGroup');
                this.editorMaximized = true;
            } catch (__e) {
                vscode.window.showInformationMessage('Kai opened in the editor. Maximize the editor group if needed.');
            }
        }
        this.pushState();
    }

    async exitFullscreenToSidebar() {
        try {
            if (this.editorMaximized) {
                await vscode.commands.executeCommand('workbench.action.evenEditorWidths');
                this.editorMaximized = false;
            }
        } catch (_e) {
            // ignore
        }
        try {
            await vscode.commands.executeCommand('workbench.action.focusSideBar');
        } catch (_e) {
            // ignore
        }
        await focusKaiView();
        this.pushState();
    }

    currentMode() {
        return this.context.globalState.get(MODE_KEY) === 'war' ? 'war' : 'single';
    }

    warConfig() {
        const stored = this.context.globalState.get(WAR_CONFIG_KEY) || {};
        const next = Object.assign({}, DEFAULT_WAR_CONFIG, stored);
        // 1.2.0: previous default threshold 50 hid most models until speed-test.
        if (!stored._v12Threshold && Number(stored.minScoreThreshold) === 50) {
            next.minScoreThreshold = 0;
            next._v12Threshold = true;
            this.context.globalState.update(WAR_CONFIG_KEY, next);
        }
        return next;
    }

    benchmarks() {
        const list = this.context.globalState.get(BENCHMARK_KEY);
        return Array.isArray(list) ? list : [];
    }

    history() {
        const list = this.context.globalState.get(HISTORY_KEY);
        return Array.isArray(list) ? list : [];
    }

    apiKeys() {
        return keysUtil.sanitizeKeys(this.context.globalState.get(keysUtil.KEYS_STATE));
    }

    freeLlmApiBaseUrl() {
        const fromState = this.context.globalState.get(keysUtil.BASE_STATE);
        if (typeof fromState === 'string' && fromState.trim()) return fromState.trim();
        const fromSettings = vscode.workspace.getConfiguration('vscodroid.kai').get('freeLlmApiBaseUrl');
        return catalog.normalizeFreeLlmBase(fromSettings || catalog.DEFAULT_FREELLMAPI_BASE);
    }

    catalogOpts() {
        return {
            keys: this.apiKeys(),
            freeLlmApiBaseUrl: this.freeLlmApiBaseUrl(),
        };
    }

    singleModelKey() {
        const stored = this.context.globalState.get(SINGLE_MODEL_KEY);
        const models = catalog.singleSelectableModels(this.catalogOpts());
        if (stored && models.some((m) => m.key === stored)) return stored;
        const zen = models.find((m) => m.providerId === 'zen' && m.modelId === zenModelSetting());
        return (zen || models[0] || {}).key || `zen::${catalog.DEFAULT_ZEN_MODEL}`;
    }

    async saveWarConfig(partial) {
        const next = Object.assign({}, this.warConfig());
        Object.keys(partial || {}).forEach((key) => {
            if (partial[key] !== undefined && partial[key] !== null && !Number.isNaN(partial[key])) {
                next[key] = partial[key];
            }
        });
        if (partial && Object.prototype.hasOwnProperty.call(partial, 'summaryModelKey')) {
            next.summaryModelKey = partial.summaryModelKey || null;
        }
        await this.context.globalState.update(WAR_CONFIG_KEY, next);
        return next;
    }

    async saveBenchmarks(list) {
        await this.context.globalState.update(BENCHMARK_KEY, list);
    }

    async appendHistory(entry) {
        const next = [entry].concat(this.history()).slice(0, HISTORY_CAP);
        await this.context.globalState.update(HISTORY_KEY, next);
        return next;
    }

    async importKaiDesktopKeys(force) {
        const already = this.context.globalState.get(KAI_DESKTOP_IMPORT_KEY);
        // Always allow force; otherwise import once per install, then merge on demand.
        if (already && !force) {
            // Still refresh merge so newly added ~/.kai keys appear after reload.
        }
        try {
            const imported = desktopSettings.importKeysFromKaiDesktop();
            if (!imported.found) {
                if (force) {
                    vscode.window.showWarningMessage('Could not find ~/.kai/settings.aes.');
                }
                return imported;
            }
            if (!imported.count) {
                await this.context.globalState.update(KAI_DESKTOP_IMPORT_KEY, true);
                return imported;
            }
            await this.saveApiKeys(imported.keys);
            if (imported.freeLlmApiBaseUrl) await this.saveFreeLlmBase(imported.freeLlmApiBaseUrl);
            await this.context.globalState.update(KAI_DESKTOP_IMPORT_KEY, true);
            return imported;
        } catch (err) {
            vscode.window.showWarningMessage(
                `Kai 无法读取 ~/.kai 密钥: ${err && err.message ? err.message : err}`,
            );
            return null;
        }
    }

    async saveApiKeys(partial) {
        const next = keysUtil.mergeKeys(this.apiKeys(), partial);
        await this.context.globalState.update(keysUtil.KEYS_STATE, next);
        return next;
    }

    async saveFreeLlmBase(url) {
        const next = catalog.normalizeFreeLlmBase(url);
        await this.context.globalState.update(keysUtil.BASE_STATE, next);
        return next;
    }

    pushState(extra) {
        const warConfig = this.warConfig();
        const benchmarks = this.benchmarks();
        const opts = this.catalogOpts();
        const models = catalog.allModels(opts).map((model) => Object.assign({}, model, {
            score: catalog.scoreOf(benchmarks, model.key),
            eligible: catalog.passesScoreGate(
                model,
                catalog.scoreOf(benchmarks, model.key),
                warConfig.minScoreThreshold,
            ),
        }));
        this.postToViews(Object.assign({
            type: 'state',
            mode: this.currentMode(),
            zenModel: zenModelSetting(),
            zenModels: catalog.ZEN_FREE,
            singleModelKey: this.singleModelKey(),
            singleModels: catalog.singleSelectableModels(opts),
            models,
            warConfig,
            benchmarks,
            history: this.history(),
            locale: vscode.env.language || 'en',
            running: this.running,
            speedTesting: this.speedTesting,
            singleBusy: this.singleBusy,
            autoStart: autoStartEnabled(),
            openCodeOpen: Boolean(findOpenCodeTerminal()),
            apiKeysStatus: keysUtil.keysStatus(this.apiKeys()),
            freeLlmApiBaseUrl: this.freeLlmApiBaseUrl(),
            hasEditorPanel: Boolean(this.editorPanel),
            editorMaximized: this.editorMaximized,
            surface: this.editorPanel ? 'editor' : 'sidebar',
        }, extra || {}));
    }

    maybeAutoStartSingle() {
        if (this.currentMode() !== 'single') return;
        if (!autoStartEnabled()) return;
        if (findOpenCodeTerminal()) {
            findOpenCodeTerminal().show(true);
            return;
        }
        this.startSingle();
    }

    startSingle() {
        try {
            prepareOpenCodeConfig();
        } catch (err) {
            vscode.window.showErrorMessage(
                `Kai could not write OpenCode config: ${err && err.message ? err.message : err}`,
            );
            return;
        }
        startOpenCodeTerminal();
        this.pushState();
    }

    async sendSingleChat(payload) {
        if (this.singleBusy || this.running || this.speedTesting) {
            vscode.window.showInformationMessage('A Kai task is already running.');
            return;
        }
        const question = String(payload && payload.question || '').trim();
        if (!question) {
            vscode.window.showWarningMessage('Please enter a message to send.');
            return;
        }
        const modelKey = String(payload && payload.modelKey || this.singleModelKey());
        const model = catalog.allModels(this.catalogOpts()).find((m) => m.key === modelKey);
        if (!model) {
            vscode.window.showWarningMessage('Selected model not found.');
            return;
        }
        if (!model.ready) {
            vscode.window.showWarningMessage(`${model.label} 需要先配置 API Key。`);
            return;
        }
        await this.context.globalState.update(SINGLE_MODEL_KEY, model.key);
        this.singleBusy = true;
        this.pushState({ singleReply: '' });
        try {
            const reply = await chatWithRetry({
                chatUrl: model.chatUrl,
                apiKey: model.apiKey,
                model: model.modelId,
                headers: model.headers,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: question },
                ],
                timeoutMs: Math.max(15_000, (this.warConfig().maxWaitSeconds || 60) * 1000),
                retryCount: Math.max(0, this.warConfig().retryCount || 0),
            });
            if (this.view) {
                this.postToViews({
                    type: 'singleDone',
                    modelKey: model.key,
                    label: model.label,
                    question,
                    reply,
                });
            }
        } catch (err) {
            const text = err && err.message ? err.message : String(err);
            this.postToViews({ type: 'singleError', text });
            vscode.window.showErrorMessage(`Kai 发送失�? ${text}`);
        } finally {
            this.singleBusy = false;
            this.pushState();
        }
    }

    async startSpeedTest() {
        if (this.speedTesting || this.running || this.singleBusy) {
            vscode.window.showInformationMessage('A Kai task is already running.');
            return;
        }
        this.speedTesting = true;
        this.speedCancelled = false;
        this.pushState();
        try {
            const models = catalog.allModels(this.catalogOpts()).filter((m) => m.ready);
            const result = await benchmark.runSpeedTest(models, {
                isCancelled: () => this.speedCancelled,
                onEvent: (event) => {
                    this.postToViews({ type: 'speedEvent', event });
                },
            });
            let stored = this.benchmarks();
            result.benchmarks.forEach((item) => {
                stored = benchmark.upsert(stored, item);
            });
            await this.saveBenchmarks(stored);
            if (this.view) {
                this.postToViews({ type: 'speedDone', summary: result.summary });
            }
        } catch (err) {
            const text = err && err.message ? err.message : String(err);
            this.postToViews({ type: 'speedError', text });
        } finally {
            this.speedTesting = false;
            this.pushState();
        }
    }

    async startWar(payload) {
        if (this.running || this.speedTesting || this.singleBusy) {
            vscode.window.showInformationMessage('A Kai task is already running.');
            return;
        }
        const warConfig = await this.saveWarConfig({
            minScoreThreshold: payload && payload.minScoreThreshold,
            maxWaitSeconds: payload && payload.maxWaitSeconds,
            retryCount: payload && payload.retryCount,
            voteRounds: payload && payload.voteRounds,
            notifyOnFailure: payload && payload.notifyOnFailure,
            notifyOnComplete: payload && payload.notifyOnComplete,
            summaryModelKey: payload && payload.summaryModelKey ? payload.summaryModelKey : null,
        });
        const opts = this.catalogOpts();
        const eligible = catalog.eligibleModels(this.benchmarks(), warConfig.minScoreThreshold, opts);
        const selectedKeys = Array.isArray(payload && payload.modelKeys) ? payload.modelKeys : null;
        const selected = selectedKeys
            ? eligible.filter((m) => selectedKeys.includes(m.key))
            : eligible;
        const models = catalog.rankSummaryCandidates(
            selected,
            this.benchmarks(),
            warConfig.summaryModelKey,
        );
        if (!models.length) {
            const text = `没有可用模型。请配置 API Key、先测速，或把分数门槛调到 0。`;
            vscode.window.showWarningMessage(text);
            this.postToViews({ type: 'warError', text });
            return;
        }

        this.cancelled = false;
        this.running = true;
        this.pushState();
        const startedAt = Date.now();
        const params = {
            question: payload && payload.question,
            maxWaitSeconds: warConfig.maxWaitSeconds,
            retryCount: warConfig.retryCount,
            voteRounds: warConfig.voteRounds,
            notifyOnComplete: warConfig.notifyOnComplete !== false,
            notifyOnFailure: warConfig.notifyOnFailure !== false,
            summaryModelKey: warConfig.summaryModelKey,
            models,
        };
        try {
            const result = await runWarTask(params, {
                isCancelled: () => this.cancelled,
                onEvent: (event) => {
                    this.postToViews({ type: 'warEvent', event });
                },
                onNotify: (title, body) => {
                    vscode.window.showInformationMessage(`${title}: ${body}`);
                },
            });
            let stored = this.benchmarks();
            (result.transcripts || []).forEach((snap) => {
                stored = benchmark.upsert(stored, benchmark.compute({
                    modelKey: snap.key,
                    modelLabel: snap.label,
                    serviceId: String(snap.key || '').split('::')[0],
                    response: snap.response,
                    elapsedMs: snap.elapsedMs,
                    attempts: snap.attempts,
                    failed: snap.failed,
                }));
            });
            await this.saveBenchmarks(stored);
            await this.appendHistory({
                id: `war-${startedAt}`,
                startedAt,
                finishedAt: Date.now(),
                question: result.question || params.question,
                phase: result.phase,
                analysisError: result.analysisError || '',
                commonPoints: result.commonPoints || [],
                voteRoundResults: result.voteRoundResults || [],
                finalSummary: result.finalSummary || '',
                transcripts: result.transcripts || [],
                modelLabels: models.map((m) => m.label),
            });
            if (this.view) {
                this.postToViews({ type: 'warDone', result });
            }
            if (result.phase === PHASE.FAILED && params.notifyOnFailure && result.analysisError) {
                vscode.window.showWarningMessage(result.analysisError);
            }
        } catch (err) {
            const text = err && err.message ? err.message : String(err);
            this.postToViews({ type: 'warError', text });
            vscode.window.showErrorMessage(`Kai war mode failed: ${text}`);
        } finally {
            this.running = false;
            this.pushState();
        }
    }

    async importKeysFromFile() {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { JSON: ['json'], All: ['*'] },
            openLabel: '导入 API Key',
        });
        if (!picked || !picked.length) return;
        let text;
        try {
            text = fs.readFileSync(picked[0].fsPath, 'utf8');
        } catch (err) {
            vscode.window.showErrorMessage(`读取失败: ${err && err.message ? err.message : err}`);
            return;
        }
        try {
            const parsed = keysUtil.parseKeysPayload(text);
            await this.saveApiKeys(parsed.keys);
            if (parsed.freeLlmApiBaseUrl) await this.saveFreeLlmBase(parsed.freeLlmApiBaseUrl);
            const setCount = Object.values(parsed.keys).filter(Boolean).length;
            vscode.window.showInformationMessage(`已导入 ${setCount} 个服务的 API Key。`);
            this.pushState();
        } catch (err) {
            vscode.window.showErrorMessage(err && err.message ? err.message : String(err));
        }
    }

    async onMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        if (msg.type === 'ready') {
            this.pushState();
            return;
        }
        if (msg.type === 'setMode') {
            const mode = msg.mode === 'war' ? 'war' : 'single';
            await this.context.globalState.update(MODE_KEY, mode);
            this.pushState();
            if (mode === 'single') this.maybeAutoStartSingle();
            return;
        }
        if (msg.type === 'setZenModel') {
            await vscode.workspace.getConfiguration('vscodroid.kai').update(
                'zenModel',
                catalog.resolveZenModel(msg.id),
                vscode.ConfigurationTarget.Global,
            );
            this.pushState();
            return;
        }
        if (msg.type === 'setSingleModel') {
            await this.context.globalState.update(SINGLE_MODEL_KEY, String(msg.key || ''));
            this.pushState();
            return;
        }
        if (msg.type === 'setWarConfig') {
            await this.saveWarConfig(msg.config);
            this.pushState();
            return;
        }
        if (msg.type === 'saveApiKeys') {
            await this.saveApiKeys(msg.keys || {});
            if (msg.freeLlmApiBaseUrl) await this.saveFreeLlmBase(msg.freeLlmApiBaseUrl);
            this.pushState();
            vscode.window.showInformationMessage('API Key saved.');
            return;
        }
        if (msg.type === 'importApiKeys') {
            await this.importKeysFromFile();
            return;
        }
        if (msg.type === 'importKaiDesktopKeys') {
            const imported = await this.importKaiDesktopKeys(true);
            if (imported && imported.count) {
                vscode.window.showInformationMessage(
                    `已从 ~/.kai 导入 ${imported.count} 个服务密钥：${imported.providers.join(', ')}`,
                );
            } else if (imported && imported.found) {
                vscode.window.showInformationMessage('No usable API keys found in ~/.kai.');
            } else {
                vscode.window.showWarningMessage('Could not find ~/.kai/settings.aes.');
            }
            this.pushState();
            return;
        }
        if (msg.type === 'openInEditor') {
            await this.openInEditor({ fullscreen: false });
            return;
        }
        if (msg.type === 'openFullscreen') {
            await this.openInEditor({ fullscreen: true });
            return;
        }
        if (msg.type === 'openInSidebar') {
            await this.exitFullscreenToSidebar();
            return;
        }
        if (msg.type === 'startSingle') {
            this.startSingle();
            return;
        }
        if (msg.type === 'sendSingle') {
            await this.sendSingleChat(msg);
            return;
        }
        if (msg.type === 'startSpeedTest') {
            await this.startSpeedTest();
            return;
        }
        if (msg.type === 'cancelSpeedTest') {
            this.speedCancelled = true;
            return;
        }
        if (msg.type === 'clearBenchmarks') {
            await this.saveBenchmarks([]);
            this.pushState();
            return;
        }
        if (msg.type === 'clearHistory') {
            await this.context.globalState.update(HISTORY_KEY, []);
            this.pushState();
            return;
        }
        if (msg.type === 'startWar') {
            await this.startWar(msg);
            return;
        }
        if (msg.type === 'cancelWar') {
            this.cancelled = true;
        }
    }
}

async function focusKaiView() {
    await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
}

function activate(context) {
    const provider = new KaiViewProvider(context);
    // Always merge keys from Kai desktop store on startup.
    provider.importKaiDesktopKeys(true).then((imported) => {
        if (imported && imported.count) {
            vscode.window.showInformationMessage(
                `Kai imported ${imported.count} API keys from ~/.kai.`,
            );
            provider.pushState();
        }
    });
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
            webviewOptions: { retainContextWhenHidden: true },
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.open', async () => {
            await focusKaiView();
            provider.maybeAutoStartSingle();
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.startSingle', async () => {
            await context.globalState.update(MODE_KEY, 'single');
            await focusKaiView();
            provider.startSingle();
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.startWar', async () => {
            await context.globalState.update(MODE_KEY, 'war');
            await focusKaiView();
            provider.pushState();
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.openInEditor', async () => {
            await provider.openInEditor({ fullscreen: false });
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.openFullscreen', async () => {
            await provider.openInEditor({ fullscreen: true });
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.openInSidebar', async () => {
            await provider.exitFullscreenToSidebar();
        }),
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('vscodroid.kai.importApiKeys', async () => {
            await provider.importKeysFromFile();
        }),
    );
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal((term) => {
            if (term.name === TERMINAL_NAME) provider.pushState();
        }),
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate,
    TERMINAL_NAME,
    startOpenCodeTerminal,
    findOpenCodeTerminal,
    prepareOpenCodeConfig,
};
