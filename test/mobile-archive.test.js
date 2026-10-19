import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip, zipEntries, hashFile } from '../mobile/tools/archive.mjs';

async function fixture(t) {
  const base = fileURLToPath(new URL('../.cache/mobile/tests/', import.meta.url));
  await fs.mkdir(base, { recursive: true });
  const dir = await fs.mkdtemp(path.join(base, 'compression-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'source'); await fs.mkdir(root);
  const files = new Map([['中文.json', Buffer.from('游戏资源'.repeat(1000))], ['binary.bin', Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256))], ['empty', Buffer.alloc(0)]]);
  for (const [name, bytes] of files) await fs.writeFile(path.join(root, name), bytes);
  return { dir, root, files };
}

test('DEFLATE ZIP 无损保留二进制、空文件及中文路径，默认 STORE 不变', async t => {
  const { dir, root, files } = await fixture(t);
  const stored = path.join(dir, 'stored.zip'), explicit = path.join(dir, 'explicit.zip'), compressed = path.join(dir, 'compressed.zip');
  await writeZip(root, stored); await writeZip(root, explicit, { compress: false }); await writeZip(root, compressed, { compress: true });
  assert.equal(await hashFile(stored), await hashFile(explicit));
  // 固定样本在压缩改造前的输出摘要，保护运行时备份的 STORE 字节兼容性。
  assert.equal(await hashFile(stored), 'cab5cc5dbf504adea2a200fb73a4ad0722acd0684e1b1c275ef789b00dc11b51');
  const bytes = await fs.readFile(compressed), plain = await fs.readFile(stored);
  assert(bytes.length < plain.length / 2);
  assert.equal(bytes.readUInt16LE(8), 8); assert.equal(plain.readUInt16LE(8), 0);
  const entries = zipEntries(bytes); assert.deepEqual(entries.map(e => e.path), [...files.keys()].sort());
  for (const entry of entries) assert.deepEqual(entry.bytes(), files.get(entry.path));
  let central = bytes.readUInt32LE(bytes.length - 6);
  for (let i = 0; i < entries.length; i++) {
    const local = bytes.readUInt32LE(central + 42);
    assert.equal(bytes.readUInt16LE(central + 10), 8);
    assert.equal(bytes.readUInt16LE(local + 8), 8);
    assert.equal(bytes.readUInt16LE(local + 6) & 8, 0);
    assert.deepEqual(bytes.subarray(local + 14, local + 26), bytes.subarray(central + 16, central + 28));
    central += 46 + bytes.readUInt16LE(central + 28) + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  await fs.utimes(path.join(root, '中文.json'), new Date(), new Date());
  const again = path.join(dir, 'again.zip'); await writeZip(root, again, { compress: true });
  assert.equal(await hashFile(compressed), await hashFile(again));
});

test('流式 ZIP 正确处理短写，不丢失数据', async t => {
  const { dir, root, files } = await fixture(t), file = path.join(dir, 'short-write.zip');
  const open = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    return { close: () => handle.close(), write: (bytes, offset, length, position) => handle.write(bytes, offset, Math.min(length, 7), position) };
  });
  await writeZip(root, file, { compress: true });
  for (const entry of zipEntries(await fs.readFile(file))) assert.deepEqual(entry.bytes(), files.get(entry.path));
});

test('压缩 ZIP 拒绝损坏数据、错误 CRC/长度及截断归档', async t => {
  const { dir, root } = await fixture(t), file = path.join(dir, 'game.zip');
  await writeZip(root, file, { compress: true });
  const bytes = await fs.readFile(file), end = bytes.length - 22, central = bytes.readUInt32LE(end + 16);
  assert.equal(bytes.readUInt16LE(central + 10), 8);
  const data = 30 + bytes.readUInt16LE(26) + bytes.readUInt16LE(28);
  const damaged = Buffer.from(bytes); damaged[data + 2] ^= 0xff;
  assert.throws(() => zipEntries(damaged)[0].bytes());
  const badCrc = Buffer.from(bytes); badCrc.writeUInt32LE((bytes.readUInt32LE(central + 16) ^ 1) >>> 0, central + 16);
  assert.throws(() => zipEntries(badCrc)[0].bytes(), /CRC/);
  const badSize = Buffer.from(bytes); badSize.writeUInt32LE(bytes.readUInt32LE(central + 24) + 1, central + 24);
  assert.throws(() => zipEntries(badSize)[0].bytes(), /长度|CRC/);
  assert.throws(() => zipEntries(bytes.subarray(0, bytes.length - 3)), /损坏/);
});

test('压缩写入失败清理临时归档并保留已有成功输出', async t => {
  const { dir, root } = await fixture(t), file = path.join(dir, 'game.zip');
  await fs.writeFile(file, 'previous-good-output');
  const open = fs.open.bind(fs); let calls = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    return { close: () => handle.close(), write: (...values) => {
      if (++calls === 3) throw new Error('injected disk failure');
      return handle.write(...values);
    } };
  });
  await assert.rejects(writeZip(root, file, { compress: true }), /injected disk failure/);
  await assert.rejects(fs.access(`${file}.part`));
  assert.equal(await fs.readFile(file, 'utf8'), 'previous-good-output');
});
