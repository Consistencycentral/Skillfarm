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

// 3. Prune icon fonts from families the app never imports.
//    @expo/vector-icons barrel-imports every family's TTF (~4 MB of dead
//    weight per deploy) even though only the families named in our own source
//    are actually rendered. We scan app/ components/ lib/ for family names and
//    keep only those fonts, so adding e.g. FontAwesome later keeps working
//    automatically.
const FAMILIES = [
  'Ionicons', 'MaterialIcons', 'MaterialCommunityIcons', 'Feather', 'EvilIcons',
  'FontAwesome', 'FontAwesome5', 'FontAwesome6', 'AntDesign', 'Entypo',
  'Fontisto', 'Foundation', 'Octicons', 'SimpleLineIcons', 'Zocial',
];
const sourceText = [];
const readSources = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { readSources(p); continue; }
    if (/\.(ts|tsx|js|jsx)$/.test(name)) sourceText.push(readFileSync(p, 'utf8'));
  }
};
for (const d of ['app', 'components', 'lib', 'constants']) readSources(join(root, d));
const srcText = sourceText.join('\n');
const usedFamilies = FAMILIES.filter((f) => new RegExp(`\\b${f}\\b`).test(srcText));
console.log(`[post-export] icon families used: ${usedFamilies.join(', ') || 'none'}`);

let kept = 0, removed = 0, removedBytes = 0;
const pruneFonts = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { pruneFonts(p); continue; }
    if (!/\.(ttf|otf|woff2?)$/i.test(name)) continue;
    const used = usedFamilies.some((f) => name.startsWith(f));
    if (used) { kept++; continue; }
    removedBytes += statSync(p).size;
    rmSync(p, { force: true });
    removed++;
  }
};
const fontRoot = join(dist, 'vendor');
if (existsSync(fontRoot) && usedFamilies.length) {
  pruneFonts(fontRoot);
  console.log(`[post-export] fonts kept ${kept}, pruned ${removed} (-${(removedBytes / 1024 / 1024).toFixed(2)} MB)`);
}

// 4. Sanity checks that Cloudflare needs.
const mustExist = ['index.html', '_redirects', join('.well-known', 'assetlinks.json'), join('.well-known', 'apple-app-site-association')];
const missing = mustExist.filter((f) => !existsSync(join(dist, f)));
if (missing.length) {
  console.warn('[post-export] WARNING missing in dist/: ' + missing.join(', '));
} else {
  console.log('[post-export] SPA fallback + app-link files present ✔');
}
