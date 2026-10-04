#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { arData, hashFile, regularFiles, safePath, sha256, tarEntries, writeZip, zipEntries } from './archive.mjs';
import { verifiedDownload } from './download.mjs';
import { androidLibName, inspectElf, patchElf, validateRuntime } from './elf.mjs';
import { prepareFonts } from './fonts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(ROOT, '.cache/mobile');
const BUILD = path.join(ROOT, 'mobile/build');
const TERMUX_PREFIX = 'data/data/com.termux/files/usr/';
const exists = (file) => fs.existsSync(file);
async function json(file) { return JSON.parse(await fsp.readFile(file, 'utf8')); }
async function saveJson(file, value) { await fsp.mkdir(path.dirname(file), { recursive: true }); await fsp.writeFile(file, `${JSON.stringify(value, null, 2)}\n`); }
async function removeGenerated(file) {
  const target = path.resolve(file);
  const allowed = [BUILD, CACHE].some((base) => { const relative = path.relative(base, target); return relative && !relative.startsWith('..') && !path.isAbsolute(relative); });
  if (!allowed) throw new Error(`拒绝删除生成目录以外的路径: ${target}`);
  await fsp.rm(target, { recursive: true, force: true });
}
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { windowsHide: true, stdio: 'inherit', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} 失败: ${result.error?.message || result.stderr || result.status}`);
  return result;
}
async function writeEntries(entries, dest) {
  // 先检查整份归档，再写入；所有上级目录都由本构建创建且不使用归档链接。
  for (const entry of entries) safePath(entry.path);
  for (const entry of entries) { const target = path.join(dest, ...entry.path.split('/')); await fsp.mkdir(path.dirname(target), { recursive: true }); await fsp.writeFile(target, entry.bytes); }
}
export async function stageLockedSource(root, lock, source) {
  if (!/^[0-9a-f]{40}$/.test(lock.commit) || lock.schema !== 1 || !lock.version || !/^v?[0-9]/.test(lock.tag)) throw new Error('游戏锁文件格式无效');
  const archive = spawnSync('git', ['archive', '--format=tar', lock.commit], { cwd: root, windowsHide: true, maxBuffer: 128 * 1024 * 1024 });
  if (archive.error || archive.status !== 0) throw new Error(`本地缺少锁定提交 ${lock.commit}；先 git fetch upstream ${lock.tag}（CI 须 fetch-depth: 0）`);
  await fsp.mkdir(source, { recursive: true });
  const entries = tarEntries(archive.stdout);
  await writeEntries(entries, source);
  const pkg = await json(path.join(source, 'package.json'));
  if (pkg.version !== lock.version) throw new Error(`锁文件版本 ${lock.version} 与源码 ${pkg.version} 不一致`);
  return source;
}
async function decompressDeb(file, temporary) {
  const member = arData(await fsp.readFile(file));
  if (member.name.endsWith('.gz')) return gunzipSync(member.bytes, { maxOutputLength: 256 * 1024 * 1024 });
  const input = `${temporary}.xz`, output = `${temporary}.tar`;
  await fsp.mkdir(path.dirname(input), { recursive: true }); await fsp.writeFile(input, member.bytes);
  const outFd = fs.openSync(output, 'w');
  let result;
  try {
    result = spawnSync('xz', ['-dc', input], { stdio: ['ignore', outFd, 'pipe'], windowsHide: true });
    if (result.error?.code === 'ENOENT') {
      const py = process.env.MOBILE_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
      const script = 'import lzma,sys,shutil\nwith lzma.open(sys.argv[1], "rb") as source: shutil.copyfileobj(source, sys.stdout.buffer)';
      result = spawnSync(py, ['-c', script, input], { stdio: ['ignore', outFd, 'pipe'], windowsHide: true });
    }
    if (result.error || result.status !== 0) throw new Error(`解压 XZ 需要 xz 或 Python3 lzma: ${result.error?.message || result.stderr}`);
  } finally { fs.closeSync(outFd); }
  if ((await fsp.stat(output)).size > 256 * 1024 * 1024) throw new Error('Debian 运行时单包解压超限');
  const tar = await fsp.readFile(output);
  await fsp.rm(input, { force: true }); await fsp.rm(output, { force: true });
  return tar;
}
export async function prepareRuntime(lock, abi, { offline = false } = {}) {
  const spec = lock.abis?.[abi];
  if (lock.schema !== 1 || !spec || Number(spec.nodeVersion.split('.')[0]) < 22) throw new Error(`无有效锁定 Node>=22 运行时: ${abi}`);
  const destination = path.join(BUILD, 'jniLibs', abi);
  await fsp.mkdir(destination, { recursive: true });
  const originals = new Map();
  await Promise.all(spec.packages.map((pkg) => verifiedDownload(pkg, path.join(CACHE, 'downloads', `${pkg.sha256}.deb`), { offline })));
  for (const pkg of spec.packages) {
    const deb = path.join(CACHE, 'downloads', `${pkg.sha256}.deb`);
    const entries = tarEntries(await decompressDeb(deb, path.join(CACHE, 'unpack', `${pkg.sha256}`)));
    for (const entry of entries) {
      if (!entry.path.startsWith(TERMUX_PREFIX)) continue;
      const relative = entry.path.slice(TERMUX_PREFIX.length);
      if (relative === 'bin/node' || /^lib\/lib[^/]+\.so(?:\.[^/]+)?$/.test(relative)) {
        const name = path.posix.basename(relative);
        if (originals.has(name)) throw new Error(`运行时文件名冲突: ${name}`);
        originals.set(name, Buffer.from(entry.bytes));
      }
    }
  }
  const names = new Map([...originals.keys()].map((name) => [name, androidLibName(name)]));
  const available = new Set(names.values());
  // ICU 实际文件 .so.78.3 的 SONAME 是 .so.78，不能只按磁盘文件名改依赖。
  for (const bytes of originals.values()) for (const str of inspectElf(bytes).strings) {
    const canonical = androidLibName(str.name);
    if (available.has(canonical)) names.set(str.name, canonical);
  }
  const stagedNames = new Set();
  for (const [name, bytes] of originals) {
    const target = names.get(name);
    if (!target || stagedNames.has(target)) throw new Error(`运行时重命名冲突: ${name}`);
    stagedNames.add(target); await fsp.writeFile(path.join(destination, target), patchElf(bytes, names), { mode: 0o755 });
  }
  const required = new Set(), queue = ['libnode.so'];
  while (queue.length) {
    const name = queue.pop(); if (required.has(name)) continue; required.add(name);
    const file = path.join(destination, name);
    if (!exists(file)) throw new Error(`运行时缺少 ${name}`);
    for (const needed of inspectElf(await fsp.readFile(file)).needed) if (stagedNames.has(needed)) queue.push(needed);
  }
  // libicu 包还含测试/命令行辅助库，只保留 Node 的实际传递依赖闭包。
  for (const name of stagedNames) if (!required.has(name)) { await fsp.rm(path.join(destination, name), { force: true }); stagedNames.delete(name); }
  for (const name of await fsp.readdir(destination)) if (!stagedNames.has(name)) await fsp.rm(path.join(destination, name), { force: true });
  const report = await validateRuntime(destination, abi);
  for (const library of report) library.sha256 = await hashFile(path.join(destination, library.file));
  await saveJson(path.join(BUILD, `runtime-${abi}.json`), { abi, nodeVersion: spec.nodeVersion, packages: spec.packages, libraries: report });
  return report;
}
async function prepareLicenses(lock, destination, offline) {
  const dir = path.join(destination, 'licenses/runtime'); await fsp.mkdir(dir, { recursive: true });
  for (const license of lock.licenses) {
    const file = path.join(CACHE, 'licenses', license.name);
    await verifiedDownload(license, file, { offline }); await fsp.copyFile(file, path.join(dir, license.name));
  }
  await saveJson(path.join(dir, 'runtime-source.json'), lock);
  await fsp.copyFile(path.join(ROOT, 'mobile/game.lock.json'), path.join(destination, 'licenses/game-source.json'));
}
export async function validateAssetReferences(game) {
  const missing = new Set(); let count = 0;
  function walk(value) {
    if (typeof value === 'string' && /^\/(assets|fonts)\//.test(value)) {
      const rel = safePath(decodeURIComponent(value.slice(1).split(/[?#]/)[0])); count++;
      const file = path.join(game, 'public', ...rel.split('/'));
      if (!exists(file) || fs.statSync(file).size === 0) missing.add(value);
    } else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  }
  walk(await json(path.join(game, 'data/assets.json')));
  if (exists(path.join(game, 'data/local-assets.json'))) walk(await json(path.join(game, 'data/local-assets.json')));
  if (!count || missing.size) throw new Error(`离线资源不完整，缺少 ${missing.size} 项: ${[...missing].slice(0, 20).join(', ')}`);
  for (const rel of ['public/index.html', 'public/vendor/pixi.min.js', 'public/vendor/three.module.js', 'public/assets/local/map/autochess/TX_autochessi_D.png', 'public/assets/local/map/autochess/tiles.json']) if (!exists(path.join(game, rel))) throw new Error(`缺少 ${rel}`);
  if (!exists(path.join(game, 'data/local-assets.json')) || !exists(path.join(game, 'public/assets/local'))) throw new Error('官方整合包缺少本地 3D 素材/清单，不能当成完整离线版发布');
  return { references: count, missing: [] };
}
async function copyTree(source, destination) { await fsp.cp(source, destination, { recursive: true, dereference: false, filter: (file) => !fs.lstatSync(file).isSymbolicLink() }); }
async function prepareGame(gameLock, runtimeLock, { offline = false } = {}) {
  const source = path.join(CACHE, 'source', gameLock.commit);
  await stageLockedSource(ROOT, gameLock, source);
  const lockHash = await hashFile(path.join(source, 'package-lock.json'));
  const marker = path.join(source, '.mobile-dependencies');
  if (!exists(marker) || (await fsp.readFile(marker, 'utf8')) !== lockHash || !exists(path.join(source, 'node_modules/ws'))) {
    console.log('隔离目录安装锁定 npm 依赖');
    const args = ['ci', '--ignore-scripts', '--no-audit', '--no-fund'];
    if (offline) args.push('--offline');
    const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (exists(npmCli)) run(process.execPath, [npmCli, ...args], { cwd: source });
    else run('npm', args, { cwd: source });
    await fsp.writeFile(marker, lockHash);
  }
  run(process.execPath, ['tools/vendor.mjs'], { cwd: source });
  const archiveFile = path.join(CACHE, `${gameLock.assetArchive.sha256}.zip`);
  // 复用当前首次下载，仍重新计算 SHA256 后才解压。
  const initial = path.join(CACHE, 'official-v0.1.2.zip');
  if (!exists(archiveFile) && exists(initial) && await hashFile(initial) === gameLock.assetArchive.sha256) await fsp.copyFile(initial, archiveFile);
  await verifiedDownload(gameLock.assetArchive, archiveFile, { offline });
  const entries = zipEntries(await fsp.readFile(archiveFile));
  const assetEntries = [], selectedPaths = new Set();
  for (const entry of entries) {
    if (entry.directory) continue;
    const match = /(?:^|\/)(public\/(?:assets|fonts)\/.+|data\/local-assets\.json)$/.exec(entry.path);
    if (match) {
      if (selectedPaths.has(match[1])) throw new Error(`整合包素材目录冲突: ${match[1]}`);
      selectedPaths.add(match[1]); assetEntries.push({ path: match[1], bytes: entry.bytes() });
    }
  }
  if (!assetEntries.length) throw new Error('正式整合包内没有素材');
  // 缓存源码的生成资源可以复用下载，但每次取材都清空旧生成目录，防止旧文件混入新包。
  for (const rel of ['public/assets', 'public/fonts']) await removeGenerated(path.join(source, rel));
  await writeEntries(assetEntries, source);
  const destination = path.join(BUILD, 'game');
  await removeGenerated(destination); await fsp.mkdir(destination, { recursive: true });
  for (const rel of ['server', 'shared', 'data', 'public', 'package.json', 'LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md']) await copyTree(path.join(source, rel), path.join(destination, rel));
  if (exists(path.join(source, 'NOTICE'))) await copyTree(path.join(source, 'NOTICE'), path.join(destination, 'NOTICE'));
  await copyTree(path.join(source, 'docs/research'), path.join(destination, 'docs/research'));
  await copyTree(path.join(source, 'node_modules/ws'), path.join(destination, 'node_modules/ws'));
  await fsp.writeFile(path.join(destination, 'node_modules/package.json'), '{"type":"commonjs"}\n');
  await fsp.copyFile(path.join(ROOT, 'mobile/node/main.mjs'), path.join(destination, 'mobile-main.mjs'));
  await prepareLicenses(runtimeLock, destination, offline);
  const fonts = await prepareFonts(destination, ROOT, await json(path.join(ROOT, 'mobile/fonts.lock.json')), { offline });
  const assets = await validateAssetReferences(destination);
  const files = [];
  for (const rel of await regularFiles(destination)) files.push({ path: rel, size: (await fsp.stat(path.join(destination, ...rel.split('/')))).size, sha256: await hashFile(path.join(destination, ...rel.split('/'))) });
  const bundleId = `game-${gameLock.version}-${sha256(JSON.stringify(files)).slice(0, 24)}`;
  const manifest = { schema: 1, bundleId, gameVersion: gameLock.version, upstreamCommit: gameLock.commit, files };
  const assetsDir = path.join(BUILD, 'assets'); await fsp.mkdir(assetsDir, { recursive: true });
  await writeZip(destination, path.join(assetsDir, 'game.zip'));
  await saveJson(path.join(assetsDir, 'game-manifest.json'), manifest);
  return { bundleId, files: files.length, size: files.reduce((sum, file) => sum + file.size, 0), archiveSha256: await hashFile(path.join(assetsDir, 'game.zip')), assets, fonts, source, assetsDir };
}
export async function checkPrepared(gameLock, runtimeLock, abi) {
  const manifest = await json(path.join(BUILD, 'assets/game-manifest.json'));
  if (manifest.upstreamCommit !== gameLock.commit || manifest.gameVersion !== gameLock.version) throw new Error('已准备游戏不是锁定版本');
  const expected = new Map(manifest.files.map((file) => [safePath(file.path), file]));
  if (expected.size !== manifest.files.length) throw new Error('manifest 路径重复');
  for (const file of ['LICENSE', 'NOTICE.md', 'THIRD-PARTY-NOTICES.md', 'licenses/fonts/fonts-source.json', 'public/fonts/mobile-fonts.css']) if (!expected.has(file)) throw new Error(`完整离线包缺少声明或字体来源记录: ${file}`);
  if (expected.get('licenses/game-source.json')?.sha256 !== await hashFile(path.join(ROOT, 'mobile/game.lock.json'))) throw new Error('资源包游戏来源记录与当前锁文件不一致');
  const fontLock = await json(path.join(ROOT, 'mobile/fonts.lock.json'));
  if (expected.get('licenses/fonts/fonts-source.json')?.sha256 !== sha256(`${JSON.stringify(fontLock, null, 2)}\n`)) throw new Error('资源包字体来源记录与当前锁文件不一致');
  for (const font of fontLock.files) {
    const rel = `${font.role === 'font' ? 'public/fonts/mobile' : 'licenses/fonts'}/${font.filename}`;
    if (expected.get(rel)?.sha256 !== font.sha256 || expected.get(rel)?.size !== font.size) throw new Error(`资源包字体与锁文件不一致: ${font.family}`);
  }
  const entries = zipEntries(await fsp.readFile(path.join(BUILD, 'assets/game.zip'))).filter((entry) => !entry.directory);
  if (entries.length !== expected.size) throw new Error('ZIP 与 manifest 文件数量不一致');
  for (const entry of entries) { const file = expected.get(entry.path); if (!file || file.size !== entry.size || file.sha256 !== sha256(entry.bytes())) throw new Error(`ZIP 与 manifest 内容不一致: ${entry.path}`); }
  const libraries = await validateRuntime(path.join(BUILD, 'jniLibs', abi), abi);
  const runtimeReport = await json(path.join(BUILD, `runtime-${abi}.json`));
  if (runtimeReport.nodeVersion !== runtimeLock.abis[abi].nodeVersion || JSON.stringify(runtimeReport.packages) !== JSON.stringify(runtimeLock.abis[abi].packages)) throw new Error('运行时报告与锁文件不一致，请重新 prepare');
  const expectedLibraries = new Map(runtimeReport.libraries.map((lib) => [lib.file, lib.sha256]));
  if (libraries.length !== expectedLibraries.size) throw new Error('运行时库数量与报告不一致');
  for (const lib of libraries) if (await hashFile(path.join(BUILD, 'jniLibs', abi, lib.file)) !== expectedLibraries.get(lib.file)) throw new Error(`运行时库 SHA256 不符: ${lib.file}`);
  return { bundleId: manifest.bundleId, gameVersion: gameLock.version, nodeVersion: runtimeLock.abis[abi].nodeVersion, files: entries.length, libraries };
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('node mobile/tools/prepare.mjs --abi=arm64-v8a|x86_64 [--check-only|--runtime-only|--game-only] [--offline]'); return; }
  for (const arg of args) if (!['--check-only', '--runtime-only', '--game-only', '--offline'].includes(arg) && !arg.startsWith('--abi=')) throw new Error(`未知参数: ${arg}`);
  const abi = args.find((a) => a.startsWith('--abi='))?.slice(6) || 'arm64-v8a';
  const gameLock = await json(path.join(ROOT, 'mobile/game.lock.json')), runtimeLock = await json(path.join(ROOT, 'mobile/runtime.lock.json'));
  if (!runtimeLock.abis[abi]) throw new Error(`不支持 ABI ${abi}`);
  if (args.includes('--check-only')) { console.log(JSON.stringify(await checkPrepared(gameLock, runtimeLock, abi), null, 2)); return; }
  const offline = args.includes('--offline');
  const runtime = args.includes('--game-only') ? undefined : await prepareRuntime(runtimeLock, abi, { offline });
  const game = args.includes('--runtime-only') ? undefined : await prepareGame(gameLock, runtimeLock, { offline });
  const report = { schema: 1, gameVersion: gameLock.version, upstreamCommit: gameLock.commit, abi, runtime, game, gradleProperties: { gameAssetsDir: path.join(BUILD, 'assets'), runtimeDir: path.join(BUILD, 'jniLibs'), gameAbi: abi } };
  await saveJson(path.join(BUILD, 'build.json'), report); console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
