/**
 * A loopback proxy that exists to give musl clients working DNS.
 *
 * The Claude Code CLI is a musl binary, and musl resolves names by reading
 * /etc/resolv.conf. Android has no such file and no writable /etc -- name
 * resolution there lives in Bionic, behind netd. So the CLI resolves nothing:
 * measured on an API 36 emulator, getaddrinfo("api.anthropic.com") fails with
 * EAI_AGAIN from a musl binary while the identical call from a Bionic one
 * returns an address, and a raw TCP connect to a literal address succeeds from
 * both. DNS is the only broken part.
 *
 * This process is Node, so it is Bionic, so its DNS works. Pointing the CLI at
 * 127.0.0.1 through HTTPS_PROXY means it only ever dials a literal address and
 * never resolves anything; the name is resolved here instead. With the proxy in
 * place the same CLI reaches api.anthropic.com and gets a real HTTP 401 back
 * from an invalid key, where without it every attempt failed with no status at
 * all and retried until it gave up.
 *
 * Both proxy shapes are implemented because HTTPS_PROXY is exported to the whole
 * server process, and VS Code's own proxy resolver reads it too: CONNECT for
 * TLS, plain forwarding for anything still on http. Node's own http/https
 * modules ignore these variables, so extension code written against them is
 * unaffected either way.
 *
 * Binding to 127.0.0.1 is not access control on Android. Loopback is not
 * per-app isolated -- any installed app can connect to another app's loopback
 * port -- so an unauthenticated forwarder here is reachable by every app on the
 * device, and would let any of them make arbitrary outbound connections that
 * appear to come from VSCodroid. The random port only raises the cost of
 * finding it. Hence Basic proxy auth with a token minted per boot: the
 * credentials ride in the proxy URL, which is how every standard proxy client
 * already learns them, so nothing downstream needs to know this exists.
 */

const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * AggregateError -- what a failed Happy Eyeballs connect throws -- carries an
 * empty message, so the reason survives only in `errors`.
 *
 * @param {Error & {errors?: Error[]}} err
 * @returns {string}
 */
function reason(err) {
    return err.errors ? err.errors.map((e) => e.message).join('; ') : err.message;
}

/**
 * Binds the proxy and resolves with the environment the child should inherit.
 *
 * Never rejects. A proxy that cannot bind must not take the workbench down with
 * it, so failure resolves to an empty environment and everything simply talks
 * directly -- which is what the Bionic side wanted anyway; only musl clients
 * lose out.
 *
 * @param {(level: string, message: string) => void} log
 * @returns {Promise<Record<string, string>>}
 */
function start(log) {
    // Node gives each address 250ms before it abandons that attempt and tries
    // the next family. api.anthropic.com handshakes in 227-500ms from here and
    // the IPv6 route is absent (EHOSTUNREACH), so the default lost roughly
    // three connects in five -- reported as an AggregateError whose message is
    // the empty string, which is why the warnings below could only ever say
    // "failed: ". Widening the window costs nothing when the first address
    // answers promptly. Process-wide on purpose: the plain-HTTP path here and
    // every other outbound connect in this process share the exposure.
    net.setDefaultAutoSelectFamilyAttemptTimeout(1000);

    // Minted per boot and never persisted: a token that outlived the process
    // would be a credential on disk for a proxy that no longer exists.
    //
    // Hex, and it has to stay hex or something equally URL-inert. The token
    // travels inside a URL's userinfo, and every client that reads it back runs
    // it through decodeURIComponent first -- https-proxy-agent/dist/index.js:102
    // and http-proxy-agent/dist/index.js:82 both do. A '%' from some shorter
    // encoding would either be silently rewritten or throw URIError there,
    // which surfaces here as an inexplicable 407 in a client we do not own.
    const token = crypto.randomBytes(32).toString('hex');
    const expected = crypto
        .createHash('sha256')
        .update(Buffer.from(`vscodroid:${token}`).toString('base64'))
        .digest();

    /**
     * Matches the scheme case-insensitively and compares only the credentials.
     *
     * RFC 7235 makes the auth-scheme case-insensitive and Node passes the
     * header through exactly as it arrived -- measured: "basic QUJD" stays
     * "basic QUJD". Comparing the whole header string would therefore reject a
     * conforming client over nothing but its capitalisation, and the client
     * likeliest to be caught by that is the Claude Code CLI: a third-party
     * binary this project does not bundle and cannot inspect, whose failure
     * would look like an inexplicable 407.
     *
     * Digests before comparing so both buffers are always 32 bytes;
     * timingSafeEqual throws outright on a length mismatch, which would turn a
     * malformed header into a crash and leak the expected length besides.
     *
     * A duplicated header cannot be used to smuggle a second attempt past this:
     * proxy-authorization is one of the headers Node keeps the first of and
     * discards the rest -- also measured.
     *
     * @param {import('http').IncomingMessage} req
     * @returns {boolean}
     */
    function authorized(req) {
        const given = req.headers['proxy-authorization'];
        if (typeof given !== 'string') {
            return false;
        }
        const credentials = /^basic[ \t]+([A-Za-z0-9+/=]+)[ \t]*$/i.exec(given);
        if (!credentials) {
            return false;
        }
        return crypto.timingSafeEqual(crypto.createHash('sha256').update(credentials[1]).digest(), expected);
    }

    const CHALLENGE = 'Basic realm="vscodroid"';

    return new Promise((resolve) => {
        let settled = false;
        const done = (env) => {
            if (!settled) {
                settled = true;
                resolve(env);
            }
        };

        const server = http.createServer((req, res) => {
            if (!authorized(req)) {
                // No upstream leg exists yet, so there is nothing to tear down
                // -- but an unhandled 'error' on either stream is still fatal,
                // and a client that walked away before reading the 407 raises
                // one here.
                req.on('error', () => {});
                res.on('error', () => {});
                res.writeHead(407, { 'Proxy-Authenticate': CHALLENGE }).end();
                return;
            }
            // Hop-by-hop by definition: the credential authenticates the client
            // to this proxy and means nothing to the origin server. Forwarding
            // it would hand this device's token to every host the CLI dials.
            delete req.headers['proxy-authorization'];

            // Plain HTTP: the request line carries an absolute URI.
            let target;
            try {
                target = new URL(req.url);
            } catch {
                res.writeHead(400).end();
                return;
            }
            const upstream = http.request(
                {
                    host: target.hostname,
                    port: target.port || 80,
                    method: req.method,
                    path: target.pathname + target.search,
                    headers: req.headers,
                },
                (upstreamRes) => {
                    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
                    upstreamRes.pipe(res);
                },
            );
            upstream.on('error', (err) => {
                log('warn', `dns-proxy: ${target.hostname} failed: ${reason(err)}`);
                // An upstream that dies mid-response has already had its status
                // relayed; writeHead would then throw ERR_HTTP_HEADERS_SENT,
                // and an uncaught throw here takes the whole bootstrap down and
                // orphans the forked server on its port.
                if (!res.headersSent) {
                    res.writeHead(502);
                }
                res.end();
            });
            // A client that vanishes mid-transfer must tear down the upstream
            // leg, not surface as an unhandled 'error' -- same contract as the
            // CONNECT handler below.
            req.on('error', () => upstream.destroy());
            res.on('error', () => upstream.destroy());
            req.pipe(upstream);
        });

        // CONNECT: open a tunnel and stay out of the bytes. Resolution of `host`
        // happens in this process, which is the whole point.
        server.on('connect', (req, clientSocket, head) => {
            // Registered before the first thing that can fail: a 407 written to
            // a client that has already walked away emits EPIPE here, and an
            // uncaught 'error' on a socket takes the whole bootstrap down.
            let upstream = null;
            clientSocket.on('error', () => upstream && upstream.destroy());

            if (!authorized(req)) {
                // "Connection: close" is load-bearing, not decoration. git does
                // not send Basic preemptively -- http.proxyAuthMethod defaults
                // to anyauth, which means "expect a 407 first" -- so it answers
                // this challenge by retrying the CONNECT on the same socket.
                // end() has already sent FIN, and without this header the
                // client is entitled to think the connection is still reusable;
                // the retry lands on a dead socket and git reports "Proxy
                // CONNECT aborted" with nothing pointing at a proxy token.
                // Measured: adding this one header is what makes git work, and
                // Content-Length: 0 in its place does not.
                //
                // The plain-HTTP 407 above needs no equivalent: it goes through
                // Node's own response framing, which keeps that connection
                // alive for the retry.
                clientSocket.end(
                    `HTTP/1.1 407 Proxy Authentication Required\r\n` +
                        `Proxy-Authenticate: ${CHALLENGE}\r\n` +
                        `Connection: close\r\n\r\n`,
                );
                return;
            }

            const [host, rawPort] = req.url.split(':');
            upstream = net.connect(Number(rawPort) || 443, host, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head && head.length) {
                    upstream.write(head);
                }
                upstream.pipe(clientSocket);
                clientSocket.pipe(upstream);
            });
            upstream.on('error', (err) => {
                log('warn', `dns-proxy: CONNECT ${host} failed: ${reason(err)}`);
                clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            });
        });

        server.on('error', (err) => {
            log('warn', `dns-proxy: not started (${err.message}); musl clients will not resolve names`);
            done({});
        });

        // Port 0: the kernel picks a free one and the child is told which. No
        // fixed port to collide with, and nothing to persist between launches.
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            // The log line is deliberately the credential-free form: this goes
            // to logcat and to the workbench output channel, both readable well
            // outside the process that owns the token.
            log('info', `dns-proxy listening on http://127.0.0.1:${port}`);
            const url = `http://vscodroid:${token}@127.0.0.1:${port}`;
            done({
                HTTP_PROXY: url,
                HTTPS_PROXY: url,
                http_proxy: url,
                https_proxy: url,
                // Loopback needs no resolution and must not come back through
                // here -- the workbench itself, and any MCP server a user runs
                // locally, are reached by address already.
                NO_PROXY: 'localhost,127.0.0.1,::1',
                no_proxy: 'localhost,127.0.0.1,::1',
            });
        });

        server.unref();
    });
}

module.exports = { start };
