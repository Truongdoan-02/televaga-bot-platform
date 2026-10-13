const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const root = path.resolve(__dirname, '..');
const env = dotenv.parse(fs.readFileSync(path.join(root, '.env.cloud')));
const backup = path.join(root, 'data/backups');
const stateFile = path.join(backup, 'render-service.json');
const repo = 'https://github.com/Truongdoan-02/televaga-bot-platform';
const branch = 'deploy/free-render-demo';
const name = 'televaga-demo';
async function request(endpoint, method = 'GET', body) {
  const response = await fetch('https://api.render.com/v1' + endpoint, { method, signal: AbortSignal.timeout(60000), headers: { Authorization: 'Bearer ' + env.RENDER_API_KEY, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) { fs.writeFileSync(path.join(backup, 'render-error.json'), JSON.stringify(result, null, 2), { mode: 0o600 }); throw new Error('Render API HTTP ' + response.status + '. Details saved privately to backend/data/backups/render-error.json'); }
  return result;
}
function save(service, ownerId) {
  const state = { id: service.id, ownerId, name: service.name, url: service.serviceDetails?.url, dashboardUrl: service.dashboardUrl, branch: service.branch };
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(state));
}
async function main() {
  if (!env.RENDER_API_KEY) throw new Error('Fill RENDER_API_KEY in backend/.env.cloud first.');
  if (process.argv[2] === 'status') {
    if (!fs.existsSync(stateFile)) throw new Error('No recorded Render service.');
    const state = JSON.parse(fs.readFileSync(stateFile));
    const service = await request('/services/' + encodeURIComponent(state.id));
    console.log(JSON.stringify({ id: service.id, url: service.serviceDetails?.url, suspended: service.suspended, plan: service.serviceDetails?.plan }));
    const deploys = await request('/services/' + encodeURIComponent(state.id) + '/deploys?limit=3');
    console.log(JSON.stringify(deploys.map(item => ({ id: item.deploy.id, status: item.deploy.status, createdAt: item.deploy.createdAt }))));
    return;
  }
  const owners = (await request('/owners?limit=100')).map(item => item.owner);
  const owner = env.RENDER_OWNER_ID ? owners.find(item => item.id === env.RENDER_OWNER_ID) : owners.length === 1 ? owners[0] : null;
  if (!owner) { console.log(JSON.stringify(owners.map(item => ({ id: item.id, name: item.name })))); throw new Error('Select RENDER_OWNER_ID in backend/.env.cloud.'); }
  console.log('Render workspace: ' + owner.name);
  if (process.argv[2] !== 'create') return;
  const existing = (await request('/services?ownerId=' + encodeURIComponent(owner.id) + '&name=' + encodeURIComponent(name) + '&limit=100')).map(item => item.service).filter(item => item.name === name);
  if (existing.length) {
    const service = existing[0];
    if (service.repo?.replace(/\.git$/, '') !== repo || service.branch !== branch || service.serviceDetails?.plan !== 'free') throw new Error('Existing service differs from prepared demo. Refusing to change it.');
    save(service, owner.id); console.log('Existing matching Free service retained.'); return;
  }
  const values = dotenv.parse(fs.readFileSync(path.join(backup, 'render.env')));
  delete values.RENDER_API_KEY; delete values.RENDER_OWNER_ID; delete values.DB_SSL_CA_FILE;
  for (const key of ['DB_HOST','DB_PASSWORD','DB_SSL_CA','BOT_TOKEN_ENCRYPTION_KEY','ADMIN_PASSWORD']) if (!values[key]) throw new Error('Missing required service environment: ' + key);
  const result = await request('/services', 'POST', {
    type: 'web_service', name, ownerId: owner.id, repo, branch, autoDeployTrigger: 'off',
    envVars: Object.entries(values).map(([key, value]) => ({ key, value })),
    serviceDetails: { runtime: 'node', plan: 'free', region: 'singapore', numInstances: 1, healthCheckPath: '/health', envSpecificDetails: { buildCommand: 'node deploy/build.cjs', startCommand: 'node deploy/server.cjs' } },
  });
  const service = result.service || result;
  if (!service.id) throw new Error('Service creation response did not contain an ID. Inspect dashboard before retrying.');
  save(service, owner.id);
  console.log('Free service created. Initial deployment requested.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
