'use strict';

/**
 * Read API keys from Kai desktop encrypted settings (~/.kai/settings.aes).
 * Format: AES-256-GCM, 12-byte IV prefix, 16-byte auth tag suffix.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const keysUtil = require('./keys');

const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

function kaiHomeDir() {
    return path.join(os.homedir(), '.kai');
}

function decryptSettingsMap(kaiDir) {
    const dir = kaiDir || kaiHomeDir();
    const keyPath = path.join(dir, 'settings.key');
    const aesPath = path.join(dir, 'settings.aes');
    if (!fs.existsSync(keyPath) || !fs.existsSync(aesPath)) {
        return null;
    }
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) {
        throw new Error('settings.key must be 32 bytes');
    }
    const buf = fs.readFileSync(aesPath);
    if (buf.length <= GCM_IV_LENGTH + GCM_TAG_LENGTH) {
        throw new Error('settings.aes too short');
    }
    const iv = buf.subarray(0, GCM_IV_LENGTH);
    const rest = buf.subarray(GCM_IV_LENGTH);
    const tag = rest.subarray(rest.length - GCM_TAG_LENGTH);
    const ciphertext = rest.subarray(0, rest.length - GCM_TAG_LENGTH);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(plain);
}

/**
 * Build a Kai-export-like payload from the decrypted settings map so
 * keysUtil.parseKeysPayload can normalize provider ids.
 */
function mapToImportPayload(map) {
    const settingsMap = map && typeof map === 'object' ? map : {};
    const instanceSettings = [];
    Object.keys(settingsMap).forEach((k) => {
        const m = /^instance_(.+)_api_key$/i.exec(k);
        if (!m) return;
        const instanceId = m[1];
        const apiKey = String(settingsMap[k] || '').trim();
        if (!apiKey || apiKey.toLowerCase().startsWith('freellmapi')) return;
        const row = { instanceId, api_key: apiKey };
        const base = settingsMap[`instance_${instanceId}_base_url`];
        if (typeof base === 'string' && base.trim()) row.base_url = base.trim();
        instanceSettings.push(row);
    });
    return {
        configured_services: settingsMap.configured_services || '[]',
        instance_settings: instanceSettings,
    };
}

function importKeysFromKaiDesktop(kaiDir) {
    const map = decryptSettingsMap(kaiDir);
    if (!map) {
        return { keys: keysUtil.emptyKeys(), freeLlmApiBaseUrl: '', count: 0, found: false };
    }
    const payload = mapToImportPayload(map);
    const parsed = keysUtil.parseKeysPayload(payload);
    const count = Object.values(parsed.keys).filter(Boolean).length;
    return {
        keys: parsed.keys,
        freeLlmApiBaseUrl: parsed.freeLlmApiBaseUrl,
        count,
        found: true,
        providers: Object.keys(parsed.keys).filter((k) => parsed.keys[k]),
    };
}

module.exports = {
    kaiHomeDir,
    decryptSettingsMap,
    mapToImportPayload,
    importKeysFromKaiDesktop,
};
