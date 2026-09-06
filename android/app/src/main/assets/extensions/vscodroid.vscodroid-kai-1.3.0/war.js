'use strict';

/**
 * War-mode orchestration ported from Kai 9000 (Apache-2.0).
 * https://github.com/cuixinyuan666/kai
 * Changes: JavaScript port for the VS Code extension host; collaboration
 * mode omitted; model scores replaced by a fixed keyless roster.
 */

const { chatWithRetry } = require('./llm');

const MAX_ASPECTS = 6;

const PHASE = {
    IDLE: 'IDLE',
    ROUND1_DISTRIBUTE: 'ROUND1_DISTRIBUTE',
    ROUND1_RESPONDING: 'ROUND1_RESPONDING',
    ANALYZING: 'ANALYZING',
    ROUND2_DISTRIBUTE: 'ROUND2_DISTRIBUTE',
    ROUND2_RESPONDING: 'ROUND2_RESPONDING',
    DONE: 'DONE',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
};

const ANALYST_SYSTEM_PROMPT =
    '你是多模型回答的仲裁分析员。请比较各模型对同一问题的方案，提取相同点与分歧方案。' +
    '必须只输出合法 JSON，不要 markdown 代码块，不要额外说明。' +
    '最多列出 6 个分歧方案。每个方案需有简短标题、描述，以及提出该方案的模型名称列表（必须与输入中的模型名称完全一致）。' +
    'JSON 格式：{"commonPoints":["方案A","方案C"], "aspects":[{"id":"d1","title":"方案B","description":"...","proposedBy":["模型我","模型你"]}]}' +
    'commonPoints 为多数或全体模型都提出的方案；aspects 为仅部分模型提出的分歧方案。' +
    '若全体完全一致，aspects 为空数组。';

function extractJsonObject(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
    if (fence) {
        const inner = fence[1].trim();
        if (inner.startsWith('{')) return inner;
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return trimmed.slice(start, end + 1);
    }
    return null;
}

function parseAgreeValue(value) {
    if (typeof value === 'boolean') return value;
    if (value == null) return null;
    const text = String(value).trim().toLowerCase();
    if (['true', 'yes', '同意', '是', '支持'].includes(text)) return true;
    if (['false', 'no', '不同意', '否', '反对'].includes(text)) return false;
    return null;
}

function parseAnalysis(raw) {
    const jsonText = extractJsonObject(raw);
    if (!jsonText) return null;
    let root;
    try {
        root = JSON.parse(jsonText);
    } catch (_e) {
        return null;
    }
    if (!root || typeof root !== 'object') return null;
    const commonPoints = Array.isArray(root.commonPoints)
        ? root.commonPoints.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
    const aspects = (Array.isArray(root.aspects) ? root.aspects : [])
        .map((obj) => {
            if (!obj || typeof obj !== 'object') return null;
            const id = String(obj.id || '').trim();
            const title = String(obj.title || '').trim();
            const description = String(obj.description || '').trim();
            if (!id || !title) return null;
            const proposedBy = Array.isArray(obj.proposedBy)
                ? obj.proposedBy.map((x) => String(x || '').trim()).filter(Boolean)
                : [];
            return {
                id,
                title,
                description,
                proposedByLabels: proposedBy,
                proposedByKeys: [],
            };
        })
        .filter(Boolean)
        .slice(0, MAX_ASPECTS);
    return { commonPoints, aspects };
}

function parseVotes(raw, aspects, modelKey, modelLabel) {
    const parsed = {};
    const jsonText = extractJsonObject(raw);
    if (jsonText) {
        try {
            const root = JSON.parse(jsonText);
            const votes = root && Array.isArray(root.votes) ? root.votes : [];
            votes.forEach((obj) => {
                if (!obj || typeof obj !== 'object') return;
                const aspectId = String(obj.aspectId || '').trim();
                if (!aspectId || !aspects.some((a) => a.id === aspectId)) return;
                const agree = parseAgreeValue(obj.agree);
                parsed[aspectId] = {
                    modelKey,
                    modelLabel,
                    choice: agree === true ? 'AGREE' : agree === false ? 'DISAGREE' : 'ABSTAIN',
                    reason: String(obj.reason || '').trim(),
                    aspectId,
                };
            });
        } catch (_e) {
            // fall through to abstain
        }
    }
    return aspects.map((aspect) => parsed[aspect.id] || {
        modelKey,
        modelLabel,
        choice: 'ABSTAIN',
        reason: '',
        aspectId: aspect.id,
    });
}

function splitPair(label) {
    const idx = label.indexOf(' / ');
    if (idx >= 0) {
        const left = label.slice(0, idx).trim();
        const right = label.slice(idx + 3).trim();
        return [left, right || null];
    }
    return [label.trim(), null];
}

function labelsMatch(a, b) {
    const left = String(a || '').trim();
    const right = String(b || '').trim();
    if (!left || !right) return false;
    if (left.toLowerCase() === right.toLowerCase()) return true;
    const [p1, c1] = splitPair(left);
    const [p2, c2] = splitPair(right);
    if (c1 && c1.toLowerCase() === right.toLowerCase()) return true;
    if (c2 && c2.toLowerCase() === left.toLowerCase()) return true;
    if (c1 && c2) return c1.toLowerCase() === c2.toLowerCase();
    return p1.toLowerCase() === p2.toLowerCase();
}

function isProposer(aspect, modelKey, modelLabel) {
    if ((!aspect.proposedByKeys || !aspect.proposedByKeys.length)
        && (!aspect.proposedByLabels || !aspect.proposedByLabels.length)) {
        return false;
    }
    if (modelKey && aspect.proposedByKeys && aspect.proposedByKeys.includes(modelKey)) {
        return true;
    }
    return (aspect.proposedByLabels || []).some((label) => labelsMatch(label, modelLabel));
}

function aspectsForModel(aspects, modelKey, modelLabel) {
    return aspects.filter((aspect) => !isProposer(aspect, modelKey, modelLabel));
}

function resolveProposers(aspects, snapshots) {
    return aspects.map((aspect) => {
        if (aspect.proposedByKeys && aspect.proposedByKeys.length) return aspect;
        const keys = (aspect.proposedByLabels || [])
            .map((label) => {
                const snap = snapshots.find((s) => labelsMatch(label, s.label));
                return snap ? snap.key : null;
            })
            .filter(Boolean)
            .filter((key, i, arr) => arr.indexOf(key) === i);
        return Object.assign({}, aspect, { proposedByKeys: keys });
    });
}

function skipReason(aspectTitle) {
    return `提出方，本轮交叉投票跳过（${aspectTitle}）`;
}

function aggregateAspectResults(aspects, allVotes) {
    const flat = allVotes.flat();
    const useIds = flat.some((v) => v.aspectId);
    return aspects.map((aspect, index) => {
        const votes = useIds
            ? flat.filter((v) => v.aspectId === aspect.id)
            : allVotes.map((list) => list[index]).filter(Boolean);
        return { aspect, votes };
    });
}

function buildAnalysisPrompt(question, snapshots) {
    const lines = ['【原始问题】', question, '', '【各模型回答】'];
    snapshots.forEach((snap) => {
        lines.push('', `--- ${snap.label} ---`);
        if (snap.failed || !snap.response) {
            lines.push('（调用失败，无回复）');
        } else {
            lines.push(snap.response);
        }
    });
    lines.push(
        '',
        '请分析以上回答的相同点与分歧方案，严格按 JSON 格式输出。',
        '每个分歧方案的 proposedBy 必须填写提出该方案的模型名称（与上方 --- 名称 --- 完全一致）。',
    );
    return lines.join('\n');
}

function appendAssignedAspects(lines, aspects) {
    aspects.forEach((aspect, index) => {
        const proposers = (aspect.proposedByLabels || []).join('、') || '其他模型';
        lines.push(`${index + 1}. [${aspect.id}] ${aspect.title}`);
        lines.push(` ${aspect.description}`);
        lines.push(` 提出方：${proposers}`);
        lines.push('');
    });
}

function buildCrossVotePrompt(aspects, voteRound) {
    const lines = [
        `【第 ${voteRound} 轮交叉投票】`,
        '以下分歧方案由其他模型提出，你在第 1 轮并未提出它们。请逐项表明是否认可该方案。',
        '必须只输出合法 JSON，不要 markdown 代码块。',
        'JSON 格式：',
        '{"votes":[{"aspectId":"d1","agree":true,"reason":"简短理由"}, ...]}',
        '',
    ];
    appendAssignedAspects(lines, aspects);
    lines.push('agree 为 true 表示同意采用该方案，false 表示不同意。每条必须给出 reason。');
    return lines.join('\n');
}

function buildFollowUpCrossVotePrompt(aspects, previousAspectResults, voteRound) {
    const lines = [
        `【第 ${voteRound} 轮交叉投票】`,
        '请再次对下列分歧方案表明是否同意。除方案本身外，必须结合上一轮对应的同意/不同意理由。',
        '必须只输出合法 JSON，不要 markdown 代码块。',
        'JSON 格式：',
        '{"votes":[{"aspectId":"d1","agree":true,"reason":"简短理由"}, ...]}',
        '',
        '【上一轮理由】',
    ];
    const assignedIds = new Set(aspects.map((a) => a.id));
    const previousVotes = (previousAspectResults || []).filter((ar) => assignedIds.has(ar.aspect.id));
    if (!previousVotes.length || previousVotes.every((ar) => !ar.votes.length)) {
        lines.push('上一轮没有附加理由。请再次确认你的立场。');
    } else {
        previousVotes.forEach((aspectResult) => {
            lines.push(`方案：${aspectResult.aspect.title}`);
            aspectResult.votes.forEach((vote) => {
                const stance = vote.choice === 'AGREE' ? '同意'
                    : vote.choice === 'DISAGREE' ? '不同意' : '未表态';
                const reason = String(vote.reason || '').trim() || '（未给出理由）';
                lines.push(` - ${vote.modelLabel}: ${stance}: ${reason}`);
            });
            lines.push('');
        });
    }
    lines.push('【本轮需投票的分歧方案】');
    appendAssignedAspects(lines, aspects);
    lines.push('agree 为 true 表示同意采用该方案，false 表示不同意。reason 必须针对上一轮理由给出你本轮自身的结论。');
    return lines.join('\n');
}

function buildFinalSummaryPrompt(question, commonPoints, voteRoundResults) {
    const lines = [
        '请对本次战争模式任务做最终汇总。',
        '【原始问题】',
        question,
        '',
        '【相同点】',
    ];
    if (!commonPoints.length) lines.push('（无）');
    else commonPoints.forEach((p) => lines.push(`- ${p}`));
    lines.push('');
    (voteRoundResults || []).forEach((round) => {
        lines.push(`【第 ${round.round} 轮投票】`);
        (round.aspectResults || []).forEach((aspectResult) => {
            const agree = (aspectResult.votes || []).filter((v) => v.choice === 'AGREE').length;
            const disagree = (aspectResult.votes || []).filter((v) => v.choice === 'DISAGREE').length;
            const valid = (aspectResult.votes || []).filter((v) => v.choice !== 'ABSTAIN').length;
            lines.push(
                `- ${aspectResult.aspect.title}：同意 ${agree}/${valid}，不同意 ${disagree}/${valid}`,
            );
            (aspectResult.votes || []).forEach((vote) => {
                const stance = vote.choice === 'AGREE' ? '同意'
                    : vote.choice === 'DISAGREE' ? '不同意' : '未表态';
                const reason = vote.reason ? ` (${vote.reason})` : '';
                lines.push(` ${vote.modelLabel}：${stance}${reason}`);
            });
        });
        lines.push('');
    });
    lines.push('请用中文输出最终建议：保留哪些方案、放弃哪些方案、以及简要理由。不要输出 JSON。');
    return lines.join('\n');
}

function chatForModel(chat, model, opts) {
    if (chat) {
        return chat(model, opts);
    }
    return chatWithRetry({
        chatUrl: model.chatUrl,
        apiKey: model.apiKey,
        model: model.modelId,
        headers: model.headers,
        messages: opts.messages,
        timeoutMs: opts.timeoutMs,
        retryCount: opts.retryCount,
        isCancelled: opts.isCancelled,
        onRetry: opts.onRetry,
        postJson: opts.postJson,
    });
}

async function collectVoteRound(params) {
    const {
        aspects, successful, timeoutMs, retryCount, voteRound,
        previousAspectResults, chat, onEvent, isCancelled, postJson,
    } = params;
    const batches = await Promise.all(successful.map(async (snap) => {
        if (isCancelled && isCancelled()) return [];
        const assigned = aspectsForModel(aspects, snap.key, snap.label);
        const skipped = aspects.filter((aspect) => assigned.every((a) => a.id !== aspect.id));
        if (!assigned.length) {
            onEvent({
                phase: PHASE.ROUND2_RESPONDING,
                text: `第 ${voteRound} 轮：提出方，跳过交叉投票。`,
                sourceLabel: snap.label,
                sessionKey: snap.key,
            });
            return skipped.map((aspect) => ({
                modelKey: snap.key,
                modelLabel: snap.label,
                choice: 'ABSTAIN',
                reason: skipReason(aspect.title),
                aspectId: aspect.id,
            }));
        }
        const votePrompt = voteRound >= 2
            ? buildFollowUpCrossVotePrompt(assigned, previousAspectResults, voteRound)
            : buildCrossVotePrompt(assigned, voteRound);
        onEvent({
            phase: PHASE.ROUND2_RESPONDING,
            text: `第 ${voteRound} 轮交叉投票中（${assigned.length} 个方案）…`,
            sourceLabel: snap.label,
            sessionKey: snap.key,
        });
        let voteRaw = '';
        try {
            voteRaw = await chatForModel(chat, snap, {
                messages: [{ role: 'user', content: votePrompt }],
                timeoutMs,
                retryCount,
                isCancelled,
                postJson,
                onRetry: (attempt) => onEvent({
                    phase: PHASE.ROUND2_RESPONDING,
                    text: `${snap.label} 第 ${voteRound} 轮投票第 ${attempt} 次失败，重试中…`,
                    sourceLabel: snap.label,
                    sessionKey: snap.key,
                }),
            });
        } catch (_e) {
            voteRaw = '';
        }
        const voted = voteRaw
            ? parseVotes(voteRaw, assigned, snap.key, snap.label)
            : assigned.map((aspect) => ({
                modelKey: snap.key,
                modelLabel: snap.label,
                choice: 'ABSTAIN',
                reason: '',
                aspectId: aspect.id,
            }));
        const skipVotes = skipped.map((aspect) => ({
            modelKey: snap.key,
            modelLabel: snap.label,
            choice: 'ABSTAIN',
            reason: skipReason(aspect.title),
            aspectId: aspect.id,
        }));
        return voted.concat(skipVotes);
    }));
    return aggregateAspectResults(aspects, batches);
}

async function runWarTask(params, deps) {
    const models = params.models || [];
    const question = String(params.question || '').trim();
    const timeoutMs = Math.max(1, Number(params.maxWaitSeconds) || 60) * 1000;
    const retryCount = Math.max(0, Number(params.retryCount) || 0);
    const voteRounds = Math.min(10, Math.max(1, Number(params.voteRounds) || 2));
    const onEvent = (deps && deps.onEvent) || (() => {});
    const onNotify = (deps && deps.onNotify) || (() => {});
    const isCancelled = (deps && deps.isCancelled) || (() => false);
    const chat = deps && deps.chat;
    const postJson = deps && deps.postJson;

    if (!question) {
        onNotify('无法开始战争模式', '请先填写问题。');
        return { phase: PHASE.FAILED, analysisError: '请先填写问题。' };
    }
    if (!models.length) {
        onNotify('无法开始战争模式', '没有可用的免密钥模型。');
        return { phase: PHASE.FAILED, analysisError: '没有符合条件的模型。' };
    }

    onEvent({
        phase: PHASE.ROUND1_DISTRIBUTE,
        text: `第 1 轮：向 ${models.length} 个模型并行发送任务。`,
    });

    const snapshots = await Promise.all(models.map(async (model) => {
        if (isCancelled()) {
            return Object.assign({}, model, {
                failed: true, response: null, elapsedMs: 0, attempts: 0,
            });
        }
        onEvent({
            phase: PHASE.ROUND1_RESPONDING,
            text: '作答中…',
            sourceLabel: model.label,
            sessionKey: model.key,
        });
        const started = Date.now();
        let attempts = 1;
        try {
            const text = await chatForModel(chat, model, {
                messages: [{ role: 'user', content: question }],
                timeoutMs,
                retryCount,
                isCancelled,
                postJson,
                onRetry: (attempt) => {
                    attempts = attempt + 1;
                    onEvent({
                        phase: PHASE.ROUND1_RESPONDING,
                        text: `${model.label} 第 ${attempt} 次失败，重试中…`,
                        sourceLabel: model.label,
                        sessionKey: model.key,
                    });
                },
            });
            const ok = Boolean(text && String(text).trim());
            return Object.assign({}, model, {
                failed: !ok,
                response: ok ? String(text).trim() : null,
                elapsedMs: Date.now() - started,
                attempts,
            });
        } catch (_e) {
            return Object.assign({}, model, {
                failed: true,
                response: null,
                elapsedMs: Date.now() - started,
                attempts,
            });
        }
    }));

    const transcripts = snapshots.map((snap) => ({
        key: snap.key,
        label: snap.label,
        failed: Boolean(snap.failed),
        response: snap.response || '',
        elapsedMs: snap.elapsedMs || 0,
        attempts: snap.attempts || 1,
    }));

    if (isCancelled()) {
        onEvent({ phase: PHASE.CANCELLED, text: '任务已取消。' });
        return { phase: PHASE.CANCELLED, question, transcripts };
    }

    const success = snapshots.filter((s) => !s.failed && s.response);
    if (!success.length) {
        const analysisError = '所有模型第 1 轮均失败。';
        onEvent({ phase: PHASE.FAILED, text: analysisError });
        onNotify('战争模式结束', analysisError);
        return {
            phase: PHASE.FAILED,
            question,
            analysisFailed: true,
            analysisError,
            round1SuccessCount: 0,
            round1TotalCount: models.length,
            transcripts,
        };
    }

    const preferred = params.summaryModelKey;
    const analysisOrder = preferred
        ? success.filter((s) => s.key === preferred).concat(success.filter((s) => s.key !== preferred))
        : success;
    const analysisPrompt = buildAnalysisPrompt(question, success);
    let analysis = null;
    let summary = analysisOrder[0];
    for (const candidate of analysisOrder) {
        if (isCancelled()) break;
        onEvent({
            phase: PHASE.ANALYZING,
            text: `总结模型 ${candidate.label} 正在分析各模型回答…`,
        });
        try {
            const raw = await chatForModel(chat, candidate, {
                messages: [
                    { role: 'system', content: ANALYST_SYSTEM_PROMPT },
                    { role: 'user', content: analysisPrompt },
                ],
                timeoutMs,
                retryCount: Math.max(retryCount, 1),
                isCancelled,
                postJson,
            });
            analysis = parseAnalysis(raw);
            if (analysis) {
                summary = candidate;
                break;
            }
        } catch (_e) {
            analysis = null;
        }
        onEvent({ phase: PHASE.ANALYZING, text: `${candidate.label} 总结失败，改用下一模型。` });
    }

    if (!analysis) {
        const analysisError = '所有候选总结模型均未能输出有效 JSON 分析结果。';
        onEvent({ phase: PHASE.DONE, text: analysisError });
        if (params.notifyOnComplete) onNotify('战争模式结束', analysisError);
        return {
            phase: PHASE.DONE,
            question,
            analysisFailed: true,
            analysisError,
            round1SuccessCount: success.length,
            round1TotalCount: models.length,
            summaryModelKey: summary.key,
            summaryModelLabel: summary.label,
            transcripts,
        };
    }

    const commonPoints = analysis.commonPoints;
    const aspects = resolveProposers(analysis.aspects, success);

    if (!aspects.length) {
        const finalSummary = '战争模式完成：全体一致，无分歧方案。';
        onEvent({ phase: PHASE.DONE, text: finalSummary });
        if (params.notifyOnComplete) onNotify('战争模式结束', finalSummary);
        return {
            phase: PHASE.DONE,
            question,
            commonPoints,
            aspectResults: [],
            voteRoundResults: [],
            finalSummary,
            round1SuccessCount: success.length,
            round1TotalCount: models.length,
            summaryModelKey: summary.key,
            summaryModelLabel: summary.label,
            transcripts,
        };
    }

    const voteRoundResults = [];
    let previousAspectResults = [];
    for (let voteRound = 1; voteRound <= voteRounds; voteRound++) {
        if (isCancelled()) {
            onEvent({ phase: PHASE.CANCELLED, text: '任务已取消。' });
            return { phase: PHASE.CANCELLED, question, transcripts };
        }
        onEvent({
            phase: PHASE.ROUND2_DISTRIBUTE,
            text: `第 ${voteRound} 轮交叉投票：将分歧方案下发给未提出该方案的模型。`,
        });
        const aspectResults = await collectVoteRound({
            aspects,
            successful: success,
            timeoutMs,
            retryCount,
            voteRound,
            previousAspectResults,
            chat,
            onEvent,
            isCancelled,
            postJson,
        });
        voteRoundResults.push({ round: voteRound, aspectResults });
        previousAspectResults = aspectResults;
    }

    onEvent({ phase: PHASE.ANALYZING, text: '总结模型正在输出最终汇总…' });
    const finalPrompt = buildFinalSummaryPrompt(question, commonPoints, voteRoundResults);
    let finalSummary;
    try {
        finalSummary = await chatForModel(chat, summary, {
            messages: [{ role: 'user', content: finalPrompt }],
            timeoutMs,
            retryCount,
            isCancelled,
            postJson,
        });
    } catch (_e) {
        finalSummary = `已完成 ${voteRounds} 轮交叉投票。`;
    }
    if (!finalSummary) finalSummary = `已完成 ${voteRounds} 轮交叉投票。`;

    const doneText = `战争模式完成：${aspects.length} 个分歧方案，共 ${voteRounds} 轮交叉投票`;
    onEvent({ phase: PHASE.DONE, text: doneText });
    if (params.notifyOnComplete) onNotify('战争模式结束', doneText);

    return {
        phase: PHASE.DONE,
        question,
        commonPoints,
        aspectResults: previousAspectResults,
        voteRoundResults,
        voteRoundCount: voteRounds,
        finalSummary,
        round1SuccessCount: success.length,
        round1TotalCount: models.length,
        summaryModelKey: summary.key,
        summaryModelLabel: summary.label,
        transcripts,
    };
}

module.exports = {
    MAX_ASPECTS,
    PHASE,
    ANALYST_SYSTEM_PROMPT,
    extractJsonObject,
    parseAnalysis,
    parseVotes,
    labelsMatch,
    isProposer,
    aspectsForModel,
    resolveProposers,
    skipReason,
    aggregateAspectResults,
    buildAnalysisPrompt,
    buildCrossVotePrompt,
    buildFollowUpCrossVotePrompt,
    buildFinalSummaryPrompt,
    runWarTask,
};
