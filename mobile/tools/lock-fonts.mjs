#!/usr/bin/env node
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sha256 } from './archive.mjs';
import { verifiedDownload } from './download.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FAMILIES = [
  { family: 'Noto Sans SC', directory: 'ofl/notosanssc', fonts: [['NotoSansSC[wght].ttf', '400 900', 'noto-sans-sc.ttf']] },
  { family: 'Oxanium', directory: 'ofl/oxanium', fonts: [['Oxanium[wght].ttf', '400 700', 'oxanium.ttf']] },
  { family: 'Rajdhani', directory: 'ofl/rajdhani', fonts: [['Rajdhani-Medium.ttf', '500', 'rajdhani-medium.ttf'], ['Rajdhani-SemiBold.ttf', '600', 'rajdhani-semibold.ttf'], ['Rajdhani-Bold.ttf', '700', 'rajdhani-bold.ttf']] },
];
async function main() {
  const commit = process.argv.find((arg) => arg.startsWith('--commit='))?.slice(9);
  if (!process.argv.includes('--refresh') || !/^[a-f0-9]{40}$/.test(commit || '')) throw new Error('显式维护命令: node mobile/tools/lock-fonts.mjs --refresh --commit=<google/fonts完整SHA>');
  const lock = { schema: 1, repository: 'google/fonts', commit, files: [] };
  const cache = path.join(ROOT, '.cache/mobile/fonts'); await fsp.mkdir(cache, { recursive: true });
  for (const group of FAMILIES) {
    const api = await fetch(`https://api.github.com/repos/google/fonts/contents/${group.directory}?ref=${commit}`, { signal: AbortSignal.timeout(60000) });
    if (!api.ok) throw new Error(`GitHub 字体目录读取失败 HTTP ${api.status}`);
    const records = await api.json();
    for (const [sourceName, weight, filename] of [...group.fonts, ['OFL.txt', '', `${group.family.toLowerCase().replaceAll(' ', '-')}-OFL.txt`]]) {
      const record = records.find((item) => item.name === sourceName);
      if (!record || !/^[a-f0-9]{40}$/.test(record.sha)) throw new Error(`锁定提交中缺少 ${sourceName}`);
      const sourcePath = `${group.directory}/${sourceName}`;
      const url = `https://raw.githubusercontent.com/google/fonts/${commit}/${sourcePath.split('/').map(encodeURIComponent).join('/')}`;
      const seed = path.join(cache, `${record.sha}.git-input`);
      await verifiedDownload({ url, size: record.size, gitBlob: record.sha }, seed, { initializeGitBlob: true, rangeThreshold: 8 * 1024 * 1024 });
      const bytes = await fsp.readFile(seed);
      const gitBlob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
      if (bytes.length !== record.size || gitBlob !== record.sha) throw new Error(`字体与锁定提交 Git blob 不符: ${sourcePath}`);
      const digest = sha256(bytes), role = sourceName === 'OFL.txt' ? 'license' : 'font';
      await fsp.writeFile(path.join(cache, `${digest}${role === 'font' ? '.ttf' : '.txt'}`), bytes);
      await fsp.rm(seed, { force: true });
      lock.files.push({ role, family: group.family, filename, ...(weight ? { weight, format: 'truetype' } : {}), sourcePath, url, gitBlob, size: bytes.length, sha256: digest });
    }
  }
  await fsp.writeFile(path.join(ROOT, 'mobile/fonts.lock.json'), `${JSON.stringify(lock, null, 2)}\n`);
  console.log('已锁定字体及 OFL: mobile/fonts.lock.json');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
