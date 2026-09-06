'use strict';

/**
 * Keyless chat endpoints and free-tier model ids, snapshotted from the Kai
 * fork's FreeTierModels / OpenCodeTerminalCapabilities / Service.kt (Apache-2.0).
 * https://github.com/cuixinyuan666/kai
 * Changes: JavaScript port; the kai9000.com APP-FREE proxy is omitted.
 */

const ZEN_PUBLIC_KEY = 'public';
const ZEN_CHAT_URL = 'https://opencode.ai/zen/v1/chat/completions';
const DEFAULT_MIN_SCORE = 0;
const DEFAULT_FREELLMAPI_BASE = 'http://127.0.0.1:3001/v1';

const NVIDIA_MODELS = [
    { id: 'meta/llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct' },
    { id: 'meta/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
    { id: 'google/gemma-2-9b-it', label: 'Gemma 2 9B IT' },
    { id: 'mistralai/mistral-7b-instruct-v0.3', label: 'Mistral 7B Instruct' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', label: 'Nemotron 70B Instruct' },
    { id: 'nvidia/nemotron-mini-4b-instruct', label: 'Nemotron Mini 4B' },
    { id: 'nvidia/nvidia-nemotron-nano-9b-v2', label: 'Nemotron Nano 9B V2' },
    { id: 'deepseek-ai/deepseek-r1', label: 'DeepSeek R1' },
    { id: 'qwen/qwen2.5-coder-32b-instruct', label: 'Qwen2.5 Coder 32B' },
];

const FREELLMAPI_MODELS = [
    { id: 'auto', label: 'Auto' },
    { id: 'auto:fast', label: 'Auto Fast' },
    { id: 'auto:smart', label: 'Auto Smart' },
    { id: 'auto:coding', label: 'Auto Coding' },
];

const ZEN_FREE = [
    { id: 'big-pickle', label: 'Big Pickle' },
    { id: 'ling-3.0-flash-fin-free', label: 'Ling 3.0 Flash Fin Free' },
    { id: 'mimo-v2.5-free', label: 'MiMo-V2.5 Free' },
    { id: 'muse-spark-1.2-contributor-free', label: 'Muse Spark 1.2 Contributor Free' },
    { id: 'muse-spark-1.3-contributor-free', label: 'Muse Spark 1.3 Contributor Free' },
    { id: 'nemotron-3-ultra-free', label: 'Nemotron 3 Ultra Free' },
    { id: 'nemotron-3.5-lightning-free', label: 'Nemotron 3.5 Lightning Free' },
    { id: 'deepseek-v4-flash-free', label: 'DeepSeek V4 Flash Free' },
    { id: 'laguna-s-2.1-free', label: 'Laguna S 2.1 Free' },
];

const DEFAULT_ZEN_MODEL = 'big-pickle';

const PROVIDERS = {
    zen: {
        id: 'zen',
        name: 'OpenCode Zen',
        chatUrl: ZEN_CHAT_URL,
        apiKey: ZEN_PUBLIC_KEY,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: ZEN_FREE,
    },
    freellmapi: {
        id: 'freellmapi',
        name: 'FreeLLMAPI',
        chatUrl: `${DEFAULT_FREELLMAPI_BASE}/chat/completions`,
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: FREELLMAPI_MODELS,
    },
    nvidia: {
        id: 'nvidia',
        name: 'NVIDIA',
        chatUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        modelsUrl: 'https://integrate.api.nvidia.com/v1/models',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: NVIDIA_MODELS,
    },
    kilo: {
        id: 'kilo',
        name: 'Kilo Gateway',
        chatUrl: 'https://api.kilo.ai/api/gateway/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'kilo-auto/free', label: 'Kilo Auto Free' },
            { id: 'cohere/north-mini-code:free', label: 'North Mini Code' },
            { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Nano Omni Reasoning' },
            { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super 120B' },
            { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B' },
            { id: 'nvidia/nemotron-3.5-content-safety:free', label: 'Nemotron 3.5 Content Safety' },
            { id: 'openrouter/free', label: 'Free Router' },
            { id: 'poolside/laguna-xs-2.1:free', label: 'Poolside Laguna XS 2.1' },
            { id: 'stepfun/step-3.7-flash:free', label: 'StepFun Step 3.7 Flash' },
        ],
    },
    pollinations: {
        id: 'pollinations',
        name: 'Pollinations',
        chatUrl: 'https://gen.pollinations.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [{ id: 'openai-fast', label: 'GPT-OSS 20B' }],
    },
    horde: {
        id: 'horde',
        name: 'AI Horde',
        chatUrl: 'https://oai.aihorde.net/v1/chat/completions',
        apiKey: '0000000000',
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [{ id: 'llama-3', label: 'AI Horde Llama 3' }],
    },
    routeway: {
        id: 'routeway',
        name: 'Routeway',
        chatUrl: 'https://api.routeway.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        headers: { 'User-Agent': 'Mozilla/5.0 FreeLLMAPI/1.0' },
        models: [
            { id: 'llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B Instruct' },
            { id: 'nemotron-3-nano-30b-a3b:free', label: 'Nemotron 3 Nano 30B A3B' },
            { id: 'nemotron-nano-9b-v2:free', label: 'Nemotron Nano 9B v2' },
            { id: 'step-3.7-flash:free', label: 'StepFun Step 3.7 Flash' },
        ],
    },
    agnes: {
        id: 'agnes',
        name: 'Agnes AI',
        chatUrl: 'https://apihub.agnes-ai.com/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'agnes-2.0-flash', label: 'Agnes · 多模态对话/推理/看图' },
            { id: 'agnes-1.5-flash', label: 'Agnes · 轻量多模态' },
        ],
    },
    llm7: {
        id: 'llm7',
        name: 'LLM7',
        chatUrl: 'https://api.llm7.io/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'gpt-oss-20b', label: 'GPT-OSS 20B' },
            { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', label: 'Llama 3.1 8B Turbo' },
            { id: 'codestral-latest', label: 'Codestral' },
            { id: 'ministral-8b-2512', label: 'Ministral 8B' },
            { id: 'GLM-4.6V-Flash', label: 'GLM-4.6V Flash' },
        ],
    },
    navy: {
        id: 'navy',
        name: 'NavyAI',
        chatUrl: 'https://api.navy/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        headers: { 'User-Agent': 'FreeLLMAPI/1.0' },
        models: [
            { id: 'c4ai-aya-expanse-32b', label: 'C4ai Aya Expanse 32B' },
            { id: 'c4ai-aya-vision-32b', label: 'C4ai Aya Vision 32B' },
            { id: 'codestral-2508', label: 'Codestral 2508' },
            { id: 'codestral-latest', label: 'Codestral Latest' },
            { id: 'command-a', label: 'Command A' },
            { id: 'command-a-plus', label: 'Command A Plus' },
            { id: 'command-a-reasoning', label: 'Command A Reasoning' },
            { id: 'command-a-vision', label: 'Command A Vision' },
            { id: 'command-r', label: 'Command R' },
            { id: 'command-r-7b', label: 'Command R 7B' },
            { id: 'command-r-plus', label: 'Command R Plus' },
            { id: 'deepseek-chat', label: 'Deepseek Chat' },
            { id: 'deepseek-reasoner', label: 'Deepseek Reasoner' },
            { id: 'deepseek-v3.2', label: 'Deepseek V3.2' },
            { id: 'deepseek-v4-flash', label: 'Deepseek V4 Flash' },
            { id: 'deepseek-v4-pro', label: 'Deepseek V4 Pro' },
            { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
            { id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' },
            { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
            { id: 'gemini-2.5-flash-thinking', label: 'Gemini 2.5 Flash Thinking' },
            { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
            { id: 'gemini-3-flash-preview-thinking', label: 'Gemini 3 Flash Preview Thinking' },
            { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
            { id: 'gemini-3.1-flash-lite-thinking', label: 'Gemini 3.1 Flash Lite Thinking' },
            { id: 'gemma-4-26b-a4b-it', label: 'Gemma 4 26B A4b IT' },
            { id: 'gemma-4-31b-it', label: 'Gemma 4 31B IT' },
            { id: 'glm-5.1', label: 'GLM 5.1' },
            { id: 'glm-5.2', label: 'GLM 5.2' },
            { id: 'gpt-3.5-turbo', label: 'GPT 3.5 Turbo' },
            { id: 'gpt-4.1', label: 'GPT 4.1' },
            { id: 'gpt-4.1-mini', label: 'GPT 4.1 Mini' },
            { id: 'gpt-4.1-nano', label: 'GPT 4.1 Nano' },
            { id: 'gpt-4o', label: 'GPT 4o' },
            { id: 'gpt-4o-mini', label: 'GPT 4o Mini' },
            { id: 'gpt-4o-mini-search-preview', label: 'GPT 4o Mini Search Preview' },
            { id: 'gpt-4o-search-preview', label: 'GPT 4o Search Preview' },
            { id: 'gpt-5', label: 'GPT 5' },
            { id: 'gpt-5-mini', label: 'GPT 5 Mini' },
            { id: 'gpt-5-nano', label: 'GPT 5 Nano' },
            { id: 'gpt-5-search-api', label: 'GPT 5 Search API' },
            { id: 'gpt-5.1', label: 'GPT 5.1' },
            { id: 'gpt-5.2', label: 'GPT 5.2' },
            { id: 'gpt-5.3-codex', label: 'GPT 5.3 Codex' },
            { id: 'gpt-5.4', label: 'GPT 5.4' },
            { id: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
            { id: 'gpt-5.4-nano', label: 'GPT 5.4 Nano' },
            { id: 'gpt-oss-120b', label: 'GPT Oss 120B' },
            { id: 'gpt-oss-20b', label: 'GPT Oss 20B' },
            { id: 'grok-4', label: 'Grok 4' },
            { id: 'grok-4-fast-non-reasoning', label: 'Grok 4 Fast Non Reasoning' },
            { id: 'grok-4-fast-reasoning', label: 'Grok 4 Fast Reasoning' },
            { id: 'grok-4.1-fast-non-reasoning', label: 'Grok 4.1 Fast Non Reasoning' },
            { id: 'grok-4.1-fast-reasoning', label: 'Grok 4.1 Fast Reasoning' },
            { id: 'grok-4.20-non-reasoning', label: 'Grok 4.20 Non Reasoning' },
            { id: 'grok-4.20-reasoning', label: 'Grok 4.20 Reasoning' },
            { id: 'grok-4.3', label: 'Grok 4.3' },
            { id: 'grok-code-fast-1', label: 'Grok Code Fast 1' },
            { id: 'hermes-4-405b', label: 'Hermes 4 405B' },
            { id: 'hermes-4-70b', label: 'Hermes 4 70B' },
            { id: 'kimi-k2.6', label: 'Kimi K2.6' },
            { id: 'kimi-k2.7-code', label: 'Kimi K2.7 Code' },
            { id: 'llama-3.1-8b-instruct', label: 'Llama 3.1 8B Instruct' },
            { id: 'llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct' },
            { id: 'magistral-medium-2509', label: 'Magistral Medium 2509' },
            { id: 'magistral-medium-latest', label: 'Magistral Medium Latest' },
            { id: 'magistral-small-2509', label: 'Magistral Small 2509' },
            { id: 'magistral-small-latest', label: 'Magistral Small Latest' },
            { id: 'mimo-v2.5', label: 'MIMO V2.5' },
            { id: 'mimo-v2.5-pro', label: 'MIMO V2.5 Pro' },
            { id: 'minimax-m2.7', label: 'Minimax M2.7' },
            { id: 'minimax-m3', label: 'Minimax M3' },
            { id: 'mistral-large-2512', label: 'Mistral Large 2512' },
            { id: 'mistral-large-latest', label: 'Mistral Large Latest' },
            { id: 'mistral-medium-2508', label: 'Mistral Medium 2508' },
            { id: 'mistral-medium-3-5', label: 'Mistral Medium 3 5' },
            { id: 'mistral-medium-latest', label: 'Mistral Medium Latest' },
            { id: 'mistral-small-2603', label: 'Mistral Small 2603' },
            { id: 'mistral-small-latest', label: 'Mistral Small Latest' },
            { id: 'nemotron-3-super', label: 'Nemotron 3 Super' },
            { id: 'o3', label: 'O3' },
            { id: 'o3-mini', label: 'O3 Mini' },
            { id: 'o4-mini', label: 'O4 Mini' },
            { id: 'qwen3.5-397b-a17b', label: 'Qwen3.5 397B A17b' },
            { id: 'sonar', label: 'Sonar' },
            { id: 'sonar-deep-research', label: 'Sonar Deep Research' },
            { id: 'sonar-pro', label: 'Sonar Pro' },
            { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro' },
        ],
    },
    ovh: {
        id: 'ovh',
        name: 'OVH AI Endpoints',
        chatUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
        apiKey: null,
        requiresApiKey: false,
        noNeedKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'Meta-Llama-3_3-70B-Instruct', label: 'Llama 3.3 70B' },
            { id: 'Mistral-7B-Instruct-v0.3', label: 'Mistral 7B Instruct v0.3' },
            { id: 'Mistral-Nemo-Instruct-2407', label: 'Mistral Nemo' },
            { id: 'Mistral-Small-3.2-24B-Instruct-2506', label: 'Mistral Small 3.2 24B' },
            { id: 'Qwen2.5-VL-72B-Instruct', label: 'Qwen2.5 VL 72B' },
            { id: 'Qwen3-32B', label: 'Qwen3 32B' },
            { id: 'Qwen3-Coder-30B-A3B-Instruct', label: 'Qwen3-Coder 30B' },
            { id: 'Qwen3.5-397B-A17B', label: 'Qwen3.5 397B' },
            { id: 'Qwen3.6-27B', label: 'Qwen3.6 27B' },
            { id: 'Qwen3Guard-Gen-0.6B', label: 'Qwen3Guard Gen 0.6B' },
            { id: 'Qwen3Guard-Gen-8B', label: 'Qwen3Guard Gen 8B' },
            { id: 'gpt-oss-120b', label: 'GPT-OSS 120B' },
            { id: 'gpt-oss-20b', label: 'GPT-OSS 20B' },
        ],
    },
    // FreeLLMAPI catalog platforms that need an API key (enabled after import/paste).
    ainative: {
        id: 'ainative',
        name: 'AINative Studio',
        chatUrl: 'https://api.ainative.studio/api/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'llama-4-maverick', label: 'Llama 4 Maverick' },
            { id: 'qwen3-14b', label: 'Qwen3 14B' },
            { id: 'qwen3-32b', label: 'Qwen3 32B' },
            { id: 'qwen3-8b', label: 'Qwen3 8B' },
        ],
    },
    aion: {
        id: 'aion',
        name: 'Aion Labs',
        chatUrl: 'https://api.aionlabs.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'aion-labs/aion-2.0', label: 'Aion 2.0' },
            { id: 'aion-labs/aion-2.5', label: 'Aion 2.5' },
            { id: 'aion-labs/aion-3.0', label: 'Aion 3.0' },
            { id: 'aion-labs/aion-3.0-mini', label: 'Aion 3.0 Mini' },
            { id: 'aion-labs/aion-rp-llama-3.1-8b', label: 'Aion-RP Llama 3.1 8B' },
        ],
    },
    bazaarlink: {
        id: 'bazaarlink',
        name: 'BazaarLink',
        chatUrl: 'https://bazaarlink.ai/api/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [{ id: 'auto:free', label: 'BazaarLink Auto (free router)' }],
    },
    cohere: {
        id: 'cohere',
        name: 'Cohere',
        chatUrl: 'https://api.cohere.ai/compatibility/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'c4ai-aya-expanse-32b', label: 'Aya Expanse 32B' },
            { id: 'command-a-plus-05-2026', label: 'Command A+ (05-2026)' },
            { id: 'north-mini-code-1-0', label: 'North Mini Code' },
        ],
    },
    github: {
        id: 'github',
        name: 'GitHub Models',
        chatUrl: 'https://models.github.ai/inference/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'gpt-4o', label: 'GPT-4o' },
            { id: 'openai/gpt-4.1', label: 'GPT-4.1' },
        ],
    },
    nara: {
        id: 'nara',
        name: 'NaraRouter',
        chatUrl: 'https://router.bynara.id/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'mistral-large', label: 'Mistral Large 3' },
            { id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5' },
        ],
    },
    openrouter: {
        id: 'openrouter',
        name: 'OpenRouter',
        chatUrl: 'https://openrouter.ai/api/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'cohere/north-mini-code:free', label: 'North Mini Code Free' },
            { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B Free' },
            { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B Free' },
            { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron Omni Reasoning Free' },
            { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Nemotron 3 Super Free' },
            { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra Free' },
            { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning Free' },
            { id: 'openrouter/free', label: 'OpenRouter Free' },
            { id: 'poolside/laguna-s-2.1:free', label: 'Laguna S 2.1 Free' },
            { id: 'poolside/laguna-xs-2.1:free', label: 'Laguna XS 2.1 Free' },
            { id: 'openai/gpt-oss-20b:free', label: 'GPT-OSS 20B Free' },
        ],
    },
    reka: {
        id: 'reka',
        name: 'Reka',
        chatUrl: 'https://api.reka.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'reka-edge-2603', label: 'Reka Edge' },
            { id: 'reka-flash', label: 'Reka Flash' },
        ],
    },
    requesty: {
        id: 'requesty',
        name: 'Requesty',
        chatUrl: 'https://router.requesty.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B' },
            { id: 'nvidia/nemotron-3-nano-30b-a3b', label: 'Nemotron 3 Nano 30B' },
            { id: 'nvidia/nemotron-3-super-120b-a12b', label: 'Nemotron 3 Super 120B' },
            { id: 'nvidia/nemotron-3-ultra-550b-a55b', label: 'Nemotron 3 Ultra 550B' },
            { id: 'nvidia/nemotron-3.5-content-safety', label: 'Nemotron 3.5 Content Safety' },
        ],
    },
    sealion: {
        id: 'sealion',
        name: 'SEA-LION',
        chatUrl: 'https://api.sea-lion.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'aisingapore/Gemma-SEA-LION-v4-27B-IT', label: 'Gemma SEA-LION v4 27B' },
            { id: 'aisingapore/Llama-SEA-LION-v3-70B-IT', label: 'Llama SEA-LION v3 70B' },
            { id: 'aisingapore/Qwen-SEA-LION-v4-32B-IT', label: 'Qwen SEA-LION v4 32B' },
            { id: 'aisingapore/Qwen-SEA-LION-v4.5-27B-IT', label: 'Qwen SEA-LION v4.5 27B' },
        ],
    },
    zhipu: {
        id: 'zhipu',
        name: 'Zhipu AI',
        chatUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'glm-4.5-flash', label: 'GLM-4.5 Flash' },
            { id: 'glm-4.6v-flash', label: 'GLM-4.6V Flash' },
            { id: 'glm-4.7-flash', label: 'GLM-4.7 Flash' },
        ],
    },
    huggingface: {
        id: 'huggingface',
        name: 'Hugging Face',
        chatUrl: 'https://router.huggingface.co/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'moonshotai/Kimi-K2.5', label: 'Kimi K2.5' },
            { id: 'Qwen/Qwen3-32B', label: 'Qwen3 32B' },
            { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
        ],
    },
    mistral: {
        id: 'mistral',
        name: 'Mistral',
        chatUrl: 'https://api.mistral.ai/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'mistral-small-latest', label: 'Mistral Small Latest' },
            { id: 'mistral-medium-latest', label: 'Mistral Medium Latest' },
            { id: 'mistral-large-latest', label: 'Mistral Large Latest' },
            { id: 'codestral-latest', label: 'Codestral Latest' },
            { id: 'mistral-code-agent-latest', label: 'Mistral Code Agent' },
        ],
    },
    siliconflow: {
        id: 'siliconflow',
        name: 'SiliconFlow',
        chatUrl: 'https://api.siliconflow.cn/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'deepseek-ai/DeepSeek-V4-Flash', label: 'DeepSeek V4 Flash' },
            { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3' },
            { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1' },
            { id: 'Qwen/Qwen3-32B', label: 'Qwen3 32B' },
            { id: 'moonshotai/Kimi-K2-Instruct', label: 'Kimi K2 Instruct' },
        ],
    },
    sensenova: {
        id: 'sensenova',
        name: 'SenseNova',
        chatUrl: 'https://api.sensenova.cn/compatible-mode/v1/chat/completions',
        apiKey: null,
        requiresApiKey: true,
        sourceLabel: 'FreeLLMAPI',
        models: [
            { id: 'SenseChat-5', label: 'SenseChat 5' },
            { id: 'SenseChat-Turbo', label: 'SenseChat Turbo' },
            { id: 'SenseNova-V6-5', label: 'SenseNova V6.5' },
        ],
    },
};

function zenFreeIds() {
    return ZEN_FREE.map((m) => m.id);
}

function isZenFree(modelId) {
    const id = String(modelId || '').toLowerCase().replace(/^opencode\//, '');
    return ZEN_FREE.some((m) => m.id.toLowerCase() === id);
}

function resolveZenModel(modelId) {
    const id = String(modelId || '').toLowerCase().replace(/^opencode\//, '');
    if (isZenFree(id)) {
        return ZEN_FREE.find((m) => m.id.toLowerCase() === id).id;
    }
    return DEFAULT_ZEN_MODEL;
}

function normalizeFreeLlmBase(url) {
    const raw = String(url || DEFAULT_FREELLMAPI_BASE).trim() || DEFAULT_FREELLMAPI_BASE;
    return raw.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

function entry(providerId, model, overrides) {
    const provider = PROVIDERS[providerId];
    const extra = overrides && typeof overrides === 'object' ? overrides : {};
    const requiresApiKey = Boolean(provider.requiresApiKey);
    const noNeedKey = Boolean(provider.noNeedKey) || !requiresApiKey;
    const apiKey = extra.apiKey !== undefined ? extra.apiKey : provider.apiKey;
    const hasApiKey = Boolean(apiKey);
    const tag = noNeedKey ? ' · NO NEED KEY' : (provider.sourceLabel ? ` · ${provider.sourceLabel}` : '');
    return {
        key: `${providerId}::${model.id}`,
        providerId,
        label: `${provider.name} / ${model.label}${tag}`,
        modelId: model.id,
        chatUrl: extra.chatUrl || provider.chatUrl,
        apiKey: apiKey || null,
        headers: provider.headers || undefined,
        requiresApiKey,
        noNeedKey,
        sourceLabel: provider.sourceLabel || null,
        hasApiKey: requiresApiKey ? hasApiKey : true,
        ready: requiresApiKey ? hasApiKey : true,
    };
}

function keyForProvider(providerId, keys) {
    const k = keys || {};
    if (providerId === 'zen') return k.opencode || ZEN_PUBLIC_KEY;
    if (providerId === 'freellmapi') return k.freellmapi || null;
    if (providerId === 'horde') return k.aihorde || k.horde || '0000000000';
    return k[providerId] || null;
}

function allModels(opts) {
    const keys = (opts && opts.keys) || {};
    const freeBase = normalizeFreeLlmBase(opts && opts.freeLlmApiBaseUrl);
    const out = [];
    Object.keys(PROVIDERS).forEach((providerId) => {
        const provider = PROVIDERS[providerId];
        const overrides = {};
        if (providerId === 'freellmapi') {
            overrides.chatUrl = `${freeBase}/chat/completions`;
        }
        if (providerId === 'zen') {
            overrides.apiKey = keyForProvider(providerId, keys) || ZEN_PUBLIC_KEY;
        } else if (provider.requiresApiKey || keys[providerId]) {
            const injected = keyForProvider(providerId, keys);
            if (injected) overrides.apiKey = injected;
        }
        provider.models.forEach((model) => {
            out.push(entry(providerId, model, overrides));
        });
    });
    return out;
}

/**
 * Kai: OpenCode Zen free ids and FreeLLMAPI NO NEED KEY providers always pass.
 * Keyed providers with a configured API key also pass.
 * Untested models pass only when minScore <= 0.
 */
function passesScoreGate(model, score, minScore) {
    if (model && model.requiresApiKey && !model.hasApiKey) {
        return false;
    }
    if (model && model.providerId === 'zen' && isZenFree(model.modelId)) {
        return true;
    }
    if (model && model.noNeedKey) {
        return true;
    }
    if (model && model.requiresApiKey && model.hasApiKey) {
        return true;
    }
    if (score == null || Number.isNaN(Number(score))) {
        return Number(minScore) <= 0;
    }
    return Number(score) >= Number(minScore);
}

function scoreOf(benchmarks, key) {
    const list = Array.isArray(benchmarks) ? benchmarks : [];
    const found = list.find((b) => b && b.modelKey === key);
    if (!found) return null;
    return Number(found.totalScore) || 0;
}

function eligibleModels(benchmarks, minScore, opts) {
    const threshold = Number.isFinite(Number(minScore)) ? Number(minScore) : DEFAULT_MIN_SCORE;
    return allModels(opts).filter((model) => passesScoreGate(model, scoreOf(benchmarks, model.key), threshold));
}

function rankSummaryCandidates(models, benchmarks, preferredKey) {
    const ranked = (models || []).slice().sort((a, b) => {
        const sa = scoreOf(benchmarks, a.key);
        const sb = scoreOf(benchmarks, b.key);
        const diff = (sb == null ? -1 : sb) - (sa == null ? -1 : sa);
        if (diff !== 0) return diff;
        return String(a.key).localeCompare(String(b.key));
    });
    if (!preferredKey || !ranked.some((m) => m.key === preferredKey)) return ranked;
    return ranked.filter((m) => m.key === preferredKey).concat(ranked.filter((m) => m.key !== preferredKey));
}

/**
 * Compact default roster used by older tests: two Zen seats plus one each
 * from Kilo, Pollinations, and OVH.
 */
function warRoster(maxSlots) {
    const cap = Math.max(2, Math.min(Number(maxSlots) || 5, 5));
    const zenSeats = ZEN_FREE.slice(0, 2).map((m) => entry('zen', m));
    const others = [
        entry('kilo', PROVIDERS.kilo.models[0]),
        entry('pollinations', PROVIDERS.pollinations.models[0]),
        entry('ovh', PROVIDERS.ovh.models.find((m) => m.id === 'gpt-oss-20b')),
    ];
    return zenSeats.concat(others).slice(0, cap);
}

function singleSelectableModels(opts) {
    return allModels(opts).filter((m) => m.ready);
}

module.exports = {
    ZEN_PUBLIC_KEY,
    ZEN_CHAT_URL,
    ZEN_FREE,
    DEFAULT_ZEN_MODEL,
    DEFAULT_MIN_SCORE,
    DEFAULT_FREELLMAPI_BASE,
    NVIDIA_MODELS,
    FREELLMAPI_MODELS,
    PROVIDERS,
    zenFreeIds,
    isZenFree,
    resolveZenModel,
    normalizeFreeLlmBase,
    entry,
    allModels,
    passesScoreGate,
    scoreOf,
    eligibleModels,
    rankSummaryCandidates,
    warRoster,
    singleSelectableModels,
};
