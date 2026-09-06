'use strict';

const https = require('https');
const http = require('http');
const { URL } = require('url');

function defaultPostJson(urlString, { headers, body, timeoutMs }) {
    const url = new URL(urlString);
    const lib = url.protocol === 'http:' ? http : https;
    const payload = Buffer.from(body, 'utf8');
    const options = {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: Object.assign({
            'Content-Type': 'application/json',
            'Content-Length': payload.length,
        }, headers),
    };
    const ms = Math.max(1, Number(timeoutMs) || 60000);
    return new Promise((resolve, reject) => {
        const req = lib.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    const err = new Error(`HTTP ${res.statusCode}: ${text.slice(0, 300)}`);
                    err.statusCode = res.statusCode;
                    err.body = text;
                    reject(err);
                    return;
                }
                resolve(text);
            });
        });
        req.on('error', reject);
        req.setTimeout(ms, () => {
            req.destroy();
            reject(new Error(`timed out after ${ms}ms`));
        });
        req.write(payload);
        req.end();
    });
}

function assistantText(parsed) {
    const choice = parsed && parsed.choices && parsed.choices[0];
    const message = choice && choice.message;
    if (!message) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
        return message.content
            .map((part) => (typeof part === 'string' ? part : (part && part.text) || ''))
            .join('');
    }
    return '';
}

async function chatCompletions(opts) {
    const chatUrl = opts.chatUrl;
    const model = opts.model;
    const messages = opts.messages;
    const timeoutMs = opts.timeoutMs;
    const postJson = opts.postJson || defaultPostJson;
    const headers = Object.assign({}, opts.headers);
    if (opts.apiKey) {
        headers.Authorization = `Bearer ${opts.apiKey}`;
    }
    const body = JSON.stringify({
        model,
        messages,
        stream: false,
    });
    const raw = await postJson(chatUrl, { headers, body, timeoutMs });
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error('provider returned non-JSON');
    }
    const text = assistantText(parsed).trim();
    if (!text) {
        throw new Error('provider returned an empty message');
    }
    return text;
}

async function chatWithRetry(opts) {
    const retryCount = Math.max(0, Number(opts.retryCount) || 0);
    const isCancelled = opts.isCancelled;
    const onRetry = opts.onRetry;
    let lastError;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
        if (isCancelled && isCancelled()) {
            const err = new Error('cancelled');
            err.cancelled = true;
            throw err;
        }
        try {
            return await chatCompletions(opts);
        } catch (err) {
            if (err && err.cancelled) throw err;
            lastError = err;
            if (attempt < retryCount && onRetry) {
                onRetry(attempt + 1);
            }
        }
    }
    throw lastError || new Error('chat failed');
}

module.exports = {
    chatCompletions,
    chatWithRetry,
    assistantText,
    defaultPostJson,
};
