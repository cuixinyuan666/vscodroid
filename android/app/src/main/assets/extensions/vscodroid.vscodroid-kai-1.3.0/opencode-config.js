'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

const CONFIG_REL = path.join('.config', 'opencode', 'opencode.json');

function configPath(homeDir) {
    return path.join(homeDir, CONFIG_REL);
}

/**
 * Fill Zen public auth and the selected free model. Existing provider API keys
 * are left alone. The model id is updated because the Kai panel is choosing it.
 */
function mergeOpenCodeConfig(existing, zenModel) {
    const next = existing && typeof existing === 'object' && !Array.isArray(existing)
        ? JSON.parse(JSON.stringify(existing))
        : {};
    if (!next.provider || typeof next.provider !== 'object') {
        next.provider = {};
    }
    if (!next.provider.opencode || typeof next.provider.opencode !== 'object') {
        next.provider.opencode = {};
    }
    if (!next.provider.opencode.options || typeof next.provider.opencode.options !== 'object') {
        next.provider.opencode.options = {};
    }
    const opts = next.provider.opencode.options;
    if (!opts.apiKey) {
        opts.apiKey = catalog.ZEN_PUBLIC_KEY;
    }
    next.model = `opencode/${catalog.resolveZenModel(zenModel)}`;
    return next;
}

function readJsonFile(filePath, readFile) {
    const read = readFile || ((p) => fs.readFileSync(p, 'utf8'));
    try {
        return JSON.parse(read(filePath));
    } catch (_e) {
        return null;
    }
}

function writeMergedOpenCodeConfig(homeDir, zenModel, io) {
    const readFile = (io && io.readFile) || ((p) => fs.readFileSync(p, 'utf8'));
    const writeFile = (io && io.writeFile) || ((p, t) => fs.writeFileSync(p, t));
    const mkdir = (io && io.mkdir) || ((p) => fs.mkdirSync(p, { recursive: true }));
    const exists = (io && io.exists) || ((p) => fs.existsSync(p));
    const file = configPath(homeDir);
    mkdir(path.dirname(file));
    const existing = exists(file) ? readJsonFile(file, readFile) : null;
    const merged = mergeOpenCodeConfig(existing, zenModel);
    writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
    return merged;
}

module.exports = {
    CONFIG_REL,
    configPath,
    mergeOpenCodeConfig,
    writeMergedOpenCodeConfig,
};
