/**
 * Self-check for the bundled Kai extension: free-model catalog, OpenCode
 * config merge, and war-mode analysis/vote parsing.
 *
 * A wrong catalog would send war mode at paid Zen ids with the anonymous
 * `public` token, which the gateway rejects. A merge that overwrites an
 * existing API key would drop a key the user already saved. A parser that
 * cannot read fenced JSON or skip proposers would stall the second round.
 *
 * These modules do not load `vscode`, so nothing here opens a terminal.
 * extension.js is read as text to refuse spawn of the OpenCode binary.
 *
 *   node scripts/test-kai.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { newestExtensionDir } = require('./lib/bundled-extension');

const EXT_DIR = newestExtensionDir('vscodroid.vscodroid-kai-');
const catalog = require(path.join(EXT_DIR, 'catalog.js'));
const llm = require(path.join(EXT_DIR, 'llm.js'));
const opencodeConfig = require(path.join(EXT_DIR, 'opencode-config.js'));
const war = require(path.join(EXT_DIR, 'war.js'));
const benchmark = require(path.join(EXT_DIR, 'benchmark.js'));

function catalogHasZenFreeDefault() {
    assert.strictEqual(catalog.DEFAULT_ZEN_MODEL, 'big-pickle');
    assert.ok(catalog.isZenFree('big-pickle'));
    assert.ok(catalog.isZenFree('opencode/ling-3.0-flash-fin-free'));
    assert.ok(!catalog.isZenFree('gpt-5.4'));
    assert.strictEqual(catalog.resolveZenModel('gpt-5.4'), 'big-pickle');
    assert.ok(!catalog.ZEN_CHAT_URL.includes('kai9000.com'));
    const ids = catalog.zenFreeIds();
    assert.ok(ids.includes('mimo-v2.5-free'));
}

function catalogIncludesEveryKeylessProviderModel() {
    const all = catalog.allModels();
    const keys = new Set(all.map((m) => m.key));
    const byProvider = {};
    all.forEach((m) => {
        byProvider[m.providerId] = (byProvider[m.providerId] || 0) + 1;
    });
    assert.ok(all.length >= 120, `expected Agnes+LLM7+NavyAI plus the earlier keyless set, got ${all.length}`);
    assert.strictEqual(byProvider.agnes, 2);
    assert.strictEqual(byProvider.llm7, 5);
    assert.strictEqual(byProvider.navy, 87);
    assert.ok(keys.has('zen::laguna-s-2.1-free'));
    assert.ok(keys.has('kilo::stepfun/step-3.7-flash:free'));
    assert.ok(keys.has('ovh::Qwen3.6-27B'));
    assert.ok(keys.has('horde::llama-3'));
    assert.ok(keys.has('agnes::agnes-2.0-flash'));
    assert.ok(keys.has('llm7::codestral-latest'));
    assert.ok(keys.has('navy::deepseek-v4-flash'));
    const navy = all.find((m) => m.key === 'navy::deepseek-v4-flash');
    assert.strictEqual(navy.headers['User-Agent'], 'FreeLLMAPI/1.0');
    assert.strictEqual(navy.apiKey, null);
    const agnes = all.find((m) => m.key === 'agnes::agnes-2.0-flash');
    assert.ok(agnes.chatUrl.includes('agnes-ai.com'));
    assert.strictEqual(agnes.apiKey, null);
    assert.ok(catalog.passesScoreGate(all.find((m) => m.key === 'zen::big-pickle'), 0, 50));
    // FreeLLMAPI NO NEED KEY providers always pass the score gate.
    assert.ok(catalog.passesScoreGate(all.find((m) => m.key === 'ovh::gpt-oss-20b'), null, 50));
    assert.ok(catalog.passesScoreGate(all.find((m) => m.key === 'kilo::kilo-auto/free'), null, 50));
    assert.ok(catalog.passesScoreGate(all.find((m) => m.key === 'routeway::nemotron-nano-9b-v2:free'), null, 50));
    const eligible = catalog.eligibleModels([], 50);
    assert.ok(eligible.some((m) => m.providerId === 'zen'));
    assert.ok(eligible.some((m) => m.key === 'ovh::gpt-oss-20b'));
    assert.ok(eligible.some((m) => m.key === 'kilo::kilo-auto/free'));
    assert.ok(eligible.some((m) => m.providerId === 'navy'));
    assert.ok(eligible.some((m) => m.providerId === 'routeway'));
    assert.ok(!eligible.some((m) => m.providerId === 'nvidia'));
    assert.ok(!eligible.some((m) => m.providerId === 'openrouter'));
    assert.ok(keys.has('nvidia::meta/llama-3.1-8b-instruct'));
    assert.ok(keys.has('freellmapi::auto'));
    assert.ok(keys.has('openrouter::nvidia/nemotron-3-super-120b-a12b:free'));
    const nvidiaLocked = all.find((m) => m.key === 'nvidia::meta/llama-3.1-8b-instruct');
    assert.strictEqual(nvidiaLocked.ready, false);
    assert.ok(!catalog.passesScoreGate(nvidiaLocked, null, 0));
    const withNvidia = catalog.allModels({ keys: { nvidia: 'nvapi-test' } });
    const nvidiaReady = withNvidia.find((m) => m.key === 'nvidia::meta/llama-3.1-8b-instruct');
    assert.strictEqual(nvidiaReady.ready, true);
    assert.ok(catalog.passesScoreGate(nvidiaReady, null, 50));
    const freellm = catalog.allModels({
        keys: { freellmapi: 'freellmapi-test' },
        freeLlmApiBaseUrl: 'http://127.0.0.1:3001/v1',
    }).find((m) => m.key === 'freellmapi::auto');
    assert.ok(freellm.chatUrl.includes('127.0.0.1:3001'));
    assert.strictEqual(freellm.apiKey, 'freellmapi-test');
    assert.ok(all.find((m) => m.key === 'kilo::nvidia/nemotron-3-ultra-550b-a55b:free').noNeedKey);
}

function speedTestScoresCompletedAnswers() {
    const failed = benchmark.compute({
        modelKey: 'ovh::gpt-oss-20b',
        modelLabel: 'OVH / GPT-OSS 20B',
        serviceId: 'ovh',
        response: '',
        elapsedMs: 1200,
        attempts: 1,
        failed: true,
    });
    assert.strictEqual(failed.totalScore, 0);
    const ok = benchmark.compute({
        modelKey: 'zen::big-pickle',
        modelLabel: 'OpenCode Zen / Big Pickle',
        serviceId: 'zen',
        response: '1+1 equals 2.\nIt is addition.',
        elapsedMs: 800,
        attempts: 1,
        failed: false,
    });
    assert.ok(ok.totalScore > 50);
    const stored = benchmark.upsert([], ok);
    const keptUser = benchmark.upsert(
        [{ modelKey: ok.modelKey, isUserScore: true, totalScore: 99 }],
        ok,
    );
    assert.strictEqual(stored[0].modelKey, ok.modelKey);
    assert.strictEqual(keptUser[0].totalScore, 99);
}

function warRosterPinsZenAndKeylessOthers() {
    const roster = catalog.warRoster(5);
    assert.strictEqual(roster.length, 5);
    const zen = roster.filter((m) => m.providerId === 'zen');
    assert.ok(zen.length >= 2, 'Zen free models must sit in the war roster');
    zen.forEach((m) => assert.strictEqual(m.apiKey, catalog.ZEN_PUBLIC_KEY));
    const providers = new Set(roster.map((m) => m.providerId));
    assert.ok(providers.has('kilo'));
    assert.ok(providers.has('pollinations'));
    assert.ok(providers.has('ovh'));
    roster.forEach((m) => {
        assert.ok(m.chatUrl, `${m.key} missing chatUrl`);
        assert.ok(!m.chatUrl.includes('kai9000.com'));
    });
}

function mergeDoesNotOverwriteExistingKey() {
    const existing = {
        model: 'anthropic/claude-sonnet-4-5',
        provider: {
            opencode: { options: { apiKey: 'sk-user' } },
        },
    };
    const merged = opencodeConfig.mergeOpenCodeConfig(existing, 'mimo-v2.5-free');
    assert.strictEqual(merged.provider.opencode.options.apiKey, 'sk-user');
    assert.strictEqual(merged.model, 'opencode/mimo-v2.5-free');
}

function mergeFillsPublicKeyWhenMissing() {
    const merged = opencodeConfig.mergeOpenCodeConfig({}, 'not-a-model');
    assert.strictEqual(merged.provider.opencode.options.apiKey, 'public');
    assert.strictEqual(merged.model, 'opencode/big-pickle');
}

function writeMergedUsesInjectedIo() {
    const files = {};
    const written = opencodeConfig.writeMergedOpenCodeConfig('/tmp/fake-home', 'big-pickle', {
        exists: (p) => Object.prototype.hasOwnProperty.call(files, p),
        readFile: (p) => files[p],
        writeFile: (p, t) => { files[p] = t; },
        mkdir: () => {},
    });
    assert.strictEqual(written.model, 'opencode/big-pickle');
    const dest = opencodeConfig.configPath('/tmp/fake-home');
    assert.ok(files[dest]);
    const parsed = JSON.parse(files[dest]);
    assert.strictEqual(parsed.provider.opencode.options.apiKey, 'public');
}

function parseAnalysisReadsFencedJson() {
    const raw = 'here\n```json\n{"commonPoints":["A"],"aspects":[{"id":"d1","title":"B","description":"desc","proposedBy":["OpenCode Zen / Big Pickle"]}]}\n```\n';
    const parsed = war.parseAnalysis(raw);
    assert.ok(parsed);
    assert.deepStrictEqual(parsed.commonPoints, ['A']);
    assert.strictEqual(parsed.aspects.length, 1);
    assert.strictEqual(parsed.aspects[0].id, 'd1');
}

function parseVotesAndSkipProposers() {
    const aspects = [
        {
            id: 'd1',
            title: 'Plan B',
            description: '',
            proposedByLabels: ['OpenCode Zen / Big Pickle'],
            proposedByKeys: [],
        },
    ];
    const snapshots = [
        { key: 'zen::big-pickle', label: 'OpenCode Zen / Big Pickle' },
        { key: 'kilo::kilo-auto/free', label: 'Kilo Gateway / Kilo Auto Free' },
    ];
    const resolved = war.resolveProposers(aspects, snapshots);
    assert.deepStrictEqual(resolved[0].proposedByKeys, ['zen::big-pickle']);
    const assigned = war.aspectsForModel(resolved, 'zen::big-pickle', 'OpenCode Zen / Big Pickle');
    assert.deepStrictEqual(assigned, []);
    const others = war.aspectsForModel(resolved, 'kilo::kilo-auto/free', 'Kilo Gateway / Kilo Auto Free');
    assert.strictEqual(others.length, 1);
    const votes = war.parseVotes(
        '{"votes":[{"aspectId":"d1","agree":false,"reason":"no"}]}',
        others,
        'kilo::kilo-auto/free',
        'Kilo Gateway / Kilo Auto Free',
    );
    assert.strictEqual(votes[0].choice, 'DISAGREE');
    assert.ok(war.skipReason('Plan B').includes('提出方'));
}

function navyHeadersReachTheHttpClient() {
    const navy = catalog.allModels().find((m) => m.key === 'navy::deepseek-v4-flash');
    let seen;
    return llm.chatCompletions({
        chatUrl: navy.chatUrl,
        apiKey: navy.apiKey,
        model: navy.modelId,
        headers: navy.headers,
        messages: [{ role: 'user', content: 'hi' }],
        timeoutMs: 1000,
        postJson: async (_url, opts) => {
            seen = opts.headers;
            return JSON.stringify({ choices: [{ message: { content: 'ok' } }] });
        },
    }).then(() => {
        assert.strictEqual(seen['User-Agent'], 'FreeLLMAPI/1.0');
        assert.ok(!seen.Authorization);
    });
}

function assistantTextFromChoices() {
    const text = llm.assistantText({
        choices: [{ message: { content: ' hello ' } }],
    });
    assert.strictEqual(text.trim(), 'hello');
}

async function runWarWithStubChat() {
    const events = [];
    const models = catalog.warRoster(2);
    const result = await war.runWarTask(
        {
            question: 'How should we name the function?',
            maxWaitSeconds: 5,
            retryCount: 0,
            voteRounds: 1,
            notifyOnComplete: false,
            models,
        },
        {
            onEvent: (e) => events.push(e),
            chat: async (model, opts) => {
                const sys = (opts.messages || []).some((m) => m.role === 'system');
                const user = (opts.messages || []).map((m) => m.content).join('\n');
                if (sys) {
                    return JSON.stringify({
                        commonPoints: ['use a verb'],
                        aspects: [{
                            id: 'd1',
                            title: 'prefix with handle',
                            description: 'start with handle',
                            proposedBy: [models[0].label],
                        }],
                    });
                }
                if (user.includes('最终汇总')) {
                    return 'Keep the handle prefix.';
                }
                if (user.includes('交叉投票')) {
                    return JSON.stringify({
                        votes: [{ aspectId: 'd1', agree: true, reason: 'clear' }],
                    });
                }
                return `${model.label} says rename it.`;
            },
        },
    );
    assert.strictEqual(result.phase, war.PHASE.DONE);
    assert.deepStrictEqual(result.commonPoints, ['use a verb']);
    assert.ok(result.finalSummary.includes('handle'));
    assert.ok(events.some((e) => e.phase === war.PHASE.ROUND1_DISTRIBUTE));
    assert.ok(events.some((e) => e.phase === war.PHASE.ROUND2_DISTRIBUTE));
}

function extensionDoesNotSpawnOpenCode() {
    const src = fs.readFileSync(path.join(EXT_DIR, 'extension.js'), 'utf8');
    assert.ok(src.includes("sendText('opencode')"));
    assert.ok(!/\bspawn\s*\(/.test(src), 'extension.js must not spawn OpenCode');
    assert.ok(!src.includes('child_process'));
    assert.ok(
        !/execFile\s*\(|execSync\s*\(/.test(src),
        'extension.js must not exec OpenCode',
    );
}

function extensionSupportsEditorAndFullscreen() {
    const pkg = JSON.parse(fs.readFileSync(path.join(EXT_DIR, 'package.json'), 'utf8'));
    assert.strictEqual(pkg.version, '1.3.0');
    const cmds = new Set((pkg.contributes.commands || []).map((c) => c.command));
    assert.ok(cmds.has('vscodroid.kai.openInEditor'));
    assert.ok(cmds.has('vscodroid.kai.openFullscreen'));
    assert.ok(cmds.has('vscodroid.kai.openInSidebar'));
    const src = fs.readFileSync(path.join(EXT_DIR, 'extension.js'), 'utf8');
    assert.ok(src.includes('async openInEditor('));
    assert.ok(src.includes('async enterFullscreen('));
    assert.ok(src.includes('async exitFullscreenToSidebar('));
    assert.ok(src.includes("createWebviewPanel("));
    const panel = fs.readFileSync(path.join(EXT_DIR, 'media/panel.js'), 'utf8');
    assert.ok(panel.includes("type: 'openInEditor'"));
    assert.ok(panel.includes("type: 'openFullscreen'"));
    assert.ok(panel.includes("type: 'openInSidebar'"));
}

async function main() {
    catalogHasZenFreeDefault();
    catalogIncludesEveryKeylessProviderModel();
    speedTestScoresCompletedAnswers();
    warRosterPinsZenAndKeylessOthers();
    mergeDoesNotOverwriteExistingKey();
    mergeFillsPublicKeyWhenMissing();
    writeMergedUsesInjectedIo();
    parseAnalysisReadsFencedJson();
    parseVotesAndSkipProposers();
    assistantTextFromChoices();
    await navyHeadersReachTheHttpClient();
    extensionDoesNotSpawnOpenCode();
    extensionSupportsEditorAndFullscreen();
    await runWarWithStubChat();
}

main().then(
    () => {
        console.log('ok');
    },
    (err) => {
        console.error(err);
        process.exit(1);
    },
);
