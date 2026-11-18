// Generates dist/sitemap.xml from Supabase's PUBLIC views after an export.
//
// Static hosting has no server to enumerate URLs, so the sitemap is built at
// deploy time from the same public_courses / public_orgs views the landing page
// reads. If the network call fails the script keeps the last good sitemap
// instead of shipping an empty one (SEO-safe).
//
// Run: node scripts/gen-sitemap.mjs   (wired into `npm run build:web`)

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SITE = 'https://skillfarm.pages.dev';

// Public anon key: it already ships inside the web bundle and the APK.
// Read from eas.json so there is exactly one copy of the value in the repo.
let anonKey = '';
try {
  const eas = JSON.parse(readFileSync(join(root, 'eas.json'), 'utf8'));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === 'EXPO_PUBLIC_SUPABASE_ANON_KEY' && typeof v === 'string' && v.length > 100) anonKey ||= v;
      else walk(v);
    }
  };
  walk(eas);
} catch { /* fall through */ }

const SB = 'https://eyzfbuisexschgrtkcdv.supabase.co';

async function rows(path) {
  const res = await fetch(`${SB}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const urlTag = (loc, priority, changefreq = 'weekly') =>
  `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;

async function main() {
  if (!anonKey) throw new Error('anon key not found in eas.json');

  const [courses, orgs] = await Promise.all([
    rows('public_courses?select=id&limit=2000'),
    rows('public_orgs?select=id&limit=2000'),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urlTag(`${SITE}/`, '1.0', 'daily'),
    ...courses.map((c) => urlTag(`${SITE}/course/${c.id}`, '0.8')),
    ...orgs.map((o) => urlTag(`${SITE}/org/${o.id}`, '0.6')),
    '</urlset>',
    '',
  ].join('\n');

  writeFileSync(join(dist, 'sitemap.xml'), body);
  console.log(`[sitemap] ${courses.length} courses + ${orgs.length} orgs + landing (${today})`);
}

main().catch((err) => {
  const existing = join(dist, 'sitemap.xml');
  if (existsSync(existing)) {
    console.warn(`[sitemap] kept previous sitemap (${err.message})`);
  } else {
    // Minimal valid fallback so the URL never 404s.
    writeFileSync(
      join(dist, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${SITE}/</loc></url>\n</urlset>\n`
    );
    console.warn(`[sitemap] wrote fallback (${err.message})`);
  }
});