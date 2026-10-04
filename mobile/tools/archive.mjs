import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function safePath(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || /[\x00-\x1f]/.test(name) || name.includes(':') || name.startsWith('/')) throw new Error(`不安全的归档路径: ${name}`);
  while (name.startsWith('./')) name = name.slice(2);
  name = name.replace(/\/$/, '');
  if (!name || name.split('/').some((x) => !x || x === '.' || x === '..' || /[. ]$/.test(x) || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(x))) throw new Error(`不安全的归档路径: ${name}`);
  return name;
}
export async function regularFiles(root, prefix = '') {
  const files = [];
  for (const entry of (await fsp.readdir(path.join(root, prefix), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    safePath(rel);
    if (entry.isDirectory()) files.push(...await regularFiles(root, rel));
    else if (entry.isFile()) files.push(rel);
    else throw new Error(`不打包符号链接或特殊文件: ${rel}`);
  }
  return files.sort();
}
let crcTable;
export function crc32(bytes, previous = 0) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => { let c = n; for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; return c >>> 0; });
  let crc = previous ^ 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ crc >>> 8;
  return (crc ^ 0xffffffff) >>> 0;
}

// 固定时间、排序和压缩方式；资源内容相同就得到同一 ZIP，不依赖宿主机文件时间。
export async function writeZip(root, output) {
  const files = await regularFiles(root);
  if (files.length > 65535) throw new Error('ZIP 文件数量超限，需要显式升级 ZIP64 格式');
  await fsp.mkdir(path.dirname(output), { recursive: true });
  const handle = await fsp.open(`${output}.part`, 'w');
  const central = [];
  let offset = 0;
  try {
    for (const rel of files) {
      const name = Buffer.from(rel);
      const file = path.join(root, ...rel.split('/'));
      const size = (await fsp.stat(file)).size;
      let crc = 0;
      for await (const chunk of fs.createReadStream(file)) crc = crc32(chunk, crc);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
      local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
      await handle.write(local); await handle.write(name);
      for await (const chunk of fs.createReadStream(file)) await handle.write(chunk);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x314, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
      record.writeUInt16LE(33, 14); record.writeUInt32LE(crc, 16); record.writeUInt32LE(size, 20); record.writeUInt32LE(size, 24);
      record.writeUInt16LE(name.length, 28); record.writeUInt32LE(0x81a40000, 38); record.writeUInt32LE(offset, 42);
      central.push(record, name); offset += local.length + name.length + size;
      if (offset > 0xffffffff) throw new Error('ZIP 超过 4 GiB，需要 ZIP64');
    }
    const centralStart = offset;
    for (const record of central) { await handle.write(record); offset += record.length; }
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(offset - centralStart, 12); end.writeUInt32LE(centralStart, 16); await handle.write(end);
  } finally { await handle.close(); }
  await fsp.rename(`${output}.part`, output);
  return files;
}

export function zipEntries(buffer) {
  let end = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65557); i--) if (buffer.readUInt32LE(i) === 0x06054b50 && i + 22 + buffer.readUInt16LE(i + 20) === buffer.length) { end = i; break; }
  if (end < 0 || buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) throw new Error('损坏或多卷 ZIP');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('损坏的 ZIP 中央目录');
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const raw = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const rel = safePath(raw), mode = buffer.readUInt32LE(offset + 38) >>> 16;
    if ((mode & 0xf000) === 0xa000 || buffer.readUInt16LE(offset + 8) & 1) throw new Error(`不支持链接或加密 ZIP: ${rel}`);
    if (names.has(rel.toLowerCase())) throw new Error(`ZIP 路径重复: ${rel}`); names.add(rel.toLowerCase());
    const localOffset = buffer.readUInt32LE(offset + 42), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff || compressed === 0xffffffff || size > 512 * 1024 * 1024) throw new Error('ZIP64 或单文件过大');
    if (localOffset + 30 > end || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 本地头无效: ${rel}`);
    const dataOffset = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (dataOffset + compressed > end) throw new Error(`ZIP 内容截断: ${rel}`);
    const localName = buffer.toString('utf8', localOffset + 30, localOffset + 30 + buffer.readUInt16LE(localOffset + 26));
    if (localName !== raw) throw new Error(`ZIP 路径头不一致: ${rel}`);
    const method = buffer.readUInt16LE(offset + 10), expectedCrc = buffer.readUInt32LE(offset + 16);
    if (![0, 8].includes(method)) throw new Error(`ZIP 压缩方式不支持: ${method}`);
    entries.push({ path: rel, directory: raw.endsWith('/'), size, bytes() {
      const rawBytes = buffer.subarray(dataOffset, dataOffset + compressed);
      const bytes = method === 0 ? rawBytes : inflateRawSync(rawBytes, { maxOutputLength: Math.max(1, size) });
      if (bytes.length !== size || crc32(bytes) !== expectedCrc) throw new Error(`ZIP 长度或 CRC 无效: ${rel}`);
      return bytes;
    } });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== end || offset - buffer.readUInt32LE(end + 16) !== buffer.readUInt32LE(end + 12)) throw new Error('ZIP 中央目录长度无效');
  return entries;
}

export function arData(buffer) {
  if (buffer.toString('ascii', 0, 8) !== '!<arch>\n') throw new Error('不是 Debian ar 包');
  for (let offset = 8; offset + 60 <= buffer.length;) {
    const name = buffer.toString('ascii', offset, offset + 16).trim().replace(/\/$/, '');
    const size = Number(buffer.toString('ascii', offset + 48, offset + 58).trim());
    if (!Number.isSafeInteger(size) || size < 0 || offset + 60 + size > buffer.length || buffer.toString('ascii', offset + 58, offset + 60) !== '`\n') throw new Error('Debian ar 包截断');
    if (/^data\.tar\.(xz|gz)$/.test(name)) return { name, bytes: buffer.subarray(offset + 60, offset + 60 + size) };
    offset += 60 + size + size % 2;
  }
  throw new Error('Debian 包缺少 data.tar.xz/gz');
}

export function tarEntries(buffer) {
  const entries = [], names = new Set();
  let extendedName, pax = {};
  for (let offset = 0; offset + 512 <= buffer.length;) {
    const head = buffer.subarray(offset, offset + 512);
    if (head.every((byte) => byte === 0)) break;
    const text = (start, length) => head.toString('utf8', start, start + length).replace(/\0.*$/s, '');
    const size = parseInt(text(124, 12).trim(), 8), checksum = parseInt(text(148, 8).trim(), 8);
    let sum = 0; for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i];
    if (sum !== checksum || !Number.isSafeInteger(size) || size < 0 || offset + 512 + size > buffer.length) throw new Error('TAR 头校验失败或内容截断');
    const data = buffer.subarray(offset + 512, offset + 512 + size), type = text(156, 1) || '0';
    const name = text(345, 155) ? `${text(345, 155)}/${text(0, 100)}` : text(0, 100);
    if (type === 'L') extendedName = data.toString('utf8').replace(/\0.*$/s, '').replace(/\n$/, '');
    else if (type === 'x' || type === 'g') {
      let pos = 0;
      while (pos < data.length) { const space = data.indexOf(32, pos), len = Number(data.toString('ascii', pos, space)); if (space < 0 || !Number.isSafeInteger(len) || len < 3 || pos + len > data.length) throw new Error('PAX 记录损坏'); const record = data.toString('utf8', space + 1, pos + len - 1), eq = record.indexOf('='); pax[record.slice(0, eq)] = record.slice(eq + 1); pos += len; }
    } else {
      const raw = pax.path || extendedName || name;
      if (raw !== './' && raw !== '.') {
        const rel = safePath(raw);
        if (names.has(rel.toLowerCase())) throw new Error(`TAR 路径重复: ${rel}`); names.add(rel.toLowerCase());
        if (type === '1' || type === '2') {
          const target = pax.linkpath || text(157, 100);
          const resolved = path.posix.normalize(type === '1' ? target : path.posix.join(path.posix.dirname(rel), target));
          safePath(resolved);
        }
        // 包里的 npm 链接不需要落盘，链接本身的路径仍须安全，绝不跟随它写文件。
        if (type === '0' || type === '7') entries.push({ path: rel, bytes: data });
        else if (!['1', '2', '5'].includes(type)) throw new Error(`TAR 特殊条目不支持: ${rel}`);
      }
      pax = {}; extendedName = undefined;
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}
