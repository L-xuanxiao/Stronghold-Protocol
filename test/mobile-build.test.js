import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { sha256, hashFile, safePath, tarEntries, writeZip, zipEntries } from '../mobile/tools/archive.mjs';
import { verifiedDownload } from '../mobile/tools/download.mjs';
import { patchElf, inspectElf, validate16k, validateRuntime } from '../mobile/tools/elf.mjs';
import { stageLockedSource, validateAssetReferences } from '../mobile/tools/prepare.mjs';
import { importRuntimeInputs } from '../mobile/tools/runtime-inputs.mjs';
import { runGradle, ensureDebugKeystore } from '../mobile/tools/build.mjs';
import { localFontHtml } from '../mobile/tools/fonts.mjs';

async function temporary(t) {
  const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.cache/mobile/tests'); await fsp.mkdir(base, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(base, 'case-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true })); return dir;
}
function tar(pathname, bytes = Buffer.from('data'), type = '0') {
  const h = Buffer.alloc(512); h.write(pathname); h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(`${bytes.length.toString(8).padStart(11, '0')}\0`, 124); h.write('00000000000\0', 136); h.fill(32, 148, 156); h.write(type, 156);
  let checksum = 0; for (const b of h) checksum += b; h.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([h, bytes, Buffer.alloc((512 - bytes.length % 512) % 512), Buffer.alloc(1024)]);
}
function elf({ alignment = 16384, needed = [], machine = 183 } = {}) {
  const b = Buffer.alloc(1024); b.writeUInt32LE(0x464c457f); b[4] = 2; b[5] = 1; b.writeUInt16LE(machine, 18);
  b.writeBigUInt64LE(64n, 32); b.writeUInt16LE(56, 54); b.writeUInt16LE(2, 56);
  b.writeUInt32LE(1, 64); b.writeBigUInt64LE(0n, 72); b.writeBigUInt64LE(65536n, 80); b.writeBigUInt64LE(1024n, 96); b.writeBigUInt64LE(BigInt(alignment), 112);
  b.writeUInt32LE(2, 120); b.writeBigUInt64LE(192n, 128); b.writeBigUInt64LE(65728n, 136); b.writeBigUInt64LE(BigInt((needed.length + 3) * 16), 152);
  let strSize = 1; const offsets = [];
  for (const name of needed) { offsets.push(strSize); b.write(`${name}\0`, 512 + strSize); strSize += Buffer.byteLength(name) + 1; }
  const records = [[5, 66048], [10, strSize], ...offsets.map((offset) => [1, offset]), [0, 0]];
  records.forEach(([tag, value], i) => { b.writeBigInt64LE(BigInt(tag), 192 + i * 16); b.writeBigUInt64LE(BigInt(value), 200 + i * 16); }); return b;
}
test('下载先核验 SHA256；坏缓存和坏下载都不能继续解压', async (t) => {
  const dir = await temporary(t), file = path.join(dir, 'runtime.deb'); const valid = Buffer.from('expected');
  const spec = { url: 'https://example.invalid/node.deb', sha256: sha256(valid) }; let requests = 0;
  const fetchImpl = async () => { requests++; return new Response('wrong payload'); };
  await assert.rejects(verifiedDownload(spec, file, { fetchImpl }), /SHA256/);
  await assert.rejects(fsp.access(file)); await assert.rejects(fsp.access(`${file}.part`));
  await fsp.writeFile(file, 'corrupt cache'); requests = 0;
  await assert.rejects(verifiedDownload(spec, file, { fetchImpl }), /缓存 SHA256/); assert.equal(requests, 0);
  await fsp.writeFile(file, valid); assert.equal(await verifiedDownload(spec, file, { fetchImpl }), file); assert.equal(requests, 0);
  await assert.rejects(verifiedDownload({ ...spec, url: 'http://example.invalid/node.deb' }, file), /HTTPS/);
});
test('大资源下载拒绝忽略 Range 的服务器，且不留下部分归档', async (t) => {
  const root = await temporary(t), file = path.join(root, 'game.zip'), size = 64 * 1024 * 1024;
  const fetchImpl = async (_url, options) => options.method === 'HEAD'
    ? new Response(null, { status: 200, headers: { 'accept-ranges': 'bytes', 'content-length': String(size) } })
    : new Response('entire file instead of range', { status: 200 });
  await assert.rejects(verifiedDownload({ url: 'https://example.invalid/game.zip', size, sha256: sha256('irrelevant') }, file, { fetchImpl }), /Range/);
  assert.deepEqual(await fsp.readdir(root), []);
});
test('字体建锁必须校验 immutable Google Fonts Git blob，普通构建仍要求 SHA256', async (t) => {
  const root = await temporary(t), file = path.join(root, 'font.ttf'), bytes = Buffer.from('font-bytes');
  const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  const spec = { url: `https://raw.githubusercontent.com/google/fonts/${'a'.repeat(40)}/ofl/font.ttf`, size: bytes.length, gitBlob };
  await assert.rejects(verifiedDownload(spec, file, { fetchImpl: async () => new Response(bytes) }), /SHA256/);
  await assert.rejects(verifiedDownload(spec, file, { initializeGitBlob: true, fetchImpl: async () => new Response('bad--bytes') }), /Git blob/);
  await assert.rejects(verifiedDownload({ ...spec, url: spec.url.replace('a'.repeat(40), 'main') }, file, { initializeGitBlob: true }), /SHA256/);
  await verifiedDownload(spec, file, { initializeGitBlob: true, fetchImpl: async () => new Response(bytes) }); assert.equal(await hashFile(file), sha256(bytes));
});
test('TAR/ZIP 拒绝目录逃逸、重复路径和符号链接', async (t) => {
  for (const name of ['../evil', '/absolute', 'C:/escape', 'safe/../../evil', 'safe\\evil', 'safe//evil', 'CON', 'nul.txt', 'file.', 'file ']) assert.throws(() => safePath(name), /不安全/);
  assert.throws(() => tarEntries(tar('../evil')), /不安全/);
  const corrupted = tar('file'); corrupted[0] = 100; assert.throws(() => tarEntries(corrupted), /校验/);
  const dir = await temporary(t), root = path.join(dir, 'tree'); await fsp.mkdir(root); await fsp.writeFile(path.join(root, 'valid'), 'bytes');
  const file = path.join(dir, 'game.zip'); await writeZip(root, file); const bytes = await fsp.readFile(file);
  const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  const symlink = Buffer.from(bytes); symlink.writeUInt32LE(0xa1ff0000, central + 38); assert.throws(() => zipEntries(symlink), /链接/);
  const traversal = Buffer.from(bytes); traversal.write('../xx', 30); traversal.write('../xx', central + 46); assert.throws(() => zipEntries(traversal), /不安全/);
});
test('资源 ZIP 可复现且 CRC 校验拦截被修改的资源', async (t) => {
  const dir = await temporary(t), root = path.join(dir, 'tree'); await fsp.mkdir(root); await fsp.writeFile(path.join(root, 'b'), 'second'); await fsp.writeFile(path.join(root, 'a'), 'first');
  const a = path.join(dir, 'a.zip'), b = path.join(dir, 'b.zip'); await writeZip(root, a); await fsp.utimes(path.join(root, 'a'), new Date(), new Date()); await writeZip(root, b);
  assert.equal(await hashFile(a), await hashFile(b)); const bytes = await fsp.readFile(a); assert.deepEqual(zipEntries(bytes).map((entry) => entry.path), ['a', 'b']);
  const corrupt = Buffer.from(bytes); corrupt[31] ^= 1; assert.throws(() => zipEntries(corrupt)[0].bytes(), /CRC/);
});
test('运行时必须真的满足 16 KB 对齐和完整动态依赖', async (t) => {
  assert.throws(() => validate16k(elf({ alignment: 4096 })), /16 KB/);
  const original = elf({ needed: ['libssl.so.3', 'libc.so'] }), patched = patchElf(original, new Map([['libssl.so.3', 'libssl.so']]));
  assert.deepEqual(inspectElf(patched).needed, ['libssl.so', 'libc.so']); assert.deepEqual(inspectElf(original).needed, ['libssl.so.3', 'libc.so']);
  const dir = await temporary(t); await fsp.writeFile(path.join(dir, 'libnode.so'), patched);
  await assert.rejects(validateRuntime(dir, 'arm64-v8a'), /缺少动态依赖/);
  await fsp.writeFile(path.join(dir, 'libssl.so'), elf()); assert.equal((await validateRuntime(dir, 'arm64-v8a')).length, 2);
  await assert.rejects(validateRuntime(dir, 'x86_64'), /架构/);
});
test('源码来自锁定提交，当前工作树改动完全不进入隔离构建', async (t) => {
  const root = await temporary(t), stage = path.join(root, '.cache/source');
  const git = (args) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git(['init', '-q']); git(['config', 'user.email', 'test@example.invalid']); git(['config', 'user.name', 'Test']);
  await fsp.writeFile(path.join(root, 'package.json'), '{"version":"0.1.2"}'); await fsp.mkdir(path.join(root, 'data')); await fsp.writeFile(path.join(root, 'data/assets.json'), '{"baseline":true}');
  git(['add', '.']); git(['commit', '-qm', 'baseline']); const commit = git(['rev-parse', 'HEAD']);
  await fsp.writeFile(path.join(root, 'data/assets.json'), '{"userLocalChange":true}'); const before = git(['diff']);
  await stageLockedSource(root, { schema: 1, commit, tag: 'v0.1.2', version: '0.1.2' }, stage);
  assert.equal(await fsp.readFile(path.join(stage, 'data/assets.json'), 'utf8'), '{"baseline":true}'); assert.equal(git(['diff']), before);
});
test('资源清单中的音效缺失会阻止离线包发布', async (t) => {
  const root = await temporary(t); await fsp.mkdir(path.join(root, 'data')); await fsp.writeFile(path.join(root, 'data/assets.json'), '{"audio":{"attack":"/assets/sfx/attack.wav"}}');
  await assert.rejects(validateAssetReferences(root), /缺少 1 项/);
});
test('离线运行时备份必须匹配锁文件且全部校验后才写缓存', async (t) => {
  const root = await temporary(t), stage = path.join(root, 'input'), destination = path.join(root, 'restored');
  const bytes = Buffer.from('verified-deb'), pkg = { sha256: sha256(bytes), size: bytes.length }, lock = { abis: { arm64: { packages: [pkg] } }, licenses: [] };
  await fsp.mkdir(path.join(stage, 'downloads'), { recursive: true }); await fsp.writeFile(path.join(stage, 'runtime.lock.json'), JSON.stringify(lock));
  const deb = path.join(stage, `downloads/${pkg.sha256}.deb`); await fsp.writeFile(deb, 'tampered'); const archive = path.join(root, 'input.zip'); await writeZip(stage, archive);
  await assert.rejects(importRuntimeInputs(archive, lock, destination), /SHA256/); await assert.rejects(fsp.access(destination));
  await fsp.writeFile(deb, bytes); await writeZip(stage, archive); assert.equal((await importRuntimeInputs(archive, lock, destination)).imported, 1);
  assert.equal(await hashFile(path.join(destination, `downloads/${pkg.sha256}.deb`)), pkg.sha256);
  await assert.rejects(importRuntimeInputs(archive, { ...lock, schema: 2 }, destination), /不一致/);
  const newer = { abis: { arm64: { packages: [{ sha256: sha256('new-deb'), size: 7 }] } }, licenses: [] };
  const partial = await importRuntimeInputs(archive, newer, destination, { allowPartial: true });
  assert.equal(partial.imported, 0); assert.equal(partial.missing.length, 1); assert.equal(partial.skipped.length, 1);
});
test('新 clone 自动建立 debug 签名，重复构建保留身份且不接触 release 密钥', async (t) => {
  const root = await temporary(t), release = path.join(root, '.cache/android-signing/release.keystore');
  await fsp.mkdir(path.dirname(release), { recursive: true }); await fsp.writeFile(release, 'long-lived-release-identity');
  const env = process.platform === 'win32' && !process.env.JAVA_HOME ? { ...process.env, JAVA_HOME: 'C:/Program Files/Java/jdk-21' } : process.env;
  const file = await ensureDebugKeystore(root, { env }); const before = await hashFile(file);
  assert.equal(await ensureDebugKeystore(root, { env: { JAVA_HOME: 'invalid-directory' } }), file); assert.equal(await hashFile(file), before);
  assert.equal(await fsp.readFile(release, 'utf8'), 'long-lived-release-identity');
  const keytool = env.JAVA_HOME ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
  const listing = spawnSync(keytool, ['-list', '-keystore', file, '-storepass', 'android', '-alias', 'androiddebugkey'], { encoding: 'utf8', windowsHide: true });
  assert.equal(listing.status, 0, listing.stderr); assert.match(listing.stdout, /androiddebugkey/);
});
test('已有缓存的真实 Gradle wrapper 通过 JVM 启动，shell 元字符不会执行', async (t) => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const gradleHome = path.join(root, '.cache/gradle');
  const cached = path.join(gradleHome, 'wrapper/dists/gradle-8.13-bin/5xuhj0ry160q40clulazy9h7d');
  // --offline 不限制 wrapper 自身下载；仅在完整分发缓存存在时进行这个集成检查。
  try { await fsp.access(path.join(cached, 'gradle-8.13-bin.zip.ok')); await fsp.access(path.join(cached, 'gradle-8.13/lib/gradle-launcher-8.13.jar')); }
  catch { t.skip('没有完整 Gradle 8.13 缓存，跳过以避免下载分发包'); return; }
  const dir = await temporary(t), marker = path.join(dir, 'unexpected-shell-output');
  const env = { ...process.env, GRADLE_USER_HOME: gradleHome };
  if (process.platform === 'win32' && !env.JAVA_HOME) env.JAVA_HOME = 'C:/Program Files/Java/jdk-21';
  const result = runGradle(['--version', '--offline', `-Dmobile.shellBoundary=value&echo unsafe>${marker}`], { root, env, stdio: 'pipe', timeout: 45000 });
  assert.match(result.stdout, /Gradle 8\.13/); await assert.rejects(fsp.access(marker));
});
test('离线字体适配只替换 Google Fonts 入口，保留游戏与原有自托管字体', () => {
  const original = `<head><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet"\n href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC"><link href="/fonts/fonts.css"><script src="/js/app.js"></script></head>`;
  const adapted = localFontHtml(original);
  assert.doesNotMatch(adapted, /fonts\.googleapis|fonts\.gstatic/); assert.match(adapted, /\/fonts\/mobile-fonts.css/);
  assert.match(adapted, /<link href="\/fonts\/fonts.css">/); assert.match(adapted, /<script src="\/js\/app.js"><\/script>/);
  assert.match(original, /fonts\.googleapis/); assert.throws(() => localFontHtml('<head></head>'), /入口变动/);
});
