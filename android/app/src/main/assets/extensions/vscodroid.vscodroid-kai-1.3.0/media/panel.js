'use strict';

const vscode = acquireVsCodeApi();

const STR = {
    en: {
        single: 'Single',
        war: 'War',
        model: 'Model',
        open: 'Open OpenCode',
        send: 'Send',
        openEditor: 'Open in editor',
        openFullscreen: 'Fullscreen',
        openSidebar: 'Back to sidebar',
        hint: 'Single mode: pick any ready model and send a message here. OpenCode terminal is optional.',
        warHint: 'Round 1 answers in parallel. Includes FreeLLMAPI, OpenCode Zen, NVIDIA (with key), Agnes, NavyAI, LLM7, Kilo, OVH. Speed-test first, or keep score threshold at 0.',
        question: 'Question',
        message: 'Message',
        threshold: 'Score threshold (≥)',
        wait: 'Max wait (seconds)',
        retry: 'Retries',
        votes: 'Vote rounds',
        notifyFail: 'Notify on model failure',
        notifyDone: 'Notify when the task ends',
        summary: 'Summary model',
        summaryAuto: 'Auto (highest score first)',
        eligible: 'Models that will take part',
        speed: 'Speed-test all ready models',
        cancelSpeed: 'Cancel speed test',
        clearScores: 'Clear scores',
        startWar: 'Start war mode',
        cancel: 'Cancel',
        log: 'Progress',
        result: 'Result',
        history: 'War chat history',
        clearHistory: 'Clear history',
        emptyHistory: 'No war-mode history yet.',
        expandSpeed: 'Expand speed log',
        collapseSpeed: 'Collapse speed log',
        keys: 'API keys',
        keysHint: 'NVIDIA / FreeLLMAPI / OpenCode keys. Import Kai settings JSON or paste keys below.',
        nvidiaKey: 'NVIDIA API key',
        freellmKey: 'FreeLLMAPI unified key',
        freellmBase: 'FreeLLMAPI base URL',
        opencodeKey: 'OpenCode API key (optional; default public)',
        saveKeys: 'Save keys',
        importKeys: 'Import keys JSON',
        importKaiDesktop: 'Import from ~/.kai',
        reply: 'Reply',
        needsKey: 'needs key',
    },
    'zh-cn': {
        single: '单一模式',
        war: '战争模式',
        model: '模型',
        open: '打开 OpenCode',
        send: '发送',
        openEditor: '在编辑器打开',
        openFullscreen: '全屏',
        openSidebar: '回到侧栏',
        hint: '单一模式可直接选模型发消息。OpenCode 终端为可选项。',
        warHint: '第 1 轮各模型并行作答。目录含 FreeLLMAPI、OpenCode Zen、NVIDIA（需 Key）、Agnes、NavyAI、LLM7、Kilo、OVH 等。默认门槛 0；也可先测速。',
        question: '问题',
        message: '消息',
        threshold: '分数门槛（≥）',
        wait: '最长等待（秒）',
        retry: '重试次数',
        votes: '投票轮数',
        notifyFail: '模型失败显式提醒',
        notifyDone: '任务结束提醒',
        summary: '总结模型',
        summaryAuto: '自动（按分数从高到低）',
        eligible: '将参加的模型',
        speed: '测速全部就绪模型',
        cancelSpeed: '取消测速',
        clearScores: '清除分数',
        startWar: '开始战争模式',
        cancel: '取消',
        log: '进度',
        result: '结果',
        history: '战争模式聊天记录',
        clearHistory: '清除记录',
        emptyHistory: '还没有战争模式记录。',
        expandSpeed: '展开测速结果',
        collapseSpeed: '收起测速结果',
        keys: 'API 密钥',
        keysHint: '配置 NVIDIA / FreeLLMAPI / OpenCode。可导入 Kai 导出的 JSON，或在下方粘贴。',
        nvidiaKey: 'NVIDIA API Key',
        freellmKey: 'FreeLLMAPI 统一 Key',
        freellmBase: 'FreeLLMAPI Base URL',
        opencodeKey: 'OpenCode API Key（可选，默认 public）',
        saveKeys: '保存密钥',
        importKeys: '导入密钥 JSON',
        importKaiDesktop: '从 ~/.kai 导入',
        reply: '回复',
        needsKey: '需密钥',
    },
    'zh-tw': {
        single: '單一模式',
        war: '戰爭模式',
        model: '模型',
        open: '開啟 OpenCode',
        send: '傳送',
        openEditor: '在編輯器開啟',
        openFullscreen: '全螢幕',
        openSidebar: '回到側欄',
        hint: '單一模式可直接選模型發送訊息。OpenCode 終端機為選用。',
        warHint: '第 1 輪各模型並行作答。目錄含 FreeLLMAPI、OpenCode Zen、NVIDIA（需 Key）等。預設門檻 0；也可先測速。',
        question: '問題',
        message: '訊息',
        threshold: '分數門檻（≥）',
        wait: '最長等待（秒）',
        retry: '重試次數',
        votes: '投票輪數',
        notifyFail: '模型失敗明確提醒',
        notifyDone: '任務結束提醒',
        summary: '總結模型',
        summaryAuto: '自動（依分數由高到低）',
        eligible: '將參加的模型',
        speed: '測速全部就緒模型',
        cancelSpeed: '取消測速',
        clearScores: '清除分數',
        startWar: '開始戰爭模式',
        cancel: '取消',
        log: '進度',
        result: '結果',
        history: '戰爭模式聊天紀錄',
        clearHistory: '清除紀錄',
        emptyHistory: '還沒有戰爭模式紀錄。',
        expandSpeed: '展開測速結果',
        collapseSpeed: '收起測速結果',
        keys: 'API 金鑰',
        keysHint: '設定 NVIDIA / FreeLLMAPI / OpenCode。可匯入 Kai 匯出的 JSON。',
        nvidiaKey: 'NVIDIA API Key',
        freellmKey: 'FreeLLMAPI 統一 Key',
        freellmBase: 'FreeLLMAPI Base URL',
        opencodeKey: 'OpenCode API Key（可選，預設 public）',
        saveKeys: '儲存金鑰',
        importKeys: '匯入金鑰 JSON',
        importKaiDesktop: '從 ~/.kai 匯入',
        reply: '回覆',
        needsKey: '需金鑰',
    },
};

function t(locale) {
    if (STR[locale]) return STR[locale];
    const base = String(locale || '').split('-')[0];
    if (base === 'zh' && STR['zh-cn']) return STR['zh-cn'];
    return STR.en;
}

function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
        if (k === 'className') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === false || v == null) return;
        else node.setAttribute(k, v === true ? '' : String(v));
    });
    (children || []).forEach((c) => node.appendChild(c));
    return node;
}

let state = {
    mode: 'single',
    zenModel: 'big-pickle',
    zenModels: [],
    singleModelKey: '',
    singleModels: [],
    models: [],
    warConfig: {
        minScoreThreshold: 0,
        maxWaitSeconds: 60,
        retryCount: 2,
        voteRounds: 2,
        notifyOnFailure: true,
        notifyOnComplete: true,
        summaryModelKey: null,
    },
    history: [],
    locale: 'en',
    running: false,
    speedTesting: false,
    singleBusy: false,
    openCodeOpen: false,
    resultText: '',
    speedText: '',
    singleReply: '',
    apiKeysStatus: {},
    freeLlmApiBaseUrl: 'http://127.0.0.1:3001/v1',
};
const logLines = [];
let openHistoryId = '';
let speedExpanded = false;
let keysExpanded = false;
let form = {
    question: '',
    singleMessage: '',
    minScoreThreshold: '0',
    maxWaitSeconds: '60',
    retryCount: '2',
    voteRounds: '2',
    notifyOnFailure: true,
    notifyOnComplete: true,
    summaryModelKey: '',
    nvidiaKey: '',
    freellmKey: '',
    freellmBase: 'http://127.0.0.1:3001/v1',
    opencodeKey: '',
};

function formatResult(result) {
    if (!result) return '';
    const lines = [];
    if (result.analysisError) lines.push(result.analysisError);
    if (result.transcripts && result.transcripts.length) {
        lines.push('Round 1:');
        result.transcripts.forEach((snap) => {
            lines.push(`--- ${snap.label} ---`);
            lines.push(snap.failed || !snap.response ? '（调用失败，无回复）' : snap.response);
        });
        lines.push('');
    }
    if (result.commonPoints && result.commonPoints.length) {
        lines.push('Common points:');
        result.commonPoints.forEach((p) => lines.push(`- ${p}`));
    }
    (result.voteRoundResults || []).forEach((round) => {
        lines.push(`Vote round ${round.round}:`);
        (round.aspectResults || []).forEach((ar) => {
            const agree = (ar.votes || []).filter((v) => v.choice === 'AGREE').length;
            const valid = (ar.votes || []).filter((v) => v.choice !== 'ABSTAIN').length;
            lines.push(`- ${ar.aspect.title}: ${agree}/${valid}`);
            (ar.votes || []).forEach((vote) => {
                const stance = vote.choice === 'AGREE' ? '同意'
                    : vote.choice === 'DISAGREE' ? '不同意' : '未表态';
                const reason = vote.reason ? ` (${vote.reason})` : '';
                lines.push(`  ${vote.modelLabel}: ${stance}${reason}`);
            });
        });
    });
    if (result.finalSummary) {
        lines.push('', result.finalSummary);
    }
    return lines.join('\n');
}

function formatHistory(entry) {
    return formatResult({
        analysisError: entry.analysisError,
        transcripts: entry.transcripts,
        commonPoints: entry.commonPoints,
        voteRoundResults: entry.voteRoundResults,
        finalSummary: entry.finalSummary,
    });
}

function syncFormFromState() {
    const cfg = state.warConfig || {};
    form.minScoreThreshold = String(cfg.minScoreThreshold == null ? 0 : cfg.minScoreThreshold);
    form.maxWaitSeconds = String(cfg.maxWaitSeconds == null ? 60 : cfg.maxWaitSeconds);
    form.retryCount = String(cfg.retryCount == null ? 2 : cfg.retryCount);
    form.voteRounds = String(cfg.voteRounds == null ? 2 : cfg.voteRounds);
    form.notifyOnFailure = cfg.notifyOnFailure !== false;
    form.notifyOnComplete = cfg.notifyOnComplete !== false;
    form.summaryModelKey = cfg.summaryModelKey || '';
    form.freellmBase = state.freeLlmApiBaseUrl || form.freellmBase;
}

function readForm() {
    return {
        question: form.question,
        minScoreThreshold: Number(form.minScoreThreshold),
        maxWaitSeconds: Number(form.maxWaitSeconds),
        retryCount: Number(form.retryCount),
        voteRounds: Number(form.voteRounds),
        notifyOnFailure: form.notifyOnFailure,
        notifyOnComplete: form.notifyOnComplete,
        summaryModelKey: form.summaryModelKey || null,
    };
}

function renderKeys(s) {
    const wrap = el('div', { className: 'keys-box' });
    wrap.appendChild(el('button', {
        type: 'button',
        className: 'ghost',
        onClick: () => { keysExpanded = !keysExpanded; render(); },
        text: `${keysExpanded ? '▾' : '▸'} ${s.keys}`,
    }));
    if (!keysExpanded) return wrap;
    wrap.appendChild(el('p', { className: 'hint', text: s.keysHint }));
    const status = state.apiKeysStatus || {};
    const nvidia = el('input', {
        type: 'password',
        placeholder: status.nvidia && status.nvidia.masked ? status.nvidia.masked : s.nvidiaKey,
        onInput: (e) => { form.nvidiaKey = e.target.value; },
    });
    nvidia.value = form.nvidiaKey;
    const freellm = el('input', {
        type: 'password',
        placeholder: status.freellmapi && status.freellmapi.masked ? status.freellmapi.masked : s.freellmKey,
        onInput: (e) => { form.freellmKey = e.target.value; },
    });
    freellm.value = form.freellmKey;
    const base = el('input', {
        type: 'text',
        value: form.freellmBase,
        onInput: (e) => { form.freellmBase = e.target.value; },
    });
    const opencode = el('input', {
        type: 'password',
        placeholder: status.opencode && status.opencode.masked ? status.opencode.masked : s.opencodeKey,
        onInput: (e) => { form.opencodeKey = e.target.value; },
    });
    opencode.value = form.opencodeKey;
    wrap.appendChild(el('label', {}, [el('span', { text: s.nvidiaKey }), nvidia]));
    wrap.appendChild(el('label', {}, [el('span', { text: s.freellmKey }), freellm]));
    wrap.appendChild(el('label', {}, [el('span', { text: s.freellmBase }), base]));
    wrap.appendChild(el('label', {}, [el('span', { text: s.opencodeKey }), opencode]));
    wrap.appendChild(el('div', { className: 'row' }, [
        el('button', {
            type: 'button',
            className: 'primary',
            onClick: () => {
                vscode.postMessage({
                    type: 'saveApiKeys',
                    freeLlmApiBaseUrl: form.freellmBase,
                    keys: {
                        nvidia: form.nvidiaKey,
                        freellmapi: form.freellmKey,
                        opencode: form.opencodeKey,
                    },
                });
                form.nvidiaKey = '';
                form.freellmKey = '';
                form.opencodeKey = '';
            },
            text: s.saveKeys,
        }),
        el('button', {
            type: 'button',
            className: 'ghost',
            onClick: () => vscode.postMessage({ type: 'importApiKeys' }),
            text: s.importKeys,
        }),
    ]));
    wrap.appendChild(el('button', {
        type: 'button',
        className: 'ghost',
        onClick: () => vscode.postMessage({ type: 'importKaiDesktopKeys' }),
        text: s.importKaiDesktop,
    }));
    return wrap;
}

function render() {
    const s = t(state.locale);
    const app = document.getElementById('app');
    app.replaceChildren();

    const singleBtn = el('button', {
        type: 'button',
        'aria-pressed': state.mode === 'single',
        onClick: () => vscode.postMessage({ type: 'setMode', mode: 'single' }),
        text: s.single,
    });
    const warBtn = el('button', {
        type: 'button',
        'aria-pressed': state.mode === 'war',
        onClick: () => vscode.postMessage({ type: 'setMode', mode: 'war' }),
        text: s.war,
    });
    app.appendChild(el('div', { className: 'modes' }, [singleBtn, warBtn]));
    app.appendChild(el('div', { className: 'row layout-actions' }, [
        el('button', {
            type: 'button',
            className: 'ghost',
            onClick: () => vscode.postMessage({ type: 'openInEditor' }),
            text: s.openEditor,
        }),
        el('button', {
            type: 'button',
            className: 'ghost',
            onClick: () => vscode.postMessage({ type: 'openFullscreen' }),
            text: s.openFullscreen,
        }),
        el('button', {
            type: 'button',
            className: 'ghost',
            onClick: () => vscode.postMessage({ type: 'openInSidebar' }),
            text: s.openSidebar,
        }),
    ]));
    app.appendChild(el('p', { className: 'hint', text: state.mode === 'war' ? s.warHint : s.hint }));
    app.appendChild(renderKeys(s));

    if (state.mode === 'single') {
        const select = el('select', {
            id: 'single-model',
            onChange: (e) => vscode.postMessage({ type: 'setSingleModel', key: e.target.value }),
        });
        const list = (state.singleModels && state.singleModels.length)
            ? state.singleModels
            : (state.models || []).filter((m) => m.ready);
        list.forEach((m) => {
            const opt = el('option', { value: m.key, text: m.label });
            if (m.key === state.singleModelKey) opt.selected = true;
            select.appendChild(opt);
        });
        (state.models || []).filter((m) => !m.ready).forEach((m) => {
            select.appendChild(el('option', {
                value: m.key,
                disabled: true,
                text: `${m.label} (${s.needsKey})`,
            }));
        });
        app.appendChild(el('label', {}, [el('span', { text: s.model }), select]));

        const message = el('textarea', {
            id: 'single-message',
            onInput: (e) => { form.singleMessage = e.target.value; },
        });
        message.value = form.singleMessage;
        app.appendChild(el('label', {}, [el('span', { text: s.message }), message]));

        app.appendChild(el('div', { className: 'row' }, [
            el('button', {
                type: 'button',
                className: 'primary',
                disabled: state.singleBusy || state.running || state.speedTesting,
                onClick: () => {
                    vscode.postMessage({
                        type: 'sendSingle',
                        modelKey: state.singleModelKey,
                        question: form.singleMessage,
                    });
                },
                text: s.send,
            }),
            el('button', {
                type: 'button',
                className: 'ghost',
                onClick: () => vscode.postMessage({ type: 'startSingle' }),
                text: s.open,
            }),
        ]));
        if (state.singleReply) {
            app.appendChild(el('div', { className: 'result', text: `${s.reply}\n\n${state.singleReply}` }));
        }
        return;
    }

    app.appendChild(el('button', {
        type: 'button',
        className: 'primary',
        disabled: state.speedTesting || state.running || state.singleBusy,
        onClick: () => vscode.postMessage({ type: 'startSpeedTest' }),
        text: s.speed,
    }));
    if (state.speedTesting) {
        app.appendChild(el('button', {
            type: 'button',
            className: 'ghost',
            onClick: () => vscode.postMessage({ type: 'cancelSpeedTest' }),
            text: s.cancelSpeed,
        }));
    }
    if (state.speedText) {
        app.appendChild(el('button', {
            type: 'button',
            className: 'ghost toggle-expand',
            onClick: () => { speedExpanded = !speedExpanded; render(); },
            text: speedExpanded ? s.collapseSpeed : s.expandSpeed,
        }));
        app.appendChild(el('div', {
            className: speedExpanded ? 'log log-expanded' : 'log log-collapsed',
            text: state.speedText,
        }));
    }

    const question = el('textarea', {
        id: 'question',
        onInput: (e) => { form.question = e.target.value; },
    });
    question.value = form.question;
    app.appendChild(el('label', {}, [el('span', { text: s.question }), question]));

    const threshold = el('input', {
        type: 'number',
        id: 'threshold',
        value: form.minScoreThreshold,
        min: '0',
        max: '100',
        onChange: (e) => {
            form.minScoreThreshold = e.target.value;
            vscode.postMessage({ type: 'setWarConfig', config: { minScoreThreshold: Number(e.target.value) } });
        },
    });
    app.appendChild(el('label', {}, [el('span', { text: s.threshold }), threshold]));

    const eligible = (state.models || []).filter((m) => m.eligible);
    const listBox = el('div', { className: 'model-list' });
    (state.models || []).forEach((m) => {
        const score = m.score == null ? '?' : Math.round(m.score);
        const mark = m.eligible ? '●' : (m.ready ? '○' : '◌');
        listBox.appendChild(el('div', { className: 'model-row' }, [
            el('span', { text: `${mark} ${m.label}${m.ready ? '' : ` (${s.needsKey})`}` }),
            el('span', { className: 'score', text: `${score}` }),
        ]));
    });
    app.appendChild(el('label', {}, [
        el('span', { text: `${s.eligible} (${eligible.length}/${(state.models || []).length})` }),
        listBox,
    ]));

    app.appendChild(el('button', {
        type: 'button',
        className: 'ghost',
        disabled: state.speedTesting || state.running,
        onClick: () => vscode.postMessage({ type: 'clearBenchmarks' }),
        text: s.clearScores,
    }));

    const wait = el('input', {
        type: 'number', id: 'wait', value: form.maxWaitSeconds, min: '1',
        onChange: (e) => { form.maxWaitSeconds = e.target.value; },
    });
    const retry = el('input', {
        type: 'number', id: 'retry', value: form.retryCount, min: '0',
        onChange: (e) => { form.retryCount = e.target.value; },
    });
    const votes = el('input', {
        type: 'number', id: 'votes', value: form.voteRounds, min: '1', max: '10',
        onChange: (e) => { form.voteRounds = e.target.value; },
    });
    app.appendChild(el('div', { className: 'row' }, [
        el('label', {}, [el('span', { text: s.wait }), wait]),
        el('label', {}, [el('span', { text: s.retry }), retry]),
    ]));
    app.appendChild(el('label', {}, [el('span', { text: s.votes }), votes]));

    const fail = el('input', {
        type: 'checkbox',
        checked: form.notifyOnFailure,
        onChange: (e) => { form.notifyOnFailure = e.target.checked; },
    });
    const done = el('input', {
        type: 'checkbox',
        checked: form.notifyOnComplete,
        onChange: (e) => { form.notifyOnComplete = e.target.checked; },
    });
    app.appendChild(el('label', { className: 'switch-row' }, [el('span', { text: s.notifyFail }), fail]));
    app.appendChild(el('label', { className: 'switch-row' }, [el('span', { text: s.notifyDone }), done]));

    const summary = el('select', {
        id: 'summary',
        onChange: (e) => { form.summaryModelKey = e.target.value; },
    });
    summary.appendChild(el('option', { value: '', text: s.summaryAuto }));
    eligible.forEach((m) => {
        const opt = el('option', {
            value: m.key,
            text: `${m.label} (${m.score == null ? '?' : Math.round(m.score)})`,
        });
        if (m.key === form.summaryModelKey) opt.selected = true;
        summary.appendChild(opt);
    });
    app.appendChild(el('label', {}, [el('span', { text: s.summary }), summary]));

    app.appendChild(el('button', {
        type: 'button',
        className: 'primary',
        disabled: state.running || state.speedTesting || state.singleBusy,
        onClick: () => {
            logLines.length = 0;
            state.resultText = '';
            vscode.postMessage(Object.assign({ type: 'startWar' }, readForm()));
        },
        text: s.startWar,
    }));
    if (state.running) {
        app.appendChild(el('button', {
            type: 'button',
            className: 'ghost',
            onClick: () => vscode.postMessage({ type: 'cancelWar' }),
            text: s.cancel,
        }));
    }
    app.appendChild(el('div', { className: 'log', text: logLines.join('\n') || s.log }));
    app.appendChild(el('div', { className: 'result', text: state.resultText || s.result }));

    app.appendChild(el('h3', { text: s.history }));
    app.appendChild(el('button', {
        type: 'button',
        className: 'ghost',
        disabled: !(state.history || []).length,
        onClick: () => vscode.postMessage({ type: 'clearHistory' }),
        text: s.clearHistory,
    }));
    if (!(state.history || []).length) {
        app.appendChild(el('p', { className: 'hint', text: s.emptyHistory }));
        return;
    }
    (state.history || []).forEach((entry) => {
        const title = `${new Date(entry.startedAt).toLocaleString()} · ${entry.question || ''}`.trim();
        const item = el('div', {
            className: 'history-item',
            onClick: () => {
                openHistoryId = openHistoryId === entry.id ? '' : entry.id;
                render();
            },
        }, [el('div', { text: title })]);
        if (openHistoryId === entry.id) {
            item.appendChild(el('div', { className: 'history-body', text: formatHistory(entry) }));
        }
        app.appendChild(item);
    });
}

window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'state') {
        state = Object.assign({}, state, msg);
        syncFormFromState();
        render();
        return;
    }
    if (msg.type === 'warEvent' && msg.event) {
        const label = msg.event.sourceLabel ? `${msg.event.sourceLabel}: ` : '';
        logLines.push(`${label}${msg.event.text}`);
        render();
        return;
    }
    if (msg.type === 'warDone') {
        state.resultText = formatResult(msg.result);
        render();
        return;
    }
    if (msg.type === 'warError') {
        logLines.push(msg.text);
        render();
        return;
    }
    if (msg.type === 'speedEvent' && msg.event) {
        state.speedText = msg.event.text || state.speedText;
        render();
        return;
    }
    if (msg.type === 'speedDone') {
        state.speedText = msg.summary || '';
        speedExpanded = true;
        render();
        return;
    }
    if (msg.type === 'speedError') {
        state.speedText = msg.text;
        speedExpanded = true;
        render();
        return;
    }
    if (msg.type === 'singleDone') {
        state.singleReply = msg.reply || '';
        render();
        return;
    }
    if (msg.type === 'singleError') {
        state.singleReply = msg.text || '';
        render();
    }
});

render();
vscode.postMessage({ type: 'ready' });

