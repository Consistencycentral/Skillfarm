// Polls EAS for build 2261ef9e (versionCode 33) and prints the artifact URL
// when it finishes. Uses the Expo GraphQL API with the CLI's stored session,
// so it never needs a TTY (the CLI wrapper refuses to run piped).

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BUILD_ID = '2261ef9e-7cb5-486a-acdd-1f9ed80a4bc8';

function readToken() {
  const candidates = [
    join(homedir(), '.expo', 'state.json'),
    join(process.env.LOCALAPPDATA ?? '', 'expo', 'state.json'),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const j = JSON.parse(readFileSync(p, 'utf8'));
      const t =
        j?.auth?.sessionSecret ??
        j?.['auth.sessionSecret'] ??
        (Array.isArray(j?.auth) ? j.auth[0]?.sessionSecret : null);
      if (t) return t;
    } catch { /* try next */ }
  }
  return null;
}

const token = readToken();
if (!token) {
  console.log('NO_TOKEN — cannot poll; check the build page manually');
  process.exit(1);
}

const QUERY = `
query Build($id: ID!) {
  build(id: $id) {
    id
    status
    platform
    appBuildVersion
    completedAt
    expirationDate
    artifacts { buildUrl applicationArchiveUrl }
  }
}`;

async function fetchBuild() {
  const res = await fetch('https://api.expo.dev/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: QUERY, variables: { id: BUILD_ID } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
  return json.data?.build ?? null;
}

let last = '';
for (let i = 0; i < 180; i++) {
  let b = null;
  try {
    b = await fetchBuild();
  } catch (e) {
    console.log('poll error:', e.message);
  }
  const status = b?.status ?? 'UNKNOWN';
  if (status !== last) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${status}`);
    last = status;
  }
  if (status === 'FINISHED') {
    console.log('DONE');
    console.log('ARTIFACT_URL=' + (b.artifacts?.buildUrl ?? ''));
    console.log('VERSION_CODE=' + b.appBuildVersion);
    console.log('EXPIRES=' + b.expirationDate);
    process.exit(0);
  }
  if (status === 'ERRORED' || status === 'CANCELED') {
    console.log('FAILED ' + status);
    process.exit(2);
  }
  await new Promise((r) => setTimeout(r, 30000));
}
console.log('TIMEOUT last=' + last);
process.exit(3);