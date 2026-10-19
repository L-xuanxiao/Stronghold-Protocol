#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeZip, hashFile, sha256 } from '../tools/archive.mjs';

export const BASELINE_COMMIT = 'b3deebdae4a92642c007d217a1a4573e5d3612c5';
export function requireCompressionBaseline(lock, manifest) {
  if (lock.version !== '0.3.1' || lock.tag !== 'v0.3.1' || lock.commit !== BASELINE_COMMIT
      || manifest.gameVersion !== lock.version || manifest.upstreamCommit !== lock.commit) {
    throw new Error('compression benchmark requires the locked v0.3.1 baseline');
  }
  if (manifest.bundleId !== `game-${lock.version}-${sha256(JSON.stringify(manifest.files)).slice(0, 24)}`) {
    throw new Error('benchmark bundleId does not match the uncompressed file manifest');
  }
}
export async function prepareCompressionBaseline() {
  const build = path.resolve('mobile/build'), baseline = path.join(build, 'compression-baseline');
  const lock = JSON.parse(await fs.readFile('mobile/game.lock.json', 'utf8'));
  const manifestFile = path.join(build, 'assets/game-manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  requireCompressionBaseline(lock, manifest);
  await fs.mkdir(baseline, { recursive: true });
  const started = performance.now();
  await writeZip(path.join(build, 'game'), path.join(baseline, 'game.zip'), { compress: false });
  const storeArchiveMs = Math.round(performance.now() - started);
  await fs.copyFile(manifestFile, path.join(baseline, 'game-manifest.json'));
  // 独立 ZIP 实现逐文件校验两份归档，不同时把完整的离线素材读入内存。
  const verify = spawnSync(process.env.MOBILE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', `
import hashlib,json,sys,zipfile
manifest=json.load(open(sys.argv[1],encoding='utf-8'))
expected={row['path']:row for row in manifest['files']}
assert len(expected)==len(manifest['files']), 'duplicate manifest paths'
for filename,method in [(sys.argv[2],0),(sys.argv[3],8)]:
    with zipfile.ZipFile(filename) as archive:
        entries=archive.infolist()
        assert len(entries)==len(expected), 'archive count changed'
        assert len({entry.filename for entry in entries})==len(entries), 'duplicate archive paths'
        for entry in entries:
            row=expected[entry.filename]
            assert entry.compress_type==method, 'wrong compression method'
            assert entry.file_size==row['size'], 'archive size changed'
            digest=hashlib.sha256()
            with archive.open(entry) as stream:
                while True:
                    block=stream.read(1024*1024)
                    if not block: break
                    digest.update(block)
            assert digest.hexdigest()==row['sha256'], 'archive content changed: '+entry.filename
print('Both archives match every manifest path, size, CRC and SHA256')
`, manifestFile, path.join(baseline, 'game.zip'), path.join(build, 'assets/game.zip')],
  { encoding: 'utf8', timeout: 600000, windowsHide: true });
  if (verify.status !== 0) throw new Error(`independent archive verification failed: ${verify.stderr || verify.error}`);
  console.log(verify.stdout.trim());
  const archives = {};
  for (const [name, file] of [['baseline', path.join(baseline, 'game.zip')], ['compressed', path.join(build, 'assets/game.zip')]]) {
    archives[name] = { bytes: (await fs.stat(file)).size, sha256: await hashFile(file) };
  }
  const phoneBuild = JSON.parse(await fs.readFile(path.join(build, 'phone-build.json'), 'utf8'));
  const report = { compressedArchiveMs: phoneBuild.game.archiveMs, bundleId: manifest.bundleId, upstreamCommit: lock.commit, files: manifest.files.length,
    manifestSha256: await hashFile(manifestFile), storeArchiveMs, archives,
    inputs: Object.fromEntries(await Promise.all(['game', 'runtime', 'fonts'].map(async name =>
      [name, await hashFile(`mobile/${name}.lock.json`)]))) };
  await fs.mkdir(path.join(build, 'qa'), { recursive: true });
  await fs.writeFile(path.join(build, 'qa/compression-archives.json'), JSON.stringify(report, null, 2) + '\n');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareCompressionBaseline().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
}
