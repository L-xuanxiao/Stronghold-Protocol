import test from 'node:test';
import assert from 'node:assert/strict';
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
