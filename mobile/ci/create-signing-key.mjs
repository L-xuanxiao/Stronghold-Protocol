#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const directory = path.join(root, 'mobile/keystore');
const keyStore = path.join(directory, 'release.jks');
const credentialsPath = path.join(directory, 'credentials.json');
await fs.mkdir(directory, { recursive: true });
let credentials;
try { credentials = JSON.parse(await fs.readFile(credentialsPath, 'utf8')); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try { await fs.access(keyStore); throw new Error('existing signing key without credentials: recover its password; do not replace it'); }
  catch (missing) { if (missing.code !== 'ENOENT') throw missing; }
  credentials = { alias: 'stronghold-mobile', storePassword: crypto.randomBytes(32).toString('base64url') };
  credentials.keyPassword = credentials.storePassword;
  await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2), { flag: 'wx', mode: 0o600 });
}
const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool') : 'keytool';
const environment = { ...process.env, SP_NEW_KEY_PASSWORD: credentials.storePassword };
const run = args => {
  const result = spawnSync(keytool, args, { env: environment, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return result.stdout;
};
try { await fs.access(keyStore); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  run(['-genkeypair', '-keystore', keyStore, '-alias', credentials.alias, '-storetype', 'JKS', '-keyalg', 'RSA', '-keysize', '3072',
    '-validity', '36500', '-dname', 'CN=Stronghold Protocol Mobile', '-storepass:env', 'SP_NEW_KEY_PASSWORD', '-keypass:env', 'SP_NEW_KEY_PASSWORD']);
}
const certificate = run(['-exportcert', '-rfc', '-keystore', keyStore, '-alias', credentials.alias, '-storepass:env', 'SP_NEW_KEY_PASSWORD']);
const certificateSha256 = new crypto.X509Certificate(certificate).fingerprint256.replaceAll(':', '').toLowerCase();
const publicPath = path.join(root, 'mobile/signing.json');
try {
  const existing = JSON.parse(await fs.readFile(publicPath, 'utf8'));
  if (existing.certificateSha256 !== certificateSha256) throw new Error('signing certificate changed; recover the original key before building updates');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
await fs.writeFile(publicPath, JSON.stringify({ schema: 1, applicationId: 'io.github.strongholdprotocol.mobile', certificateSha256 }, null, 2) + '\n');
await fs.writeFile(path.join(directory, 'certificate.pem'), certificate);
console.log(`Signing key ready: ${keyStore}\nBack up the entire ignored mobile/keystore directory offline. Passwords were not printed.`);
