import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyPackage, verifyPromotion, allocateVersionCode } from '../mobile/ci/candidate-policy.mjs';

test('versionCode allocation exceeds archived candidates even after a branch rollback', () => {
  assert.equal(allocateVersionCode(1, 2, [{ tag_name: 'android-v0.1.3-200003' }, { tag_name: 'v0.1.4' }]), 200004);
  assert.equal(allocateVersionCode(100010, 2, []), 100011);
  assert.throws(() => allocateVersionCode(1, 2, [{ tag_name: 'android-v0.1.3-2100000000' }]), /overflow/);
});

test('candidate actual manifest and release tag agree; published version codes cannot regress', () => {
  const metadata = { game: { version: '0.1.2' }, mobile: { applicationId: 'io.github.strongholdprotocol.mobile', versionCode: 12 } };
  const badging = "package: name='io.github.strongholdprotocol.mobile' versionCode='12' versionName='0.1.2-android.12' platformBuildVersionName=''";
  verifyPackage(metadata, badging, 'android-v0.1.2-12');
  assert.throws(() => verifyPackage(metadata, badging, 'android-v0.1.2-13'), /metadata does not match/);
  assert.throws(() => verifyPackage(metadata, badging.replace("versionCode='12'", "versionCode='11'"), 'android-v0.1.2-12'), /actual APK/);
  assert.throws(() => verifyPackage(metadata, badging.replace('protocol.mobile', 'protocol.other'), 'android-v0.1.2-12'), /actual APK/);
  assert.throws(() => verifyPackage(metadata, badging.replace('android.12', 'android.11'), 'android-v0.1.2-12'), /actual APK/);
  const draft = { tag_name: 'android-v0.1.2-12', draft: true, prerelease: false };
  verifyPromotion([draft, { tag_name: 'android-v0.1.1-11', draft: false }], draft.tag_name);
  assert.throws(() => verifyPromotion([draft, { tag_name: 'android-v0.1.3-13', draft: false }], draft.tag_name), /must exceed/);
  assert.throws(() => verifyPromotion([{ ...draft, draft: false }], draft.tag_name), /existing draft/);
});

test('candidate promotion rejects changed bytes, certificate identity and checksum record', async t => {
  const temp = path.resolve('.cache/mobile/tests');
  await fs.mkdir(temp, { recursive: true });
  const directory = await fs.mkdtemp(path.join(temp, 'candidate-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const apk = path.join(directory, 'candidate.apk');
  const bytes = Buffer.from('not a real apk: these negative controls must fail before signature validation');
  const signing = JSON.parse(await fs.readFile('mobile/signing.json', 'utf8'));
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const good = { schema: 1, certificateSha256: signing.certificateSha256,
    mobile: { applicationId: signing.applicationId }, sha256: checksum, size: bytes.length };
  await fs.writeFile(apk, bytes);
  const run = () => spawnSync(process.execPath, ['mobile/ci/verify-candidate.mjs', directory], { encoding: 'utf8' });
  for (const [change, checksumText, expected] of [
    [{ sha256: '0'.repeat(64) }, `${checksum}  candidate.apk\n`, /candidate bytes changed/],
    [{ certificateSha256: '0'.repeat(64) }, `${checksum}  candidate.apk\n`, /candidate identity changed/],
    [{}, `${checksum}  different-name.apk\n`, /checksum file mismatch/],
  ]) {
    await fs.writeFile(`${apk}.json`, JSON.stringify({ ...good, ...change }));
    await fs.writeFile(`${apk}.sha256`, checksumText);
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, expected);
  }
});
