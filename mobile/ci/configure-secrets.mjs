#!/usr/bin/env node
// 凭据仅通过 stdin 交给 gh，不进入命令行、Git 或日志。
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const repository = process.argv[2];
if (repository !== 'L-xuanxiao/Stronghold-Protocol') throw new Error('expected user fork: L-xuanxiao/Stronghold-Protocol');
const environment = { ...process.env };
delete environment.GITHUB_TOKEN;
const credentials = JSON.parse(await fs.readFile('mobile/keystore/credentials.json', 'utf8'));
const secrets = {
  ANDROID_KEYSTORE_BASE64: (await fs.readFile('mobile/keystore/release.jks')).toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: credentials.storePassword,
  ANDROID_KEY_PASSWORD: credentials.keyPassword,
  ANDROID_KEY_ALIAS: credentials.alias,
};
for (const [name, value] of Object.entries(secrets)) {
  const result = spawnSync('gh', ['secret', 'set', name, '--repo', repository], { input: value, env: environment, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`Could not configure ${name}: ${result.stderr || result.error}`);
  console.log(`Configured ${name}`);
}
