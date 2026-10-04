#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('usage: node mobile/ci/sign.mjs <unsigned.apk> <signed.apk>');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME is required');
const tools = path.join(sdk, 'build-tools', process.env.SP_BUILD_TOOLS || '36.1.0');
let keyStore;
let temporary = false;
const environment = { ...process.env };
if (environment.SP_SIGN_STORE_BASE64) {
  if (!environment.SP_SIGN_STORE_PASSWORD || !environment.SP_SIGN_KEY_ALIAS) throw new Error('release signing secrets are missing');
  keyStore = path.join(environment.RUNNER_TEMP || 'mobile/build', 'mobile-release.jks');
  await fs.mkdir(path.dirname(keyStore), { recursive: true });
  await fs.writeFile(keyStore, Buffer.from(environment.SP_SIGN_STORE_BASE64, 'base64'), { flag: 'wx', mode: 0o600 });
  temporary = true;
} else {
  keyStore = path.resolve('mobile/keystore/release.jks');
  const credentials = JSON.parse(await fs.readFile('mobile/keystore/credentials.json', 'utf8'));
  environment.SP_SIGN_STORE_PASSWORD = credentials.storePassword;
  environment.SP_SIGN_KEY_PASSWORD = credentials.keyPassword;
  environment.SP_SIGN_KEY_ALIAS = credentials.alias;
}
if (!environment.SP_SIGN_STORE_PASSWORD || !environment.SP_SIGN_KEY_ALIAS) throw new Error('release signing secrets are missing');
environment.SP_SIGN_KEY_PASSWORD ||= environment.SP_SIGN_STORE_PASSWORD;
const binary = name => path.join(tools, name + (process.platform === 'win32' ? (name === 'apksigner' ? '.bat' : '.exe') : ''));
const run = (name, args) => {
  // Windows 直接运行 SDK 的 Java 工具，避免 .bat 经 cmd 二次转义。
  let result;
  if (process.platform === 'win32' && name === 'apksigner') {
    const java = environment.JAVA_HOME ? path.join(environment.JAVA_HOME, 'bin', 'java.exe') : 'java';
    result = spawnSync(java, ['-jar', path.join(tools, 'lib', 'apksigner.jar'), ...args], { env: environment, encoding: 'utf8', windowsHide: true });
  } else result = spawnSync(binary(name), args, { env: environment, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || String(result.error));
  return result.stdout;
};
await fs.mkdir(path.dirname(output), { recursive: true });
const aligned = `${output}.aligned.apk`;
try {
  run('zipalign', ['-f', '-P', '16', '4', path.resolve(input), path.resolve(aligned)]);
  run('apksigner', ['sign', '--ks', keyStore, '--ks-key-alias', environment.SP_SIGN_KEY_ALIAS,
    '--ks-pass', 'env:SP_SIGN_STORE_PASSWORD', '--key-pass', 'env:SP_SIGN_KEY_PASSWORD', '--out', path.resolve(output), path.resolve(aligned)]);
  const verification = run('apksigner', ['verify', '--verbose', '--print-certs', path.resolve(output)]);
  const actualCertificate = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/i.exec(verification)?.[1]?.toLowerCase();
  const expected = JSON.parse(await fs.readFile('mobile/signing.json', 'utf8'));
  if (actualCertificate !== expected.certificateSha256) throw new Error('APK signing certificate mismatch');
  run('zipalign', ['-c', '-P', '16', '4', path.resolve(output)]);
  const sha256 = crypto.createHash('sha256').update(await fs.readFile(output)).digest('hex');
  const lock = JSON.parse(await fs.readFile('mobile/game.lock.json', 'utf8'));
  const version = JSON.parse(await fs.readFile('mobile/version.json', 'utf8'));
  await fs.writeFile(`${output}.sha256`, `${sha256}  ${path.basename(output)}\n`);
  await fs.writeFile(`${output}.json`, JSON.stringify({ schema: 1, game: lock, mobile: version,
    certificateSha256: actualCertificate, sha256, size: (await fs.stat(output)).size }, null, 2) + '\n');
  console.log(`Verified signed APK: ${output}`);
} finally {
  await fs.rm(aligned, { force: true });
  if (temporary) await fs.rm(keyStore, { force: true });
}
