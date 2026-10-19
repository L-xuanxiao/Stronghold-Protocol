import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BASELINE_COMMIT, prepareCompressionBaseline, requireCompressionBaseline } from '../mobile/ci/compression-prepare.mjs';
import { evaluateCompression } from '../mobile/ci/compression-benchmark.mjs';
import { sha256, writeZip } from '../mobile/tools/archive.mjs';

const bundle = { id: 'game-0.3.1-test', marker: 'a'.repeat(64), stat: '100:1000:64' };
const sample = { baselineBytes: 1000, compressedBytes: 900, baselineMs: [100, 300, 200], compressedMs: [240, 120, 360], before: bundle, after: { ...bundle } };

test('compression gate uses three-run medians and inclusive 10% / 20% thresholds', () => {
  assert.deepEqual(evaluateCompression(sample), { reduction: 1 - 0.9, baselineMedianMs: 200, compressedMedianMs: 240, launchRatio: 1.2 });
  assert.throws(() => evaluateCompression({ ...sample, compressedBytes: 901 }), /below 10%/);
  assert.throws(() => evaluateCompression({ ...sample, compressedMs: [241, 121, 361] }), /120%/);
  for (const values of [[], [100], [0, 100, 200], [NaN, 100, 200]]) {
    assert.throws(() => evaluateCompression({ ...sample, baselineMs: values }), /three positive/);
  }
  assert.throws(() => evaluateCompression({ ...sample, baselineBytes: 0 }), /positive APK/);
});

test('upgrade gate detects re-extraction, changed bundle and missing marker evidence', () => {
  for (const change of [{ id: 'different' }, { marker: 'b'.repeat(64) }, { stat: '101:1000:64' }, { stat: '100:1001:64' }]) {
    assert.throws(() => evaluateCompression({ ...sample, after: { ...bundle, ...change } }), /re-extracted/);
  }
  assert.throws(() => evaluateCompression({ ...sample, before: undefined }), /marker evidence/);
});

test('benchmark refuses a newer game or mismatched content identity', () => {
  const lock = { version: '0.3.1', tag: 'v0.3.1', commit: BASELINE_COMMIT };
  const files = [{ path: 'empty', size: 0, sha256: sha256('') }];
  const manifest = { gameVersion: lock.version, upstreamCommit: lock.commit, files,
    bundleId: `game-${lock.version}-${sha256(JSON.stringify(files)).slice(0, 24)}` };
  requireCompressionBaseline(lock, manifest);
  for (const change of [{ version: '0.3.2' }, { tag: 'v0.3.2' }, { commit: 'a'.repeat(40) }]) {
    assert.throws(() => requireCompressionBaseline({ ...lock, ...change }, manifest), /locked v0.3.1/);
  }
  assert.throws(() => requireCompressionBaseline(lock, { ...manifest, bundleId: 'game-other' }), /bundleId/);
});

test('independent full archive comparison verifies paths, CRC, SHA256 and compression method', async t => {
  const original = process.cwd();
  const fixtureRoot = path.join(original, '.cache/test-compression');
  await fs.mkdir(fixtureRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(fixtureRoot, 'fixture-'));
  t.after(async () => { process.chdir(original); await fs.rm(directory, { recursive: true, force: true }); });
  const game = path.join(directory, 'mobile/build/game'), assets = path.join(directory, 'mobile/build/assets');
  await fs.mkdir(game, { recursive: true }); await fs.mkdir(assets, { recursive: true });
  const content = { '中文.txt': Buffer.from('compress me '.repeat(80)), empty: Buffer.alloc(0), binary: Buffer.from([0, 1, 254, 255]) };
  const files = [];
  for (const name of Object.keys(content).sort()) {
    await fs.writeFile(path.join(game, name), content[name]);
    files.push({ path: name, size: content[name].length, sha256: sha256(content[name]) });
  }
  const lock = { version: '0.3.1', tag: 'v0.3.1', commit: BASELINE_COMMIT };
  const manifest = { gameVersion: lock.version, upstreamCommit: lock.commit, files,
    bundleId: `game-${lock.version}-${sha256(JSON.stringify(files)).slice(0, 24)}` };
  await fs.writeFile(path.join(assets, 'game-manifest.json'), JSON.stringify(manifest));
  for (const name of ['game', 'runtime', 'fonts']) await fs.writeFile(path.join(directory, `mobile/${name}.lock.json`), JSON.stringify(lock));
  await writeZip(game, path.join(assets, 'game.zip'), { compress: true });
  await fs.writeFile(path.join(directory, 'mobile/build/phone-build.json'), JSON.stringify({ game: { archiveMs: 50 } }));
  process.chdir(directory);
  await prepareCompressionBaseline();
  const report = JSON.parse(await fs.readFile('mobile/build/qa/compression-archives.json', 'utf8'));
  assert.equal(report.bundleId, manifest.bundleId); assert.equal(report.files, 3); assert.equal(report.compressedArchiveMs, 50);
  assert.ok(report.archives.compressed.bytes < report.archives.baseline.bytes);
  const sameManifest = await fs.readFile('mobile/build/compression-baseline/game-manifest.json');
  assert.deepEqual(sameManifest, await fs.readFile('mobile/build/assets/game-manifest.json'));
  await writeZip(game, path.join(assets, 'game.zip'));
  await assert.rejects(prepareCompressionBaseline(), /wrong compression method/);
  await fs.writeFile(path.join(game, 'binary'), Buffer.from([0, 2, 254, 255]));
  await writeZip(game, path.join(assets, 'game.zip'), { compress: true });
  await assert.rejects(prepareCompressionBaseline(), /archive content changed/);
});

test('extra A/B builds are manual-only and share APK inputs and signing identity', async () => {
  const yaml = await fs.readFile(new URL('../.github/workflows/android-candidate.yml', import.meta.url), 'utf8').then(text => text.replace(/\r/g, ''));
  assert.match(yaml, /compression_benchmark:\s+description:[^\n]+\s+type: boolean\s+default: false/);
  assert.match(yaml, /COMPRESSION_BENCHMARK: \$\{\{ github.event_name == 'workflow_dispatch' && inputs.compression_benchmark \}\}/);
  assert.match(yaml, /inputs.use_locked_game \|\| inputs.compression_benchmark/);
  for (const step of ['Prepare identical STORE compression baseline', 'Build unsigned STORE phone baseline', 'Build STORE emulator baseline']) {
    assert.ok(yaml.includes(`- name: ${step}\n        if: env.COMPRESSION_BENCHMARK == 'true'`));
  }
  assert.equal((yaml.match(/keytool -genkeypair/g) || []).length, 1);
  assert.match(yaml, /script: \$\{\{ env.COMPRESSION_BENCHMARK == 'true' && 'node mobile\/ci\/compression-benchmark.mjs[^\n]+\|\| 'node mobile\/ci\/emulator-smoke.mjs/);
  assert.match(yaml, /sign:\s+needs: \[check, build\]/);
});
