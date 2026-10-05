export function parseCandidateTag(tag) {
  const match = /^android-v(\d+\.\d+\.\d+)-([1-9]\d*)$/.exec(tag || '');
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > 2100000000) {
    throw new Error('invalid candidate tag');
  }
  return { version: match[1], code: Number(match[2]) };
}

export function allocateVersionCode(current, run, releases) {
  const used = releases.map(release => /^(?:inputs-)?android-v\d+\.\d+\.\d+-([1-9]\d*)$/.exec(release.tag_name)?.[1])
    .filter(Boolean).map(Number);
  const next = Math.max(current + 1, 100000 + run, ...used.map(code => code + 1));
  if (!Number.isSafeInteger(current) || current < 1 || !Number.isSafeInteger(run) || run < 1 ||
      !Number.isSafeInteger(next) || next > 2100000000) throw new Error('versionCode overflow or invalid counter');
  return next;
}

export function verifyPackage(metadata, badging, tag) {
  const expected = parseCandidateTag(tag);
  const actual = /^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/m.exec(badging);
  if (metadata.game?.version !== expected.version || metadata.mobile?.versionCode !== expected.code) {
    throw new Error('candidate metadata does not match its release tag');
  }
  if (!actual || actual[1] !== metadata.mobile.applicationId || Number(actual[2]) !== expected.code ||
      actual[3] !== expected.version) {
    throw new Error('actual APK package or version does not match candidate metadata');
  }
}

export function verifyPromotion(releases, tag) {
  const candidate = parseCandidateTag(tag);
  if (!releases.some(release => release.tag_name === tag && release.draft && !release.prerelease)) {
    throw new Error('promotion requires an existing draft candidate');
  }
  const publishedCodes = releases.filter(release => !release.draft && !release.prerelease)
    .map(release => /^android-v\d+\.\d+\.\d+-([1-9]\d*)$/.exec(release.tag_name)?.[1])
    .filter(Boolean).map(Number);
  if (candidate.code <= Math.max(0, ...publishedCodes)) {
    throw new Error('candidate versionCode must exceed every published Android release');
  }
}
