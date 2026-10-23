const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 10000);
const backendPort = Number(process.env.INTERNAL_BACKEND_PORT || 5001);
const frontendPort = Number(process.env.INTERNAL_FRONTEND_PORT || 3001);
if (![port, backendPort, frontendPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535) || new Set([port, backendPort, frontendPort]).size !== 3) {
  throw new Error('PORT and internal service ports must be valid and distinct.');
}
const origin = process.env.RENDER_EXTERNAL_URL || process.env.DEMO_PUBLIC_URL || 'http://localhost:' + port;
const backend = 'http://127.0.0.1:' + backendPort;
const frontend = 'http://127.0.0.1:' + frontendPort;
const env = { ...process.env, NODE_ENV: 'production', CLIENT_URL: origin, PUBLIC_BACKEND_URL: origin, NEXT_PUBLIC_BACKEND_URL: '', NEXT_TELEMETRY_DISABLED: '1' };
if (process.env.RENDER && (!process.env.ADMIN_PASSWORD || !process.env.BOT_TOKEN_ENCRYPTION_KEY)) {
  throw new Error('Set ADMIN_PASSWORD and a stable BOT_TOKEN_ENCRYPTION_KEY in Render Environment.');
}
const children = [];
let stopping = false;
let ready = false;
const { server, proxy } = require('./gateway.cjs')({ backend, frontend, isReady: () => ready });
function stop(code = 0) {
  if (stopping) return;
  stopping = true; ready = false;
  for (const child of children) child.kill('SIGTERM');
  server.close(); proxy.close();
  const timer = setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 5000);
  Promise.all(children.map(child => new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)))).then(() => { clearTimeout(timer); process.exit(code); });
}
function launch(script, args, directory, childEnv) {
  const child = spawn(process.execPath, [script, ...args], { cwd: path.join(root, directory), env: childEnv, stdio: 'inherit' });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(directory + ' stopped (' + code + ')'); stop(1); } });
}
server.on('error', error => { console.error('[Gateway] HTTP listener failed:', error.message); stop(1); });
server.listen(port, '0.0.0.0', async () => {
  console.log('[Gateway] Listening on 0.0.0.0:' + port + ' (public HTTP), backend=' + backendPort + ', frontend=' + frontendPort);
  launch('dist/index.js', [], 'backend', { ...env, PORT: String(backendPort) });
  launch('node_modules/next/dist/bin/next', ['start', '-p', String(frontendPort), '-H', '127.0.0.1'], 'frontend', { ...env, PORT: String(frontendPort) });
  const deadline = Date.now() + 120000;
  while (!stopping && Date.now() < deadline) {
    try {
      const responses = await Promise.all([fetch(backend + '/health', { signal: AbortSignal.timeout(3000) }), fetch(frontend + '/login', { signal: AbortSignal.timeout(3000) })]);
      if (responses.every(response => response.ok)) { ready = true; console.log('Demo ready on ' + origin); return; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!stopping) { console.error('Application readiness timeout'); stop(1); }
});
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
