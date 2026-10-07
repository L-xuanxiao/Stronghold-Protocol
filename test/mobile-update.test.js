import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { selectRelease, lockFromRelease, resolveCommit } from '../mobile/ci/check-upstream.mjs';

const asset = { name: 'Stronghold-Protocol-v0.1.3.zip', size: 300,
  digest: `sha256:${'a'.repeat(64)}`, browser_download_url: 'https://github.com/sganggs/Stronghold-Protocol/releases/download/v0.1.3/Stronghold-Protocol-v0.1.3.zip' };
const release = { tag_name: 'v0.1.3', assets: [asset] };

test('updater selects newer official semantic versions only', () => {
  const releases = [{ ...release, tag_name: 'v0.1.10' }, release, { ...release, tag_name: 'v0.2.0', prerelease: true },
    { ...release, tag_name: 'v9.0.0', draft: true }, { ...release, tag_name: 'mobile-latest' }];
  assert.equal(selectRelease(releases, '0.1.2').tag_name, 'v0.1.10');
  assert.equal(selectRelease(releases, '0.1.10'), null);
});

test('updater never accepts missing hashes or foreign release assets', () => {
  const good = lockFromRelease(release, 'b'.repeat(40), 'sganggs/Stronghold-Protocol');
  assert.equal(good.assetArchive.sha256, 'a'.repeat(64));
  assert.equal(good.version, '0.1.3');
  for (const change of [{ digest: null }, { browser_download_url: 'http://github.com/a.zip' },
    { browser_download_url: 'https://example.com/a.zip' }, { browser_download_url: 'https://github.com/evil/repo/releases/download/v1/a.zip' }]) {
    assert.throws(() => lockFromRelease({ ...release, assets: [{ ...asset, ...change }] }, 'b'.repeat(40), 'sganggs/Stronghold-Protocol'));
  }
  assert.throws(() => lockFromRelease(release, 'short', 'sganggs/Stronghold-Protocol'));
});

test('updater resolves lightweight and annotated tags, rejecting non-commit targets', async () => {
  const sha = 'c'.repeat(40);
  assert.equal(await resolveCommit(async () => ({ object: { type: 'commit', sha } }), 'x/y', 'v1.0.0'), sha);
  let calls = 0;
  assert.equal(await resolveCommit(async () => (++calls === 1 ? { object: { type: 'tag', sha: 'd'.repeat(40) } } :
    { object: { type: 'commit', sha } }), 'x/y', 'v1.0.0'), sha);
  await assert.rejects(resolveCommit(async () => ({ object: { type: 'blob', sha } }), 'x/y', 'v1.0.0'));
});

test('master 同步仅将已知工作流权限限制降为警告，其他失败仍返回错误', (t) => {
  const gitPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  const bash = process.platform === 'win32' ? path.resolve(gitPath, '../../../bin/bash.exe') : 'bash';
  if (spawnSync(bash, ['--version'], { windowsHide: true }).status !== 0) return t.skip('没有 Bash；云端 Ubuntu 会执行本检查');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const yaml = readFileSync(path.join(root, '.github/workflows/android-candidate.yml'), 'utf8');
  const script = yaml.match(/ {8}run: \|\r?\n([\s\S]*?)\r?\n {2}check:/)[1].replace(/^ {10}/gm, '');
  const mock = 'gh() { printf "%s\\n" "$TASK_SYNC_OUTPUT"; return "$TASK_SYNC_EXIT"; }\n';
  for (const [exit, output, expected, warning] of [
    [0, 'synced', 0, false],
    [1, 'Upstream commits contain workflow changes, which require the workflow scope', 0, true],
    [1, 'HTTP 401: bad credentials', 1, false],
    [1, 'destination branch has diverged', 1, false],
  ]) {
    const result = spawnSync(bash, ['-c', mock + script], { encoding: 'utf8', windowsHide: true,
      env: { ...process.env, GITHUB_REPOSITORY: 'example/fork', TASK_SYNC_EXIT: String(exit), TASK_SYNC_OUTPUT: output } });
    assert.equal(result.status, expected, result.stderr);
    assert.equal(result.stdout.includes('::warning'), warning, result.stdout);
  }
});
