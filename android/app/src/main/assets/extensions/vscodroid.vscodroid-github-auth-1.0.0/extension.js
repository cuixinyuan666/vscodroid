// VSCodroid GitHub Authentication Extension
// Routes GitHub OAuth through Android Custom Tabs + deep link callback.
//
// Flow:
// 1. VS Code requests GitHub auth → this extension activates
// 2. Extension builds GitHub OAuth URL with client_id + state
// 3. Calls AndroidBridge.startGitHubAuth(url) via BroadcastChannel
// 4. Android opens Chrome Custom Tabs → user authenticates
// 5. GitHub redirects to vscodroid://oauth/github?code=...&state=...
// 6. MainActivity.handleOAuthCallback() forwards to window.__vscodroid.onOAuthCallback
// 7. Extension receives callback, exchanges code for token via GitHub API
// 8. Returns token to VS Code's auth system

const vscode = require('vscode');

// GitHub OAuth App credentials
// TODO: Replace with actual GitHub OAuth App client ID after registration
// Register at: https://github.com/settings/developers
// Authorization callback URL: vscodroid://oauth/github
const GITHUB_CLIENT_ID = 'YOUR_GITHUB_CLIENT_ID';
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';

class VSCodroidGitHubAuthProvider {
    constructor() {
        this._onDidChangeSessions = new vscode.EventEmitter();
        this.onDidChangeSessions = this._onDidChangeSessions.event;
        this._sessions = [];
        this._pendingAuth = null;
    }

    async getSessions(scopes) {
        return this._sessions.filter(session => {
            if (!scopes || scopes.length === 0) return true;
            return scopes.every(scope => session.scopes.includes(scope));
        });
    }

    async createSession(scopes) {
        const state = generateNonce();
        const scopeString = (scopes || ['user:email', 'repo']).join(',');

        const authUrl = `${GITHUB_AUTH_URL}?client_id=${GITHUB_CLIENT_ID}&scope=${encodeURIComponent(scopeString)}&state=${state}&redirect_uri=${encodeURIComponent('vscodroid://oauth/github')}`;

        // Create a promise that resolves when the OAuth callback is received
        const callbackPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('GitHub authentication timed out'));
            }, 120000); // 2 minute timeout

            const cleanup = () => {
                clearTimeout(timeout);
                if (typeof window !== 'undefined' && window.__vscodroid) {
                    window.__vscodroid.onOAuthCallback = null;
                }
            };

            // Register callback handler
            if (typeof window !== 'undefined') {
                window.__vscodroid = window.__vscodroid || {};
                window.__vscodroid.onOAuthCallback = (code, returnedState) => {
                    cleanup();
                    if (returnedState !== state) {
                        reject(new Error('OAuth state mismatch — possible CSRF'));
                        return;
                    }
                    resolve(code);
                };
            }
        });

        // Initiate OAuth via AndroidBridge (opens Chrome Custom Tabs)
        try {
            const ch = new BroadcastChannel('vscodroid-bridge');
            ch.postMessage({ cmd: 'startGitHubAuth', url: authUrl, id: state });
        } catch (e) {
            // Fallback: try direct AndroidBridge access
            if (typeof AndroidBridge !== 'undefined') {
                const token = (window.__vscodroid || {}).authToken;
                if (token) {
                    AndroidBridge.startGitHubAuth(authUrl, token);
                }
            }
        }

        // Wait for callback
        const code = await callbackPromise;

        // NOTE: Token exchange requires a server-side component or a proxy
        // because GitHub's token endpoint requires client_secret which must
        // not be embedded in the client. Options:
        // 1. Use a lightweight proxy (e.g., Cloudflare Worker)
        // 2. Use GitHub's Device Flow (doesn't need client_secret)
        // For now, we store the authorization code as the token.
        // A proper implementation would exchange it server-side.

        const session = {
            id: generateNonce(),
            accessToken: code, // TODO: Exchange for access token via proxy
            account: {
                id: 'github-user',
                label: 'GitHub User'
            },
            scopes: scopes || ['user:email', 'repo']
        };

        this._sessions.push(session);
        this._onDidChangeSessions.fire({
            added: [session],
            removed: [],
            changed: []
        });

        return session;
    }

    async removeSession(sessionId) {
        const index = this._sessions.findIndex(s => s.id === sessionId);
        if (index >= 0) {
            const [removed] = this._sessions.splice(index, 1);
            this._onDidChangeSessions.fire({
                added: [],
                removed: [removed],
                changed: []
            });
        }
    }

    dispose() {
        this._onDidChangeSessions.dispose();
    }
}

function generateNonce() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 32; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function activate(context) {
    const provider = new VSCodroidGitHubAuthProvider();
    const disposable = vscode.authentication.registerAuthenticationProvider(
        'github',
        'GitHub',
        provider,
        { supportsMultipleAccounts: false }
    );
    context.subscriptions.push(disposable);
    context.subscriptions.push(provider);
}

function deactivate() { }

module.exports = { activate, deactivate };
