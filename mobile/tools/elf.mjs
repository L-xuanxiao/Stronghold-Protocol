import fsp from 'node:fs/promises';
import path from 'node:path';

// PR #7 的 SONAME 缩短思路：Fuhua-code/Stronghold-Protocol (GPL-3.0-or-later),
// aecc6e3d4468ee110171d182aa8a85f8705e3d82/mobile/tools/patch-elf-sonames.mjs。
// 这里通过 PT_LOAD 精确映射虚拟地址，拒绝不完整 ELF，避免猜测动态字符串表的位置。
export function androidLibName(name) {
  if (name === 'node') return 'libnode.so';
  return /^(lib.+?\.so)(?:\..+)?$/.exec(name)?.[1] || null;
}
export function inspectElf(buffer) {
  if (buffer.length < 64 || buffer.readUInt32LE(0) !== 0x464c457f || buffer[4] !== 2 || buffer[5] !== 1) throw new Error('仅支持 ELF64 little-endian');
  const boundedNumber = (value) => { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error('ELF 地址超限'); return number; };
  const phoff = boundedNumber(buffer.readBigUInt64LE(32)), phsize = buffer.readUInt16LE(54), phnum = buffer.readUInt16LE(56);
  if (phsize < 56 || phnum < 1 || phoff + phsize * phnum > buffer.length) throw new Error('ELF program header 无效');
  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phsize;
    const segment = { type: buffer.readUInt32LE(p), offset: boundedNumber(buffer.readBigUInt64LE(p + 8)), address: boundedNumber(buffer.readBigUInt64LE(p + 16)), size: boundedNumber(buffer.readBigUInt64LE(p + 32)), align: boundedNumber(buffer.readBigUInt64LE(p + 48)) };
    if (segment.offset + segment.size > buffer.length) throw new Error('ELF segment 截断');
    segments.push(segment);
  }
  const dynamic = segments.find((s) => s.type === 2);
  const loads = segments.filter((s) => s.type === 1);
  if (!dynamic || !loads.length) throw new Error('ELF 缺少 PT_DYNAMIC/PT_LOAD');
  const records = [];
  for (let p = dynamic.offset; p + 16 <= dynamic.offset + dynamic.size; p += 16) {
    const tag = Number(buffer.readBigInt64LE(p)), value = boundedNumber(buffer.readBigUInt64LE(p + 8));
    if (tag === 0) break; records.push({ tag, value });
  }
  const address = records.find((r) => r.tag === 5)?.value, length = records.find((r) => r.tag === 10)?.value;
  const segment = loads.find((s) => address >= s.address && address + length <= s.address + s.size);
  if (!segment || !length) throw new Error('ELF DT_STRTAB 不能映射到文件');
  const start = segment.offset + address - segment.address;
  const strings = records.filter((r) => [1, 14].includes(r.tag)).map((r) => {
    const offset = start + r.value, end = buffer.indexOf(0, offset);
    if (r.value >= length || end < offset || end >= start + length) throw new Error('ELF 动态字符串越界');
    return { tag: r.tag, offset, end, name: buffer.toString('utf8', offset, end) };
  });
  return { machine: buffer.readUInt16LE(18), loads, strings, needed: strings.filter((s) => s.tag === 1).map((s) => s.name) };
}
export function validate16k(buffer) {
  const elf = inspectElf(buffer);
  for (const load of elf.loads) if (load.align < 16384 || (load.align & load.align - 1) !== 0 || (load.address - load.offset) % 16384 !== 0) throw new Error(`ELF 不兼容 16 KB 页面 (PT_LOAD p_align=${load.align})；请从锁定源码重编译运行时，不能仅修改头字段`);
  return elf;
}
export function patchElf(buffer, names) {
  const result = Buffer.from(buffer), elf = inspectElf(result);
  for (const str of elf.strings) {
    const replacement = names.get(str.name);
    if (!replacement || replacement === str.name) continue;
    const value = Buffer.from(replacement);
    if (value.length > str.end - str.offset) throw new Error(`ELF 新 SONAME 长于原值: ${str.name}`);
    result.fill(0, str.offset, str.end); value.copy(result, str.offset);
  }
  return result;
}
const SYSTEM_LIBRARIES = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libandroid.so']);
export async function validateRuntime(dir, abi) {
  const files = (await fsp.readdir(dir)).filter((f) => /^lib.+\.so$/.test(f)).sort();
  if (!files.includes('libnode.so')) throw new Error('运行时缺少 libnode.so');
  const expectedMachine = { 'arm64-v8a': 183, x86_64: 62 }[abi];
  if (!expectedMachine) throw new Error(`不支持 ABI: ${abi}`);
  const libraries = new Set(files), report = [];
  for (const file of files) {
    const elf = validate16k(await fsp.readFile(path.join(dir, file)));
    if (elf.machine !== expectedMachine) throw new Error(`ELF 架构与 ${abi} 不符: ${file}`);
    const missing = elf.needed.filter((name) => !libraries.has(name) && !SYSTEM_LIBRARIES.has(name));
    if (missing.length) throw new Error(`${file} 缺少动态依赖: ${missing.join(', ')}`);
    report.push({ file, needed: elf.needed, loadAlignments: elf.loads.map((s) => s.align) });
  }
  return report;
}
