'use strict';

/**
 * Speed-test scoring ported from Kai TaskAutoScore / SettingsViewModel
 * (Apache-2.0). https://github.com/cuixinyuan666/kai
 */

const { chatWithRetry } = require('./llm');

const WEIGHTS = {
    completion: 0.25,
    responseSpeed: 0.25,
    stability: 0.20,
    quality: 0.30,
};

const BENCHMARK_PROMPT = '请回答：1+1 等于几？并简要解释你的推理过程。';
const BENCHMARK_SYSTEM = 'You are a helpful assistant. Answer concisely.';
const BENCHMARK_CONCURRENCY = 2;
const BENCHMARK_TIMEOUT_MS = 60_000;

function qualityScore(text) {
    const t = String(text || '').trim();
    if (!t) return 0;
    const lower = t.toLowerCase();
    if (t.length < 80 && (lower.includes('error') || t.includes('失败') || lower.includes('exception'))) {
        return 20;
    }
    const lengthScore = t.length < 20 ? 30 : t.length < 80 ? 55 : t.length <= 4000 ? 90 : 72;
    let structureBonus = 0;
    if (t.includes('```') || t.includes('\n')) structureBonus = 10;
    else if (/[。.!？?]/.test(t)) structureBonus = 6;
    return Math.max(0, Math.min(100, lengthScore + structureBonus));
}

function compute(params) {
    const modelKey = String(params.modelKey || '');
    const modelLabel = String(params.modelLabel || params.modelId || modelKey);
    const serviceId = String(params.serviceId || '');
    const text = String(params.response || '').trim();
    const charCount = text.length;
    const elapsedMs = Math.max(0, Number(params.elapsedMs) || 0);
    const attempts = Math.max(1, Number(params.attempts) || 1);
    const failed = Boolean(params.failed) || charCount <= 0;
    const testedAt = Number(params.testedAt) || Date.now();
    if (failed) {
        return {
            modelKey,
            modelLabel,
            serviceId,
            isUserScore: false,
            totalScore: 0,
            completion: 0,
            speed: 0,
            responseSpeed: 0,
            wordCount: 0,
            stability: 0,
            quality: 0,
            elapsedMs,
            charCount: 0,
            testedAt,
        };
    }
    const completion = 100;
    const speed = Math.max(0, Math.min(1, (60_000 - elapsedMs) / 60_000)) * 100;
    const charsPerSec = elapsedMs > 0 ? charCount / (elapsedMs / 1000) : 0;
    const responseSpeed = Math.max(0, Math.min(1, charsPerSec / 50)) * 100;
    const wordCount = Math.max(0, Math.min(1, charCount / 500)) * 100;
    const stability = attempts <= 1 ? 100 : attempts === 2 ? 70 : Math.max(20, Math.min(55, 100 / attempts));
    const quality = qualityScore(text);
    const total = completion * WEIGHTS.completion
        + responseSpeed * WEIGHTS.responseSpeed
        + stability * WEIGHTS.stability
        + quality * WEIGHTS.quality;
    return {
        modelKey,
        modelLabel,
        serviceId,
        isUserScore: false,
        totalScore: Math.max(0, Math.min(100, total)),
        completion,
        speed,
        responseSpeed,
        wordCount,
        stability,
        quality,
        elapsedMs,
        charCount,
        testedAt,
    };
}

function upsert(list, benchmark) {
    const current = Array.isArray(list) ? list.slice() : [];
    const existing = current.find((b) => b.modelKey === benchmark.modelKey);
    if (!benchmark.isUserScore && existing && existing.isUserScore) {
        return current;
    }
    return current.filter((b) => b.modelKey !== benchmark.modelKey).concat(benchmark);
}

function buildSummary(benchmarks) {
    if (!benchmarks.length) return '没有可用的测试结果。';
    const ranked = benchmarks.slice().sort((a, b) => b.totalScore - a.totalScore);
    const avg = benchmarks.reduce((sum, b) => sum + b.totalScore, 0) / benchmarks.length;
    const failed = benchmarks.filter((b) => b.completion <= 0).length;
    const best = ranked[0];
    const fastest = benchmarks.filter((b) => b.completion > 0).sort((a, b) => a.elapsedMs - b.elapsedMs)[0];
    const longest = benchmarks.slice().sort((a, b) => b.charCount - a.charCount)[0];
    const lines = [
        `测试完成：共 ${benchmarks.length} 个模型，平均分 ${Math.round(avg)}，失败（无响应）${failed} 个`,
        '',
        '排名（总分降序）：',
    ];
    ranked.forEach((bm, i) => {
        const status = bm.completion > 0
            ? `完成 ${Math.round(bm.completion)}，耗时 ${Math.round(bm.elapsedMs / 1000)}s，${bm.charCount} 字`
            : '无响应';
        lines.push(`${i + 1}. ${bm.modelLabel}：${Math.round(bm.totalScore)} 分（${status}）`);
    });
    lines.push('', `最佳：${best.modelLabel}（${Math.round(best.totalScore)} 分）`);
    if (fastest) lines.push(`最快：${fastest.modelLabel}（${Math.round(fastest.elapsedMs / 1000)}s）`);
    if (longest) lines.push(`最长回复：${longest.modelLabel}（${longest.charCount} 字）`);
    return lines.join('\n');
}

async function mapPool(items, limit, fn) {
    const ret = new Array(items.length);
    let next = 0;
    async function worker() {
        while (next < items.length) {
            const idx = next;
            next += 1;
            ret[idx] = await fn(items[idx], idx);
        }
    }
    const workers = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: workers }, () => worker()));
    return ret;
}

async function runSpeedTest(models, deps) {
    const list = models || [];
    const onEvent = (deps && deps.onEvent) || (() => {});
    const isCancelled = (deps && deps.isCancelled) || (() => false);
    const chat = deps && deps.chat;
    const postJson = deps && deps.postJson;
    const results = await mapPool(list, BENCHMARK_CONCURRENCY, async (model, index) => {
        if (isCancelled()) {
            return compute({
                modelKey: model.key,
                modelLabel: model.label,
                serviceId: model.providerId,
                response: '',
                elapsedMs: 0,
                attempts: 1,
                failed: true,
            });
        }
        onEvent({
            done: index,
            total: list.length,
            label: model.label,
            text: `测速中：${model.label}`,
        });
        const started = Date.now();
        let response = '';
        let failed = false;
        try {
            if (chat) {
                response = await chat(model, {
                    messages: [
                        { role: 'system', content: BENCHMARK_SYSTEM },
                        { role: 'user', content: BENCHMARK_PROMPT },
                    ],
                    timeoutMs: BENCHMARK_TIMEOUT_MS,
                    retryCount: 0,
                    isCancelled,
                    postJson,
                });
            } else {
                response = await chatWithRetry({
                    chatUrl: model.chatUrl,
                    apiKey: model.apiKey,
                    model: model.modelId,
                    headers: model.headers,
                    messages: [
                        { role: 'system', content: BENCHMARK_SYSTEM },
                        { role: 'user', content: BENCHMARK_PROMPT },
                    ],
                    timeoutMs: BENCHMARK_TIMEOUT_MS,
                    retryCount: 0,
                    isCancelled,
                    postJson,
                });
            }
        } catch (_e) {
            failed = true;
            response = '';
        }
        const benchmark = compute({
            modelKey: model.key,
            modelLabel: model.label,
            serviceId: model.providerId,
            response,
            elapsedMs: Date.now() - started,
            attempts: 1,
            failed: failed || !String(response || '').trim(),
        });
        onEvent({
            done: index + 1,
            total: list.length,
            label: model.label,
            text: `${model.label}：${Math.round(benchmark.totalScore)} 分`,
            benchmark,
        });
        return benchmark;
    });
    return {
        benchmarks: results,
        summary: buildSummary(results),
    };
}

module.exports = {
    WEIGHTS,
    BENCHMARK_PROMPT,
    BENCHMARK_CONCURRENCY,
    qualityScore,
    compute,
    upsert,
    buildSummary,
    runSpeedTest,
};
