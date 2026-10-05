#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashFile } from '../tools/archive.mjs';

const repository = process.env.GITHUB_REPOSITORY || 'L-xuanxiao/Stronghold-Protocol';
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('invalid repository');
const token = process.env.GH_TOKEN;
const response = await fetch(`https://api.github.com/repos/${repository}/releases?per_page=100`, {
  headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'stronghold-mobile-runtime-restore',
    ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error(`runtime archive release query failed: ${response.status}`);
const releases = await response.json();
// 候选和 inputs- 构建备份草稿都保留输入，避免旧 Termux 包被轮换。
const release = releases.find(r => !r.prerelease && /^(?:inputs-)?android-v\d+\.\d+\.\d+-\d+$/.test(r.tag_name) &&
  r.assets.some(a => a.name === 'runtime-inputs.zip'));
if (!release) {
  console.log('No published runtime input kit yet; using checksum-locked official packages.');
} else {
  const asset = release.assets.find(a => a.name === 'runtime-inputs.zip');
  if (!/^sha256:[0-9a-f]{64}$/.test(asset.digest || '')) throw new Error('archived runtime kit requires a GitHub SHA256 digest');
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(`/${repository}/releases/download/`)) throw new Error('unexpected runtime archive source');
  const destination = path.resolve('.cache/mobile/runtime-archives', `${asset.digest.slice(7)}.zip`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try { await fs.access(destination); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // gh 处理私有草稿下载的认证与重定向，令牌不会进入 URL 或打印到日志。
    const result = spawnSync('gh', ['release', 'download', release.tag_name, '--repo', repository,
      '--pattern', 'runtime-inputs.zip', '--output', destination], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error('runtime input archive download failed');
  }
  if ((await fs.stat(destination)).size !== asset.size || await hashFile(destination) !== asset.digest.slice(7)) {
    throw new Error('runtime input archive does not match GitHub SHA256 digest');
  }
  const result = spawnSync(process.execPath, ['mobile/tools/runtime-inputs.mjs', 'import', `--file=${destination}`, '--allow-partial'], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('archived runtime inputs failed current-lock verification');
}
