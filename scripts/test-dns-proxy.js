/**
 * Self-check for the loopback DNS proxy's authentication.
 *
 * Runs anywhere Node runs -- dns-proxy.js is plain Node with no Android
 * dependency -- so the auth logic is provable before anything is pushed to a
 * device. Device testing still matters, but for the other half of the claim:
 * that real clients (the Claude Code CLI, Copilot) read the credentials out of
 * the proxy URL and send them. This file proves the proxy's side of that
 * contract.
 *
 *   node scripts/test-dns-proxy.js
 */

const assert = require('assert');
const http = require('http');
const net = require('net');
const { URL } = require('url');

const { start } = require('../android/app/src/main/assets/dns-proxy.js');

const logLines = [];
const log = (level, message) => logLines.push(`${level}: ${message}`);

/** Listens and resolves with the bound port. */
function listen(server) {
    return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/** An origin server that reports back exactly which headers reached it. */
function originServer() {
    return http.createServer((req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(req.headers));
    });
}

/** Speaks the proxy protocol over a raw socket and returns everything it said. */
function rawExchange(port, request) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
        let received = '';
        socket.on('data', (chunk) => {
            received += chunk;
            // A tunnel stays open after its 200; the response head is all we
            // need, so stop as soon as the headers are terminated.
            if (received.includes('\r\n\r\n')) {
                socket.destroy();
                resolve(received);
            }
        });
        socket.on('error', reject);
        socket.on('close', () => resolve(received));
    });
}

/**
 * Like rawExchange, but lets the server close the connection instead of
 * destroying it at the first CRLFCRLF. That distinction is the whole point of
 * the Connection: close test below -- reading the header text only proves the
 * proxy claimed it would close, not that it did.
 */
function rawExchangeUntilClose(port, request) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
        let received = '';
        let sawFin = false;
        socket.on('data', (chunk) => (received += chunk));
        socket.on('end', () => (sawFin = true));
        socket.on('error', reject);
        socket.on('close', () => resolve({ received, sawFin }));
        // A tunnel that stays open would hang this forever; fail loudly instead.
        socket.setTimeout(3000, () => {
            socket.destroy();
            resolve({ received, sawFin });
        });
    });
}

/** Issues a proxied GET with the Proxy-Authorization header set verbatim. */
function proxiedGetRaw(proxyPort, targetUrl, headerValue) {
    return new Promise((resolve, reject) => {
        const headers = headerValue === '' ? {} : { 'proxy-authorization': headerValue };
        const req = http.request({ host: '127.0.0.1', port: proxyPort, path: targetUrl, headers, agent: false }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode }));
        });
        req.on('error', reject);
        req.end();
    });
}

/** Issues a proxied plain-HTTP GET, optionally authenticated. */
function proxiedGet(proxyPort, targetUrl, credentials) {
    return new Promise((resolve, reject) => {
        const headers = {};
        if (credentials) {
            headers['proxy-authorization'] = `Basic ${Buffer.from(credentials).toString('base64')}`;
        }
        const req = http.request({ host: '127.0.0.1', port: proxyPort, path: targetUrl, headers, agent: false }, (res) => {
            let body = '';
            res.on('data', (chunk) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
        req.on('error', reject);
        req.end();
    });
}

async function main() {
    const env = await start(log);
    assert.ok(env.HTTPS_PROXY, 'proxy failed to bind; nothing else here is meaningful');

    const proxy = new URL(env.HTTPS_PROXY);
    const proxyPort = Number(proxy.port);
    const goodCredentials = `${proxy.username}:${decodeURIComponent(proxy.password)}`;

    const origin = originServer();
    const originPort = await listen(origin);
    const echo = net.createServer((socket) => socket.pipe(socket));
    const echoPort = await listen(echo);

    // The four env vars must agree; a client that reads http_proxy and one that
    // reads HTTPS_PROXY have to end up at the same credentials.
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']) {
        assert.strictEqual(env[key], env.HTTPS_PROXY, `${key} disagrees with HTTPS_PROXY`);
    }
    assert.ok(proxy.username && proxy.password, 'proxy URL carries no credentials');

    // --- plain HTTP -------------------------------------------------------
    const anonymous = await proxiedGet(proxyPort, `http://127.0.0.1:${originPort}/`);
    assert.strictEqual(anonymous.status, 407, 'unauthenticated HTTP was not rejected');
    assert.match(anonymous.headers['proxy-authenticate'] || '', /^Basic /, 'no Basic challenge on 407');

    const wrongToken = await proxiedGet(proxyPort, `http://127.0.0.1:${originPort}/`, 'vscodroid:not-the-token');
    assert.strictEqual(wrongToken.status, 407, 'a wrong token was accepted');

    const authenticated = await proxiedGet(proxyPort, `http://127.0.0.1:${originPort}/`, goodCredentials);
    assert.strictEqual(authenticated.status, 200, 'a correct token was rejected');

    // RFC 7235 makes the scheme case-insensitive. A client that sends "basic"
    // is conforming, and the one binary here that cannot be inspected -- the
    // Claude Code CLI -- is exactly where that would surface as a mystery 407.
    const lowercased = await rawExchange(
        proxyPort,
        `GET http://127.0.0.1:${originPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\n` +
            `proxy-authorization: basic ${Buffer.from(goodCredentials).toString('base64')}\r\n\r\n`,
    );
    assert.match(lowercased, /^HTTP\/1\.1 200 /, `a lowercase "basic" scheme was rejected: ${lowercased}`);

    // Node keeps the first proxy-authorization header and discards the rest, so
    // a junk header cannot be used to shadow a valid one appended after it.
    const duplicated = await rawExchange(
        proxyPort,
        `GET http://127.0.0.1:${originPort}/ HTTP/1.1\r\nHost: 127.0.0.1:${originPort}\r\n` +
            `Proxy-Authorization: Basic ${Buffer.from('vscodroid:wrong').toString('base64')}\r\n` +
            `Proxy-Authorization: Basic ${Buffer.from(goodCredentials).toString('base64')}\r\n\r\n`,
    );
    assert.match(duplicated, /^HTTP\/1\.1 407 /, `a duplicated header slipped a bad credential through: ${duplicated}`);

    // A header that is not Basic at all must not reach timingSafeEqual.
    for (const malformed of ['', 'Basic', 'Bearer abc', 'Basic !!!!', 'Basic']) {
        const rejected = await proxiedGetRaw(proxyPort, `http://127.0.0.1:${originPort}/`, malformed);
        assert.strictEqual(rejected.status, 407, `malformed credential "${malformed}" was not rejected`);
    }

    // The credential authenticates the client to the proxy and must not travel
    // any further; forwarding it would hand the device's token to every origin.
    const seenByOrigin = JSON.parse(authenticated.body);
    assert.ok(
        !('proxy-authorization' in seenByOrigin),
        'the proxy leaked Proxy-Authorization upstream: ' + JSON.stringify(seenByOrigin),
    );

    // --- CONNECT ----------------------------------------------------------
    const connectHead = `CONNECT 127.0.0.1:${echoPort} HTTP/1.1\r\nHost: 127.0.0.1:${echoPort}\r\n`;

    const anonymousTunnel = await rawExchange(proxyPort, `${connectHead}\r\n`);
    assert.match(anonymousTunnel, /^HTTP\/1\.1 407 /, `unauthenticated CONNECT was not rejected: ${anonymousTunnel}`);
    assert.match(anonymousTunnel, /Proxy-Authenticate: Basic /, 'no Basic challenge on the CONNECT 407');

    // git does not send Basic preemptively: http.proxyAuthMethod defaults to
    // anyauth, so it expects the 407 and retries the CONNECT. Because the
    // challenge is written with end(), the socket is already closing, and
    // without this header the client retries onto a dead socket and reports
    // "Proxy CONNECT aborted" -- an error that names neither the proxy nor the
    // token. Every client that authenticates preemptively passes the tests
    // above whether or not this header is present, so this assertion is the
    // only thing standing between git-over-HTTPS and a silent regression.
    assert.match(
        anonymousTunnel,
        /Connection: close/i,
        `the CONNECT 407 omits "Connection: close"; challenge-response clients such as git will abort: ${anonymousTunnel}`,
    );

    const badTunnel = await rawExchange(
        proxyPort,
        `${connectHead}Proxy-Authorization: Basic ${Buffer.from('vscodroid:wrong').toString('base64')}\r\n\r\n`,
    );
    assert.match(badTunnel, /^HTTP\/1\.1 407 /, 'a wrong token opened a tunnel');

    const goodTunnel = await rawExchange(
        proxyPort,
        `${connectHead}Proxy-Authorization: Basic ${Buffer.from(goodCredentials).toString('base64')}\r\n\r\n`,
    );
    assert.match(goodTunnel, /^HTTP\/1\.1 200 /, `a correct token was refused a tunnel: ${goodTunnel}`);

    // The header text above only proves the proxy said it would close. This
    // proves it did: a challenge-response client retries on this connection, and
    // if the FIN never arrives it waits on a socket that is already gone.
    const closed = await rawExchangeUntilClose(proxyPort, `${connectHead}\r\n`);
    assert.match(closed.received, /^HTTP\/1\.1 407 /, 'unauthenticated CONNECT was not rejected');
    assert.ok(closed.sawFin, 'the proxy announced Connection: close but never closed the connection');

    // --- IPv6 literals ----------------------------------------------------
    // "[::1]:443".split(':') yields ["[", "", "1]", "443"], so the pre-parser
    // form dialled a host named "[". Skipped where the loopback has no IPv6.
    const echo6 = net.createServer((socket) => socket.pipe(socket));
    const echo6Port = await new Promise((resolve) => {
        echo6.once('error', () => resolve(null));
        echo6.listen(0, '::1', () => resolve(echo6.address().port));
    });
    if (echo6Port) {
        const tunnel6 = await rawExchange(
            proxyPort,
            `CONNECT [::1]:${echo6Port} HTTP/1.1\r\nHost: [::1]:${echo6Port}\r\n` +
                `Proxy-Authorization: Basic ${Buffer.from(goodCredentials).toString('base64')}\r\n\r\n`,
        );
        assert.match(tunnel6, /^HTTP\/1\.1 200 /, `an IPv6 CONNECT target was refused: ${tunnel6}`);
        echo6.close();
    } else {
        console.log('note -- no IPv6 loopback here, skipped the IPv6 CONNECT case');
    }

    // A port outside the valid range used to reach net.connect and throw
    // ERR_SOCKET_BAD_PORT synchronously, which took the whole bootstrap down.
    const badPort = await rawExchange(
        proxyPort,
        `CONNECT example.com:99999999 HTTP/1.1\r\nHost: example.com\r\n` +
            `Proxy-Authorization: Basic ${Buffer.from(goodCredentials).toString('base64')}\r\n\r\n`,
    );
    assert.match(badPort, /^HTTP\/1\.1 400 /, `a malformed CONNECT target was not rejected: ${badPort}`);

    // --- a client that walks away mid-flight ------------------------------
    // The error listeners in both handlers exist so an aborted client cannot
    // raise an unhandled 'error' and kill the bootstrap. Nothing exercised them.
    await new Promise((resolve) => {
        const socket = net.connect(proxyPort, '127.0.0.1', () => {
            socket.write(`${connectHead}Proxy-Authorization: Basic ${Buffer.from(goodCredentials).toString('base64')}\r\n\r\n`);
            socket.destroy();
            resolve();
        });
        socket.on('error', resolve);
    });
    await new Promise((resolve) => {
        const socket = net.connect(proxyPort, '127.0.0.1', () => {
            socket.write(`GET http://127.0.0.1:${originPort}/ HTTP/1.1\r\nHost: x\r\n\r\n`);
            socket.destroy();
            resolve();
        });
        socket.on('error', resolve);
    });
    // If either abort had killed the proxy, this would not answer.
    const stillAlive = await proxiedGet(proxyPort, `http://127.0.0.1:${originPort}/`, goodCredentials);
    assert.strictEqual(stillAlive.status, 200, 'the proxy died after a client aborted mid-request');

    // --- the token must not escape into any log ---------------------------
    const secret = decodeURIComponent(proxy.password);
    for (const line of logLines) {
        assert.ok(!line.includes(secret), `the token reached the log: ${line}`);
    }

    origin.close();
    echo.close();
    console.log(`ok -- ${logLines.length} log line(s), none carrying the token`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
