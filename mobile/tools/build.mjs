#!/usr/bin/env node
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { checkPrepared } from './prepare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ANDROID = path.join(ROOT, 'mobile/android');
function run(command, args, cwd = ROOT) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(command)} 失败: ${result.error?.message || result.status}`);
}
export function runGradle(args, { root = ROOT, env = process.env, stdio = 'inherit', timeout } = {}) {
  const android = path.join(root, 'mobile/android');
  const fromJavaHome = env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  const java = fromJavaHome && fs.existsSync(fromJavaHome) ? fromJavaHome : 'java';
  // 直接启动 JVM，避免 Windows 批处理引号与路径中的 shell 元字符被再次解释。
  const result = spawnSync(java, ['-classpath', path.join(android, 'gradle/wrapper/gradle-wrapper.jar'), 'org.gradle.wrapper.GradleWrapperMain', ...args], { cwd: android, env, stdio, encoding: 'utf8', windowsHide: true, timeout });
  if (result.error || result.status !== 0) throw new Error(`Gradle 失败: ${result.error?.message || result.stderr || result.status}`);
  return result;
}
export async function ensureDebugKeystore(root = ROOT, { env = process.env } = {}) {
  const directory = path.resolve(root, '.cache/android-signing'), keystore = path.join(directory, 'debug.keystore');
  if (fs.existsSync(keystore)) return keystore;
  await fsp.mkdir(directory, { recursive: true });
  const fromJavaHome = env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool');
  const keytool = fromJavaHome && fs.existsSync(fromJavaHome) ? fromJavaHome : 'keytool';
  const temporary = path.join(directory, `debug-${randomUUID()}.keystore`);
  try {
    run(keytool, ['-genkeypair', '-keystore', temporary, '-storepass', 'android', '-keypass', 'android', '-alias', 'androiddebugkey', '-dname', 'CN=Android Debug,O=Android,C=US', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-noprompt']);
    // 并发构建也不覆盖先建立的 debug 身份；发布签名完全由独立作业管理。
    try { await fsp.copyFile(temporary, keystore, fs.constants.COPYFILE_EXCL); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    return keystore;
  } finally { await fsp.rm(temporary, { force: true }); }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log('node mobile/tools/build.mjs --abi=arm64-v8a|x86_64 [--release] [--no-prepare] [--offline] [--sdk=<path>]'); return; }
  for (const arg of args) if (!['--release', '--no-prepare', '--offline'].includes(arg) && !arg.startsWith('--abi=') && !arg.startsWith('--sdk=')) throw new Error(`未知参数: ${arg}`);
  const abi = args.find((a) => a.startsWith('--abi='))?.slice(6) || 'arm64-v8a';
  const game = JSON.parse(await fsp.readFile(path.join(ROOT, 'mobile/game.lock.json'))), runtime = JSON.parse(await fsp.readFile(path.join(ROOT, 'mobile/runtime.lock.json'))), version = JSON.parse(await fsp.readFile(path.join(ROOT, 'mobile/version.json')));
  if (!args.includes('--no-prepare')) run(process.execPath, ['mobile/tools/prepare.mjs', `--abi=${abi}`, ...(args.includes('--offline') ? ['--offline'] : [])]);
  await checkPrepared(game, runtime, abi);
  const sdk = args.find((a) => a.startsWith('--sdk='))?.slice(6) || process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || (process.platform === 'win32' && fs.existsSync('D:/AndroidSdk') ? 'D:/AndroidSdk' : '');
  if (!sdk || !fs.existsSync(path.join(sdk, 'platforms'))) throw new Error('请设置 ANDROID_HOME 或 --sdk 指向已安装的 Android SDK');
  const platforms = (await fsp.readdir(path.join(sdk, 'platforms'))).filter((name) => name.startsWith('android-36')).sort();
  if (!platforms.length) throw new Error('需要 Android SDK platform android-36 或 android-36.1');
  const type = args.includes('--release') ? 'release' : 'debug';
  if (type === 'debug') await ensureDebugKeystore();
  // 增量 APK 写入可能残留旧资源块；只清理 app/build，再使用已校验的独立资源目录。
  const gradleArgs = [':app:clean', type === 'release' ? 'assembleRelease' : 'assembleDebug', 'testDebugUnitTest', '--no-daemon', `-PgameAssetsDir=${path.join(ROOT, 'mobile/build/assets')}`, `-PruntimeDir=${path.join(ROOT, 'mobile/build/jniLibs')}`, `-PgameAbi=${abi}`, `-PmobileVersionCode=${version.versionCode}`, `-PgameVersion=${game.version}`, `-PcompileSdk=${platforms.at(-1)}`];
  const previousHome = process.env.ANDROID_HOME; process.env.ANDROID_HOME = path.resolve(sdk);
  try {
    runGradle(gradleArgs);
  } finally { if (previousHome === undefined) delete process.env.ANDROID_HOME; else process.env.ANDROID_HOME = previousHome; }
  const apk = path.join(ANDROID, `app/build/outputs/apk/${type}/app-${type}${type === 'release' ? '-unsigned' : ''}.apk`);
  if (!fs.existsSync(apk)) throw new Error(`Gradle 未生成 APK: ${apk}`);
  console.log(`APK: ${apk}`);
  if (type === 'release') console.log('发布包尚未签名；通过独立签名作业签名后验收并发布。');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
