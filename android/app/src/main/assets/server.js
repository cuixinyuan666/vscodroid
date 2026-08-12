#!/usr/bin/env node
/**
 * VSCodroid Server Bootstrap
 * Launches VS Code Server (vscode-reh) with VSCodroid configuration.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');

// Parse command-line arguments
const args = {};
process.argv.slice(2).forEach(arg => {
    const [key, value] = arg.split('=');
    args[key.replace(/^--/, '')] = value || true;
});

const HOST = args.host || '127.0.0.1';
const PORT = parseInt(args.port) || 13337;
const LOG_LEVEL = args.log || 'info';

const HOME_DIR = process.env.HOME || '/data/data/com.vscodroid/files/home';
const SERVER_DIR = path.dirname(__filename);
const REH_DIR = path.join(SERVER_DIR, 'vscode-reh');

// Product configuration override — port-dependent fields set at runtime below
const productOverrides = {
    nameShort: 'VSCodroid',
    nameLong: 'VSCodroid',
    applicationName: 'vscodroid',
    dataFolderName: '.vscodroid',
    quality: 'stable',
    extensionsGallery: {
        serviceUrl: 'https://open-vsx.org/vscode/gallery',
        itemUrl: 'https://open-vsx.org/vscode/item',
        resourceUrlTemplate: 'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
        controlUrl: '',
        nlsBaseUrl: ''
    },
    linkProtectionTrustedDomains: ['https://open-vsx.org'],
    telemetryOptIn: false,
    enableTelemetry: false
    // CDN URLs (webEndpointUrl, webviewContentExternalBaseUrlTemplate) are hardcoded
    // in workbench.js and cannot be overridden via product.json. The Android WebView
    // intercepts *.vscode-cdn.net requests and redirects them to localhost instead.
};

function log(level, message) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    if (levels[level] <= levels[LOG_LEVEL]) {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level}] ${message}`);
    }
}

// Check if vscode-reh exists
const rehEntryPoint = path.join(REH_DIR, 'out', 'server-main.js');
if (!fs.existsSync(rehEntryPoint)) {
    log('warn', `vscode-reh entry point not found at ${rehEntryPoint}`);
    log('info', 'Starting minimal health-check server (VS Code not yet built)');

    // Minimal server for development/testing
    const server = http.createServer((req, res) => {
        if (req.url === '/healthz') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
            return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <!DOCTYPE html>
            <html>
            <head><title>VSCodroid</title></head>
            <body style="background:#1e1e1e;color:#ccc;font-family:monospace;padding:40px;text-align:center;">
                <h1>VSCodroid</h1>
                <p>Server is running, but VS Code is not yet built.</p>
                <p>Run: <code>./scripts/build-vscode.sh && ./scripts/package-assets.sh</code></p>
                <p style="color:#666;">Node.js ${process.version} on ${process.platform} ${process.arch}</p>
            </body>
            </html>
        `);
    });

    server.listen(PORT, HOST, () => {
        log('info', `Minimal server listening on http://${HOST}:${PORT}`);
    });
} else {
    // Launch VS Code Server
    log('info', `Starting VS Code Server on http://${HOST}:${PORT}`);

    // Inject product overrides
    process.env.VSCODE_NLS_CONFIG = JSON.stringify({ locale: 'en', availableLanguages: {} });

    // Override product.json
    const productJsonPath = path.join(REH_DIR, 'product.json');
    if (fs.existsSync(productJsonPath)) {
        const product = JSON.parse(fs.readFileSync(productJsonPath, 'utf8'));
        Object.assign(product, productOverrides);
        fs.writeFileSync(productJsonPath, JSON.stringify(product, null, 2));
        log('info', 'Product configuration updated');
    }

    // Build server arguments
    const serverArgs = [
        rehEntryPoint,
        '--host', HOST,
        '--port', String(PORT),
        '--without-connection-token',
        '--accept-server-license-terms',
        // Without this every folder opens in Restricted Mode, which blocks most
        // extensions from activating.
        //
        // The security.workspace.trust.enabled setting cannot do it. That setting
        // is registered with ConfigurationScope.APPLICATION, and an
        // application-scoped setting is not read from the remote side — our
        // settings.json lives in the server's user-data-dir, which is exactly the
        // side it is ignored from. It has therefore never had any effect here,
        // despite being written since the first release.
        // isWorkspaceTrustEnabled() checks environmentService.disableWorkspaceTrust
        // before it consults the configuration at all, so the flag is the only
        // route that works, and webClientServer passes it through to the web
        // client as enableWorkspaceTrust.
        //
        // Deliberate trade-off, not an oversight: the default workspace is the
        // user's own projects directory inside the app sandbox, where a trust
        // prompt asks about files they created themselves on their own device.
        // The exposure this accepts is a folder opened through the SAF picker
        // from somewhere else, whose tasks.json can then run unprompted. Worth
        // revisiting if opening external repositories becomes a normal thing to
        // do here.
        '--disable-workspace-trust',
        '--log', LOG_LEVEL
    ];

    // Forward relevant CLI args
    ['extensions-dir', 'user-data-dir', 'server-data-dir', 'logsPath'].forEach(key => {
        if (args[key]) serverArgs.push(`--${key}`, args[key]);
    });

    // Launch server
    const { fork } = require('child_process');
    const server = fork(serverArgs[0], serverArgs.slice(1), {
        env: process.env,
        stdio: 'inherit'
    });

    // Start process monitor (non-fatal if it fails)
    try {
        const monitor = require(path.join(SERVER_DIR, 'process-monitor.js'));
        monitor.start(server.pid);
    } catch (e) {
        log('warn', 'Process monitor failed to start: ' + e.message);
    }

    server.on('error', (err) => {
        log('error', `Failed to start VS Code Server: ${err.message}`);
        process.exit(1);
    });

    server.on('exit', (code) => {
        log('info', `VS Code Server exited with code ${code}`);
        process.exit(code || 0);
    });

    process.on('SIGTERM', () => {
        log('info', 'Received SIGTERM, shutting down...');
        server.kill('SIGTERM');
    });
}
