import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { hashFile } from './archive.mjs';
import { createHash } from 'node:crypto';

async function rangedDownload(fetchImpl, head, spec, temporary, signal) {
  const count = 8, size = spec.size, parts = [], controller = new AbortController();
  const combined = AbortSignal.any([signal, controller.signal]);
  try {
    const results = await Promise.allSettled(Array.from({ length: count }, async (_, i) => {
      const start = Math.floor(size * i / count), end = Math.floor(size * (i + 1) / count) - 1;
      const file = `${temporary}.${i}`; parts[i] = file;
      try {
        const response = await fetchImpl(head.url || spec.url, { headers: { Range: `bytes=${start}-${end}` }, signal: combined });
        if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${size}` || response.url && !response.url.startsWith('https://')) throw new Error('下载服务器没有正确遵守 Range 边界');
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
        if ((await fsp.stat(file)).size !== end - start + 1) throw new Error('Range 下载内容被截断');
      } catch (error) { controller.abort(error); throw error; }
    }));
    const failure = results.find((result) => result.status === 'rejected'); if (failure) throw failure.reason;
    const out = await fsp.open(temporary, 'w');
    try { for (const file of parts) for await (const chunk of fs.createReadStream(file)) await out.write(chunk); }
    finally { await out.close(); }
  } finally { await Promise.all(parts.map((file) => fsp.rm(file, { force: true }))); }
}

export async function verifiedDownload(spec, file, { fetchImpl = fetch, offline = false, initializeGitBlob = false, rangeThreshold = 64 * 1024 * 1024 } = {}) {
  const gitMode = initializeGitBlob && /^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[a-f0-9]{40}\//.test(spec.url) && /^[a-f0-9]{40}$/.test(spec.gitBlob);
  if (!/^https:\/\//.test(spec.url) || !(gitMode || /^[a-f0-9]{64}$/.test(spec.sha256))) throw new Error('下载必须有 HTTPS 来源和预期 SHA256');
  const digest = async (target) => {
    if (!gitMode) return hashFile(target);
    const hash = createHash('sha1').update(`blob ${(await fsp.stat(target)).size}\0`);
    for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
    return hash.digest('hex');
  };
  const expected = gitMode ? spec.gitBlob : spec.sha256;
  try {
    if (await digest(file) === expected) return file;
    throw new Error(`缓存 SHA256 不符: ${file}；删除此缓存后重试`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (offline) throw new Error(`离线缓存缺失: ${file}`);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.part`;
  try {
    console.log(`下载 ${spec.url}`);
    const signal = AbortSignal.timeout(30 * 60 * 1000);
    // 大型正式整合包分段传输，每段和完整包都校验；小型运行时包继续直接下载。
    let head;
    if (spec.size >= rangeThreshold) {
      head = await fetchImpl(spec.url, { method: 'HEAD', redirect: 'follow', signal });
      if (!head.ok || head.headers.get('accept-ranges') !== 'bytes' || Number(head.headers.get('content-length')) !== spec.size) head = undefined;
    }
    if (head) await rangedDownload(fetchImpl, head, spec, temporary, signal);
    else {
      const response = await fetchImpl(spec.url, { redirect: 'follow', signal });
      if (!response.ok || response.url && !response.url.startsWith('https://')) throw new Error(`下载失败 HTTP ${response.status}: ${spec.url}`);
      await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));
    }
    if (spec.size && (await fsp.stat(temporary)).size !== spec.size) throw new Error(`下载大小不符合锁文件: ${spec.url}`);
    if (await digest(temporary) !== expected) throw new Error(`下载 ${gitMode ? 'Git blob' : 'SHA256'} 校验失败: ${spec.url}`);
    await fsp.rename(temporary, file);
    return file;
  } catch (error) { await fsp.rm(temporary, { force: true }); throw error; }
}
