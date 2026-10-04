import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const entry = fileURLToPath(new URL('../mobile/node/main.mjs', import.meta.url));

function launch(args) {
  const child = spawn(process.execPath, [entry, `--root=${root}`, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  return { child, output: () => output };
}

test('mobile entry rejects open host and malformed startup arguments', async () => {
  for (const args of [ ['--nonce=test', '--host=::'], ['--nonce=test', '--port=-1'], ['--nonce=test', '--port=1', '--port=2'], [] ]) {
    const { child, output } = launch(args);
    const [code] = await once(child, 'exit');
    assert.equal(code, 1);
    assert.match(output(), /SP_ERROR/);
    assert.doesNotMatch(output(), /SP_READY/);
  }
});

test('mobile entry reports readiness only after listening and stops cleanly', { timeout: 20000 }, async t => {
  const { child, output } = launch(['--nonce=integration-test', '--port=0']);
  t.after(() => { if (child.exitCode == null) child.kill(); });
  const ready = await new Promise((resolve, reject) => {
    child.on('exit', code => reject(new Error(`exited ${code}: ${output()}`)));
    child.stdout.on('data', () => {
      const line = output().split('\n').find(line => line.startsWith('SP_READY '));
      if (line) resolve(JSON.parse(line.slice(9)));
    });
  });
  assert.equal(ready.nonce, 'integration-test');
  assert.equal(ready.pid, child.pid);
  const health = await fetch(`http://127.0.0.1:${ready.port}/healthz`).then(response => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.app, ready.app);
  assert.equal((await fetch(`http://127.0.0.1:${ready.port}/`)).status, 200);
  child.kill('SIGTERM');
  await once(child, 'exit');
  await assert.rejects(fetch(`http://127.0.0.1:${ready.port}/healthz`));
});
