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
 */

const http = require('http');
const net = require('net');
const { URL } = require('url');

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
    return new Promise((resolve) => {
        let settled = false;
        const done = (env) => {
            if (!settled) {
                settled = true;
                resolve(env);
            }
        };

        const server = http.createServer((req, res) => {
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
                log('warn', `dns-proxy: ${target.hostname} failed: ${err.message}`);
                res.writeHead(502).end();
            });
            req.pipe(upstream);
        });

        // CONNECT: open a tunnel and stay out of the bytes. Resolution of `host`
        // happens in this process, which is the whole point.
        server.on('connect', (req, clientSocket, head) => {
            const [host, rawPort] = req.url.split(':');
            const upstream = net.connect(Number(rawPort) || 443, host, () => {
                clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
                if (head && head.length) {
                    upstream.write(head);
                }
                upstream.pipe(clientSocket);
                clientSocket.pipe(upstream);
            });
            upstream.on('error', (err) => {
                log('warn', `dns-proxy: CONNECT ${host} failed: ${err.message}`);
                clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
            });
            clientSocket.on('error', () => upstream.destroy());
        });

        server.on('error', (err) => {
            log('warn', `dns-proxy: not started (${err.message}); musl clients will not resolve names`);
            done({});
        });

        // Port 0: the kernel picks a free one and the child is told which. No
        // fixed port to collide with, and nothing to persist between launches.
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            const url = `http://127.0.0.1:${port}`;
            log('info', `dns-proxy listening on ${url}`);
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
