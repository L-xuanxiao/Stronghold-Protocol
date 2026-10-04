#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectRelease(releases, currentVersion) {
  const numbers = version => version.replace(/^v/, '').split('.').map(Number);
  const compare = (a, b) => {
    const av = numbers(a), bv = numbers(b);
    for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
    return 0;
  };
  return releases.filter(r => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name))
    .filter(r => compare(r.tag_name, currentVersion) > 0)
    .sort((a, b) => compare(b.tag_name, a.tag_name))[0] ?? null;
}

export function lockFromRelease(release, commit, repository) {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('upstream commit must be a full SHA');
  const name = `Stronghold-Protocol-${release.tag_name}.zip`;
  const asset = release.assets.find(a => a.name === name);
  if (!asset || !/^sha256:[0-9a-f]{64}$/.test(asset.digest ?? '')) {
    throw new Error(`official full asset ZIP with GitHub SHA256 digest is required: ${name}`);
  }
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      !url.pathname.startsWith(`/${repository}/releases/download/`)) throw new Error('unexpected asset source');
  if (!Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('invalid asset size');
  return { schema: 1, repository, tag: release.tag_name, commit, version: release.tag_name.slice(1),
    assetArchive: { url: url.href, sha256: asset.digest.slice(7), size: asset.size } };
}

export async function resolveCommit(get, repository, tag) {
  let ref = await get(`/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`);
  for (let i = 0; i < 8; i++) {
    if (ref.object?.type === 'commit' && /^[0-9a-f]{40}$/.test(ref.object.sha)) return ref.object.sha;
    if (ref.object?.type !== 'tag') throw new Error('tag does not resolve to a commit');
    ref = await get(`/repos/${repository}/git/tags/${ref.object.sha}`);
  }
  throw new Error('annotated tag chain is too deep');
}

async function main() {
  for (const arg of process.argv.slice(2)) if (!['--write', '--locked'].includes(arg)) throw new Error('unknown updater argument');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const lockPath = path.join(root, 'mobile/game.lock.json');
  const current = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  const repository = 'sganggs/Stronghold-Protocol';
  if (current.repository !== repository) throw new Error('unexpected upstream repository');
  const get = async endpoint => {
    const token = process.env.GH_TOKEN;
    const response = await fetch(`https://api.github.com${endpoint}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'stronghold-mobile-builder',
        ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
    return response.json();
  };
  const releases = process.argv.includes('--locked') ? [] : await get(`/repos/${repository}/releases?per_page=100`);
  const release = selectRelease(releases, current.version);
  const next = release ? lockFromRelease(release, await resolveCommit(get, repository, release.tag_name), repository) : current;
  const changed = !!release;
  if (changed && process.argv.includes('--write')) {
    await fs.writeFile(`${lockPath}.tmp`, JSON.stringify(next, null, 2) + '\n');
    await fs.rename(`${lockPath}.tmp`, lockPath);
  }
  const result = { changed, tag: next.tag, commit: next.commit, version: next.version };
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) await fs.appendFile(process.env.GITHUB_OUTPUT,
    Object.entries(result).map(([key, value]) => `${key}=${value}\n`).join(''));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
