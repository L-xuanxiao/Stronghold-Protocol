#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile, sha256, writeZip, zipEntries } from './archive.mjs';
import { verifiedDownload } from './download.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache/mobile');
function expectedInputs(lock) {
  const inputs = new Map();
  for (const abi of Object.values(lock.abis)) for (const pkg of abi.packages) inputs.set(`downloads/${pkg.sha256}.deb`, pkg);
  for (const license of lock.licenses) inputs.set(`licenses/${license.name}`, license);
  return inputs;
}
export async function importRuntimeInputs(file, lock, destination, { allowPartial = false } = {}) {
  const entries = zipEntries(await fsp.readFile(file)).filter((entry) => !entry.directory), expected = expectedInputs(lock);
  const saved = entries.find((entry) => entry.path === 'runtime.lock.json');
  const kitMatchesCurrentLock = !!saved && JSON.stringify(JSON.parse(saved.bytes())) === JSON.stringify(lock);
  if (!saved || !allowPartial && !kitMatchesCurrentLock) throw new Error('输入备份与当前 runtime.lock.json 不一致');
  if (!allowPartial && entries.length !== expected.size + 1) throw new Error('输入备份文件数量不一致');
  const verified = [], skipped = [];
  for (const entry of entries) {
    if (entry.path === 'runtime.lock.json') continue;
    if (!/^(downloads\/[a-f0-9]{64}\.deb|licenses\/[A-Za-z0-9._-]+)$/.test(entry.path)) throw new Error(`输入备份路径无效: ${entry.path}`);
    const spec = expected.get(entry.path);
    if (!spec && allowPartial) { skipped.push(entry.path); continue; }
    if (!spec) throw new Error(`输入备份存在未知条目: ${entry.path}`);
    const bytes = entry.bytes();
    if (sha256(bytes) !== spec.sha256 || spec.size && entry.size !== spec.size) {
      // 新锁文件的许可文本可能换了版本；旧文本只跳过，绝不写入新缓存。
      if (allowPartial && entry.path.startsWith('licenses/')) { skipped.push(entry.path); continue; }
      throw new Error(`输入备份 SHA256 不符: ${entry.path}`);
    }
    verified.push({ path: entry.path, bytes });
  }
  // 全部校验完毕才写缓存；这些文件随后仍会由 prepare 再做 SHA256 校验。
  for (const entry of verified) { const target = path.join(destination, ...entry.path.split('/')); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, entry.bytes); }
  const present = new Set(verified.map((entry) => entry.path));
  return { imported: verified.length, skipped, missing: [...expected.keys()].filter((name) => !present.has(name)), kitMatchesCurrentLock };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || !['export', 'import'].includes(args[0])) { console.log('node mobile/tools/runtime-inputs.mjs export|import --file=<runtime-inputs.zip> [--offline] [--allow-partial]'); return; }
  for (const arg of args.slice(1)) if (!['--offline', '--allow-partial'].includes(arg) && !arg.startsWith('--file=')) throw new Error(`未知参数 ${arg}`);
  const file = path.resolve(args.find((arg) => arg.startsWith('--file='))?.slice(7) || path.join(ROOT, 'mobile/build/runtime-inputs.zip'));
  const lock = JSON.parse(await fsp.readFile(path.join(ROOT, 'mobile/runtime.lock.json'), 'utf8'));
  if (args[0] === 'import') { console.log(JSON.stringify(await importRuntimeInputs(file, lock, CACHE, { allowPartial: args.includes('--allow-partial') }), null, 2)); return; }
  const stage = path.resolve(ROOT, 'mobile/build/runtime-inputs'), build = path.resolve(ROOT, 'mobile/build');
  if (path.dirname(stage) !== build) throw new Error('运行时备份暂存目录越界');
  await fsp.rm(stage, { recursive: true, force: true }); await fsp.mkdir(stage, { recursive: true });
  for (const [rel, spec] of expectedInputs(lock)) {
    const source = path.join(CACHE, ...rel.split('/')); await verifiedDownload(spec, source, { offline: args.includes('--offline') });
    const target = path.join(stage, ...rel.split('/')); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.copyFile(source, target);
  }
  await fsp.copyFile(path.join(ROOT, 'mobile/runtime.lock.json'), path.join(stage, 'runtime.lock.json'));
  await writeZip(stage, file); console.log(`${file}\nSHA256 ${await hashFile(file)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
