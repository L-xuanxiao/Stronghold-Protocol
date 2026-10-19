#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function evaluateCompression({ baselineBytes, compressedBytes, baselineMs, compressedMs, before, after }) {
  const median = values => {
    if (values.length !== 3 || values.some(value => !Number.isFinite(value) || value <= 0)) throw new Error('exactly three positive launch timings required');
    return [...values].sort((a, b) => a - b)[1];
  };
  if (![baselineBytes, compressedBytes].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('positive APK sizes required');
  const baselineMedianMs = median(baselineMs), compressedMedianMs = median(compressedMs);
  const reduction = 1 - compressedBytes / baselineBytes;
  if (reduction < 0.1 - Number.EPSILON) throw new Error(`APK reduction ${(reduction * 100).toFixed(2)}% is below 10%`);
  if (compressedMedianMs > baselineMedianMs * 1.2) throw new Error('compressed first launch exceeds 120% of baseline');
  if (!before?.id || !/^[a-f0-9]{64}$/.test(before.marker) || !/^\d+:\d+:64$/.test(before.stat)
      || before.id !== after?.id || before.marker !== after.marker || before.stat !== after.stat) {
    throw new Error('same bundle was re-extracted during upgrade or marker evidence is missing');
  }
  return { reduction, baselineMedianMs, compressedMedianMs, launchRatio: compressedMedianMs / baselineMedianMs };
}
async function main() {
  const [baselineApk, compressedApk, baselinePhone, compressedPhone] = process.argv.slice(2);
  if (!compressedPhone) throw new Error('usage: compression-benchmark.mjs <baseline-debug> <compressed-debug> <baseline-arm64> <compressed-arm64>');
  const output = path.resolve('mobile/build/qa'), runs = [], baselineMs = [], compressedMs = [];
  const archives = JSON.parse(await fs.readFile(path.join(output, 'compression-archives.json'), 'utf8'));
  // 交错顺序削弱宿主负载和磁盘缓存偏差，最后保留 baseline 数据用于覆盖升级。
  const order = ['baseline', 'compressed', 'baseline', 'compressed', 'compressed', 'baseline', 'upgrade'];
  try {
    for (const variant of order) {
      const index = runs.filter(run => run.variant === variant).length + 1;
      const directory = path.join(output, `compression-${variant}-${index}`);
      const result = spawnSync(process.execPath, ['mobile/ci/emulator-smoke.mjs', variant === 'baseline' ? baselineApk : compressedApk], {
        stdio: 'inherit', timeout: 720000, windowsHide: true, env: { ...process.env,
          SMOKE_OUTPUT: directory, SMOKE_KEEP_DATA: variant === 'upgrade' ? '1' : '0',
          SMOKE_SEED_SETTINGS: variant === 'baseline' && index === 3 ? '1' : '0' },
      });
      if (result.status !== 0) throw new Error(`${variant} launch ${index} failed: ${result.error || result.status}`);
      const smoke = JSON.parse(await fs.readFile(path.join(directory, 'smoke.json'), 'utf8'));
      runs.push({ variant, index, ...smoke });
      if (variant === 'baseline') baselineMs.push(smoke.launchToLobbyMs);
      if (variant === 'compressed') compressedMs.push(smoke.launchToLobbyMs);
    }
    const baselineBytes = (await fs.stat(baselinePhone)).size, compressedBytes = (await fs.stat(compressedPhone)).size;
    const baselineBundle = runs.find(run => run.variant === 'baseline' && run.index === 3).bundle;
    if (baselineBundle?.id !== archives.bundleId || baselineBundle?.marker !== archives.manifestSha256) throw new Error('installed bundle differs from the compared archive manifest');
    const buildSeconds = {};
    for (const name of ['prepare', 'baseline-arm64-build', 'compressed-arm64-build', 'baseline-x86-build', 'compressed-x86-build']) {
      buildSeconds[name] = Number((await fs.readFile(path.join(output, `${name}-seconds.txt`), 'utf8')).trim());
      if (!Number.isFinite(buildSeconds[name]) || buildSeconds[name] <= 0) throw new Error(`invalid build timing: ${name}`);
    }
    const acceptance = evaluateCompression({ baselineBytes, compressedBytes, baselineMs, compressedMs,
      before: baselineBundle,
      after: runs.at(-1).bundle });
    await fs.writeFile(path.join(output, 'compression-benchmark.json'), JSON.stringify({ passed: true, archives, buildSeconds, baselineBytes, compressedBytes,
      baselineMs, compressedMs, acceptance, runs }, null, 2) + '\n');
    console.log(JSON.stringify(acceptance, null, 2));
  } catch (error) {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(path.join(output, 'compression-benchmark.json'), JSON.stringify({ passed: false, error: error.message, runs }, null, 2) + '\n');
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
