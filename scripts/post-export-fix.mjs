// Post-export fixer for Cloudflare Pages deploys of an Expo web export.
//
// ROOT CAUSE (see AUDIT.md): `wrangler pages deploy` refuses to upload any
// path containing "node_modules" (its default ignore rules), and Expo's web
// export puts bundled fonts/images at dist/assets/node_modules/... . Result:
// every icon font 404s into the SPA fallback (index.html served as the font
// URL) -> invisible icons.
//
// FIX: after `expo export`, move dist/assets/node_modules -> dist/vendor and
// rewrite the URL prefix "assets/node_modules/" to "vendor/" inside every
// built .js bundle. Also asserts the SPA fallback and app-link files exist.
//
// Run: node scripts/post-export-fix.mjs   (wired into `npm run build:web`)

import { readdirSync, renameSync, readFileSync, writeFileSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
if (!existsSync(dist)) {
  console.error('[post-export] dist/ not found — run `npx expo export --platform web` first');
  process.exit(1);
}

// 1. Move assets/node_modules -> vendor (depth: only the one expo creates).
const src = join(dist, 'assets', 'node_modules');
const dst = join(dist, 'vendor');
if (existsSync(src)) {
  renameSync(src, dst);
  rmSync(src, { recursive: true, force: true });
  console.log('[post-export] moved assets/node_modules -> vendor');
} else if (existsSync(dst)) {
  console.log('[post-export] vendor/ already in place');
} else {
  console.error('[post-export] neither assets/node_modules nor vendor/ found — unexpected export layout');
  process.exit(1);
}

function rmrfSafe(p) {
  // minimal recursive delete using only rename-safe ops
  import('node:fs').then(({ rmSync }) => rmSync(p, { recursive: true, force: true }));
}

// 2. Rewrite URL prefixes in every .js/.css under dist (incl. _expo chunks).
let files = 0, hits = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(js|css)$/.test(name)) continue;
    const buf = readFileSync(p, 'utf8');
    if (buf.includes('assets/node_modules/')) {
      const out = buf.split('assets/node_modules/').join('vendor/');
      writeFileSync(p, out);
      files++; hits += buf.split('assets/node_modules/').length - 1;
    }
  }
};
walk(dist);
console.log(`[post-export] rewrote ${hits} asset URL(s) in ${files} bundle file(s)`);

// 3. Sanity checks that Cloudflare needs.
const mustExist = ['index.html', '_redirects', join('.well-known', 'assetlinks.json'), join('.well-known', 'apple-app-site-association')];
const missing = mustExist.filter((f) => !existsSync(join(dist, f)));
if (missing.length) {
  console.warn('[post-export] WARNING missing in dist/: ' + missing.join(', '));
} else {
  console.log('[post-export] SPA fallback + app-link files present ✔');
}
