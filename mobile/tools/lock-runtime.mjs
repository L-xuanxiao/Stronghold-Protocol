#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { sha256 } from './archive.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'https://packages.termux.dev/apt/termux-main';
const PACKAGES = ['nodejs-lts', 'libc++', 'openssl', 'c-ares', 'libicu', 'libsqlite', 'zlib'];
const LICENSES = [
  ['Node.txt', 'https://raw.githubusercontent.com/nodejs/node/v24.18.0/LICENSE'],
  ['c-ares.txt', 'https://raw.githubusercontent.com/c-ares/c-ares/v1.34.8/LICENSE.md'],
  ['OpenSSL.txt', 'https://raw.githubusercontent.com/openssl/openssl/openssl-3.6.5/LICENSE.txt'],
  ['ICU.txt', 'https://raw.githubusercontent.com/unicode-org/icu/release-78.3/icu4c/LICENSE'],
  ['zlib.txt', 'https://raw.githubusercontent.com/madler/zlib/v1.3.2/LICENSE'],
  ['libcxx.txt', 'https://raw.githubusercontent.com/llvm/llvm-project/llvmorg-21.1.0/libcxx/LICENSE.TXT'],
  ['SQLite.html', 'https://www.sqlite.org/copyright.html'],
];
export function parsePackages(text) {
  return new Map(text.split(/\n\s*\n/).filter(Boolean).map((record) => {
    const fields = Object.fromEntries(record.split('\n').filter((line) => /^[A-Za-z0-9-]+: /.test(line)).map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]));
    return [fields.Package, fields];
  }));
}
async function getBytes(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
async function main() {
  // 显式维护命令，普通 prepare 绝不从可变索引挑选新版本。
  if (!process.argv.includes('--refresh')) throw new Error('使用 --refresh 显式生成新锁文件，并审查版本、许可证和 16 KB 验证结果');
  const lock = { schema: 1, sourceRepository: 'https://github.com/termux/termux-packages', minimumAndroid: 24, metadata: {}, abis: {}, licenses: [] };
  const cache = path.join(ROOT, '.cache/mobile'); await fsp.mkdir(cache, { recursive: true });
  for (const [abi, arch] of [['arm64-v8a', 'aarch64'], ['x86_64', 'x86_64']]) {
    const url = `${BASE}/dists/stable/main/binary-${arch}/Packages.gz`;
    let plain;
    if (process.argv.includes('--cached-index')) plain = await fsp.readFile(path.join(cache, `Packages-${arch}`));
    else { plain = gunzipSync(await getBytes(url)); await fsp.writeFile(path.join(cache, `Packages-${arch}`), plain); }
    lock.metadata[abi] = { url: url.replace(/\.gz$/, ''), sha256: sha256(plain), transport: 'HTTPS', retrievedAt: new Date().toISOString() };
    const records = parsePackages(plain.toString('utf8'));
    const packages = PACKAGES.map((name) => {
      const pkg = records.get(name);
      if (!pkg?.Filename || !/^[a-f0-9]{64}$/.test(pkg.SHA256)) throw new Error(`索引缺少 ${name}/${arch}`);
      return { name, version: pkg.Version, url: `${BASE}/${pkg.Filename.split('/').map(encodeURIComponent).join('/')}`, size: Number(pkg.Size), sha256: pkg.SHA256, depends: pkg.Depends || '', homepage: pkg.Homepage };
    });
    const nodeVersion = packages.find((p) => p.name === 'nodejs-lts').version.split('-')[0];
    if (nodeVersion !== '24.18.0') throw new Error(`运行时变为 ${nodeVersion}；维护者须更新 LICENSES 版本和兼容验证，不能自动替换`);
    lock.abis[abi] = { arch, nodeVersion, packages };
  }
  for (const [name, url] of LICENSES) {
    const bytes = await getBytes(url), digest = sha256(bytes);
    await fsp.mkdir(path.join(cache, 'licenses'), { recursive: true });
    await fsp.writeFile(path.join(cache, 'licenses', name), bytes);
    lock.licenses.push({ name, url, size: bytes.length, sha256: digest });
  }
  await fsp.writeFile(path.join(ROOT, 'mobile/runtime.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  console.log('已生成 mobile/runtime.lock.json；请审查后提交锁文件');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
