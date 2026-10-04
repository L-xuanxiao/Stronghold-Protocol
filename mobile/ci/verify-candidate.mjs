#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { verifyPackage, verifyPromotion } from './candidate-policy.mjs';

const directory = process.argv[2];
if (!directory) throw new Error('usage: node mobile/ci/verify-candidate.mjs <directory>');
const files = (await fs.readdir(directory)).filter(file => file.endsWith('.apk'));
if (files.length !== 1) throw new Error('exactly one phone APK is required');
const apk = path.join(directory, files[0]);
const metadata = JSON.parse(await fs.readFile(`${apk}.json`, 'utf8'));
const signing = JSON.parse(await fs.readFile('mobile/signing.json', 'utf8'));
if (metadata.schema !== 1 || metadata.certificateSha256 !== signing.certificateSha256 ||
    metadata.mobile.applicationId !== signing.applicationId) throw new Error('candidate identity changed');
const checksum = crypto.createHash('sha256').update(await fs.readFile(apk)).digest('hex');
if (metadata.sha256 !== checksum || metadata.size !== (await fs.stat(apk)).size) throw new Error('candidate bytes changed after validation');
const checksumFile = await fs.readFile(`${apk}.sha256`, 'utf8');
if (checksumFile !== `${checksum}  ${files[0]}\n`) throw new Error('checksum file mismatch');
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) throw new Error('ANDROID_HOME is required to verify the actual APK signature');
const buildTools = path.join(sdk, 'build-tools', process.env.SP_BUILD_TOOLS || '36.1.0');
function run(name, args) {
  const binary = path.join(buildTools, name + (process.platform === 'win32' ? (name === 'apksigner' ? '.bat' : '.exe') : ''));
  let result;
  if (process.platform === 'win32' && name === 'apksigner') {
    const java = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : 'java';
    result = spawnSync(java, ['-jar', path.join(buildTools, 'lib', 'apksigner.jar'), ...args], { encoding: 'utf8', windowsHide: true });
  } else result = spawnSync(binary, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${name} verification failed: ${result.stderr || result.error}`);
  return result.stdout;
}
const signature = run('apksigner', ['verify', '--verbose', '--print-certs', path.resolve(apk)]);
const certificate = /Signer #1 certificate SHA-256 digest: ([0-9a-f]+)/i.exec(signature)?.[1]?.toLowerCase();
if (certificate !== signing.certificateSha256) throw new Error('actual APK certificate differs from release identity');
verifyPackage(metadata, run('aapt2', ['dump', 'badging', path.resolve(apk)]), process.env.TAG);
if (process.argv[3]) {
  const pages = JSON.parse(await fs.readFile(process.argv[3], 'utf8'));
  verifyPromotion(pages.flat(), process.env.TAG);
}
console.log(`Candidate bytes verified: ${files[0]}`);
