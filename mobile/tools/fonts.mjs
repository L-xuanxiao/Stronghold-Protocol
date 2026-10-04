import fsp from 'node:fs/promises';
import path from 'node:path';
import { safePath } from './archive.mjs';
import { verifiedDownload } from './download.mjs';

export function localFontHtml(html) {
  let count = 0;
  const result = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/\bhref\s*=\s*['"]https:\/\/fonts\.(googleapis|gstatic)\.com(?:\/|['"])/i.test(tag)) return tag;
    count++; return '';
  });
  if (!count || /https:\/\/fonts\.(googleapis|gstatic)\.com/i.test(result) || !result.includes('</head>')) throw new Error('上游字体入口变动，需要审查移动端本地字体适配');
  return result.replace('</head>', '  <!-- Android 字体来自随包校验的官方 Google Fonts 快照，首次离线启动可用。 -->\n  <link rel="stylesheet" href="/fonts/mobile-fonts.css" />\n</head>');
}
export async function prepareFonts(game, root, lock, { offline = false } = {}) {
  if (lock.schema !== 1 || lock.repository !== 'google/fonts' || !/^[a-f0-9]{40}$/.test(lock.commit)) throw new Error('无效的字体锁文件');
  const cache = path.join(root, '.cache/mobile/fonts'), fonts = path.join(game, 'public/fonts/mobile'), licenses = path.join(game, 'licenses/fonts');
  await fsp.mkdir(fonts, { recursive: true }); await fsp.mkdir(licenses, { recursive: true });
  const css = [], families = new Set();
  for (const file of lock.files) {
    safePath(file.filename);
    if (!/^[A-Za-z0-9._-]+$/.test(file.filename) || !['font', 'license'].includes(file.role) || !['Noto Sans SC', 'Oxanium', 'Rajdhani'].includes(file.family) || !file.url.startsWith(`https://raw.githubusercontent.com/google/fonts/${lock.commit}/`)) throw new Error('字体锁文件条目无效');
    const source = path.join(cache, `${file.sha256}${file.role === 'font' ? '.ttf' : '.txt'}`);
    await verifiedDownload(file, source, { offline });
    const destination = path.join(file.role === 'font' ? fonts : licenses, file.filename); await fsp.copyFile(source, destination);
    if (file.role === 'font') {
      if (!/^[1-9]00(?: [1-9]00)?$/.test(file.weight) || file.format !== 'truetype') throw new Error('字体格式或字重无效');
      families.add(file.family);
      css.push(`@font-face { font-family: '${file.family}'; font-style: normal; font-weight: ${file.weight}; font-display: swap; src: url('/fonts/mobile/${file.filename}') format('truetype'); }`);
    }
  }
  if (families.size !== 3 || lock.files.filter((file) => file.role === 'license').length !== 3) throw new Error('三个字体家族及其 OFL 必须完整');
  await fsp.writeFile(path.join(game, 'public/fonts/mobile-fonts.css'), `/* SHA-locked Google Fonts ${lock.commit}; licenses/fonts contains OFL. */\n${css.join('\n')}\n`);
  const index = path.join(game, 'public/index.html'); await fsp.writeFile(index, localFontHtml(await fsp.readFile(index, 'utf8')));
  await fsp.writeFile(path.join(licenses, 'fonts-source.json'), `${JSON.stringify(lock, null, 2)}\n`);
  await fsp.writeFile(path.join(licenses, 'README.md'), 'Noto Sans SC、Oxanium、Rajdhani 随 Android 版离线提供，来自 Google Fonts 的锁定提交，均使用 SIL Open Font License 1.1。各字体的完整许可及版权记录见同目录 *-OFL.txt，来源、Git blob 与 SHA256 见 fonts-source.json。上游 THIRD-PARTY-NOTICES.md 按原样保留；其中字体“运行时 Google Fonts 加载、不随包分发”的说明由本记录补充。\n');
  return { families: [...families], commit: lock.commit, files: lock.files.length };
}
