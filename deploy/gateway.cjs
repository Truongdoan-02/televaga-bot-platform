const http = require('node:http');
const httpProxy = require('http-proxy');
module.exports = function createGateway({ backend, frontend, isReady }) {
const proxy = httpProxy.createProxyServer({ ws: true });
proxy.on('error', (_error, _req, response) => {
  if (response && typeof response.writeHead === 'function' && !response.headersSent) {
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: false, error: 'Service temporarily unavailable' }));
  } else response?.destroy();
});
const isBackend = url => /^\/(api|uploads|socket\.io|webhook)(\/|\?|$)/.test(url);
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(isReady() ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: isReady() ? 'ok' : 'starting' })); return;
  }
  if (!isReady()) { res.writeHead(503, { 'Retry-After': '5' }); res.end('Application starting'); return; }
  proxy.web(req, res, { target: isBackend(req.url || '/') ? backend : frontend });
});
server.on('upgrade', (req, socket, head) => {
  if (!isReady() || !req.url?.startsWith('/socket.io/')) { socket.destroy(); return; }
  proxy.ws(req, socket, head, { target: backend });
});
return { server, proxy };
};
