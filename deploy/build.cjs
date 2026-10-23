const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const [directory, args] of [
  ['deploy', ['ci']], ['backend', ['ci', '--include=dev']], ['backend', ['run', 'build']],
  ['frontend', ['ci', '--include=dev']], ['frontend', ['run', 'build']],
]) {
  const result = spawnSync(npm, args, { cwd: path.join(root, directory), stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, NEXT_PUBLIC_BACKEND_URL: '', NEXT_TELEMETRY_DISABLED: '1' } });
  if (result.status !== 0) process.exit(result.status || 1);
}
