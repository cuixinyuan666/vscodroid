'use strict';

/**
 * API key storage helpers and Kai settings JSON import.
 * Supports flat maps and Kai export `instance_settings` + `configured_services`.
 */

const KEYS_STATE = 'vscodroid.kai.apiKeys';
const BASE_STATE = 'vscodroid.kai.freeLlmApiBaseUrl';

const PROVIDER_ALIASES = {
    nvidia: 'nvidia',
    freellmapi: 'freellmapi',
    free_llm_api: 'freellmapi',
    opencode: 'opencode',
    'opencode-terminal': 'opencode',
    zen: 'opencode',
    navy: 'navy',
    navyai: 'navy',
    groq: 'groq',
    groqcloud: 'groq',
    openrouter: 'openrouter',
    openai: 'openai',
    anthropic: 'anthropic',
    gemini: 'gemini',
    deepseek: 'deepseek',
    ainative: 'ainative',
    aion: 'aion',
    bazaarlink: 'bazaarlink',
    cohere: 'cohere',
    github: 'github',
    nara: 'nara',
    reka: 'reka',
    requesty: 'requesty',
    routeway: 'routeway',
    sealion: 'sealion',
    zhipu: 'zhipu',
    aihorde: 'aihorde',
    horde: 'aihorde',
    llm7: 'llm7',
    agnes: 'agnes',
    kilo: 'kilo',
    ovh: 'ovh',
    pollinations: 'pollinations',
    huggingface: 'huggingface',
    mistral: 'mistral',
    siliconflow: 'siliconflow',
    sensenova: 'sensenova',
    'openai-compatible': 'agnes',
    cloudflare: 'cloudflare',
};

function normalizeProviderId(id) {
    const raw = String(id || '').trim().toLowerCase();
    if (!raw) return '';
    if (PROVIDER_ALIASES[raw]) return PROVIDER_ALIASES[raw];
    const base = raw.split('_')[0];
    return PROVIDER_ALIASES[base] || raw;
}

function emptyKeys() {
    return {
        nvidia: '',
        freellmapi: '',
        opencode: '',
        navy: '',
        groq: '',
        openrouter: '',
        openai: '',
        anthropic: '',
        gemini: '',
        deepseek: '',
        ainative: '',
        aion: '',
        bazaarlink: '',
        cohere: '',
        github: '',
        nara: '',
        reka: '',
        requesty: '',
        routeway: '',
        sealion: '',
        zhipu: '',
        aihorde: '',
        llm7: '',
        agnes: '',
        huggingface: '',
        mistral: '',
        siliconflow: '',
        sensenova: '',
        cloudflare: '',
    };
}

function sanitizeKeys(input) {
    const out = emptyKeys();
    const src = input && typeof input === 'object' ? input : {};
    Object.keys(out).forEach((k) => {
        if (typeof src[k] === 'string' && src[k].trim()) out[k] = src[k].trim();
    });
    return out;
}

function mergeKeys(current, patch) {
    const next = sanitizeKeys(current);
    const add = sanitizeKeys(patch);
    Object.keys(add).forEach((k) => {
        if (add[k]) next[k] = add[k];
    });
    return next;
}

function parseConfiguredServices(raw) {
    const map = {};
    if (!raw) return map;
    let arr = raw;
    if (typeof raw === 'string') {
        try {
            arr = JSON.parse(raw);
        } catch (_e) {
            return map;
        }
    }
    if (!Array.isArray(arr)) return map;
    arr.forEach((item) => {
        if (typeof item === 'string') {
            map[item] = item;
            return;
        }
        if (!item || typeof item !== 'object') return;
        const instanceId = String(item.instanceId || '').trim();
        const serviceId = String(item.serviceId || instanceId).trim();
        if (instanceId) map[instanceId] = serviceId || instanceId;
    });
    return map;
}

function parseKeysPayload(text) {
    const keys = emptyKeys();
    let freeLlmApiBaseUrl = '';
    let parsed;
    try {
        parsed = typeof text === 'string' ? JSON.parse(text) : text;
    } catch (err) {
        throw new Error(`JSON 解析失败: ${err && err.message ? err.message : err}`);
    }
    if (!parsed || typeof parsed !== 'object') {
        throw new Error('密钥文件必须是 JSON 对象');
    }

    const flat = parsed.apiKeys && typeof parsed.apiKeys === 'object' ? parsed.apiKeys : parsed;
    Object.keys(flat).forEach((k) => {
        if (typeof flat[k] !== 'string') return;
        const provider = normalizeProviderId(k);
        if (provider && Object.prototype.hasOwnProperty.call(keys, provider) && flat[k].trim()) {
            keys[provider] = flat[k].trim();
        }
    });

    if (typeof parsed.freeLlmApiBaseUrl === 'string' && parsed.freeLlmApiBaseUrl.trim()) {
        freeLlmApiBaseUrl = parsed.freeLlmApiBaseUrl.trim();
    }
    if (typeof parsed.freellmapi_base_url === 'string' && parsed.freellmapi_base_url.trim()) {
        freeLlmApiBaseUrl = parsed.freellmapi_base_url.trim();
    }

    const instanceMap = parseConfiguredServices(parsed.configured_services);
    const settings = parsed.instance_settings;
    if (Array.isArray(settings)) {
        settings.forEach((row) => {
            if (!row || typeof row !== 'object') return;
            const instanceId = String(row.instanceId || '').trim();
            const apiKey = typeof row.api_key === 'string' ? row.api_key.trim() : '';
            if (!instanceId || !apiKey) return;
            if (apiKey.toLowerCase().startsWith('freellmapi')) return;
            const serviceId = instanceMap[instanceId] || instanceId;
            const provider = normalizeProviderId(serviceId);
            if (provider && Object.prototype.hasOwnProperty.call(keys, provider)) {
                keys[provider] = apiKey;
            }
            const baseUrl = typeof row.base_url === 'string' ? row.base_url.trim() : '';
            if (provider === 'freellmapi' && baseUrl) {
                freeLlmApiBaseUrl = baseUrl;
            }
        });
    }

    return { keys: sanitizeKeys(keys), freeLlmApiBaseUrl };
}

function maskKey(value) {
    const s = String(value || '');
    if (!s) return '';
    if (s.length <= 8) return '••••';
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function keysStatus(keys) {
    const k = sanitizeKeys(keys);
    const out = {};
    Object.keys(k).forEach((id) => {
        out[id] = {
            set: Boolean(k[id]),
            masked: k[id] ? maskKey(k[id]) : '',
        };
    });
    return out;
}

module.exports = {
    KEYS_STATE,
    BASE_STATE,
    emptyKeys,
    sanitizeKeys,
    mergeKeys,
    parseKeysPayload,
    keysStatus,
    maskKey,
    normalizeProviderId,
};
