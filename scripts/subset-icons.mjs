// Subsets the Ionicons TTF to only the glyphs this app actually uses.
//
// WHY: @expo/vector-icons ships the full Ionicons font (389 KB / ~1300 glyphs).
// The app references ~150 of them, so 95% of that download is dead weight on
// the critical path — it is fetched before the first icon can paint.
//
// HOW: every glyph name that appears as a string anywhere in app/, components/,
// lib/ or constants/ is kept. That intentionally over-includes (dynamic names
// built from template literals still match because their fragments appear in
// source), trading a few KB for never showing a tofu box.
//
// Runs after post-export-fix.mjs (which moves the fonts to dist/vendor) and
// keeps the hashed filename, so bundle URLs stay valid.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const subsetFont = require('subset-font');
const subset = subsetFont.default ?? subsetFont;

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// ---- 1. Collect the source text -------------------------------------------
const sources = [];
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (/\.(ts|tsx|js|jsx)$/.test(name)) sources.push(readFileSync(p, 'utf8'));
  }
};
for (const d of ['app', 'components', 'lib', 'constants']) walk(join(root, d));
// Also scan the built bundle, but ONLY for icon props (`name:"leaf"`), never
// for raw string presence: the bundle embeds the full glyph table, so a naive
// match would "use" all 1357 glyphs.
const bundleNames = new Set();
const bundleDir = join(dist, '_expo', 'static', 'js', 'web');
if (existsSync(bundleDir)) {
  for (const name of readdirSync(bundleDir)) {
    if (!name.endsWith('.js')) continue;
    const js = readFileSync(join(bundleDir, name), 'utf8');
    for (const m of js.matchAll(/name:"([a-z0-9-]{2,40})"/g)) bundleNames.add(m[1]);
  }
}
const src = sources.join('\n');

// ---- 2. Glyph map ----------------------------------------------------------
const GLYPHMAP_CANDIDATES = [
  'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
  'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json',
  'node_modules/react-native-vector-icons/glyphmaps/Ionicons.json',
];
const glyphmapPath = GLYPHMAP_CANDIDATES.map((p) => join(root, p)).find(existsSync);
if (!glyphmapPath) {
  console.log('[subset-icons] glyph map not found — skipped');
  process.exit(0);
}
const glyphmap = JSON.parse(readFileSync(glyphmapPath, 'utf8'));

// Keep every glyph whose name appears in source. Single-word names like "add"
// or "close" would match too broadly, so they are matched as quoted strings.
const used = new Set();
for (const name of Object.keys(glyphmap)) {
  const quoted = new RegExp(`["'\`]${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}["'\`]`);
  if (quoted.test(src) || bundleNames.has(name)) used.add(name);
}
if (used.size === 0) {
  console.log('[subset-icons] no glyphs detected — skipped (safety)');
  process.exit(0);
}

// Always keep the status icons + a handful of UI fallbacks, since those names
// reach the font through the theme map rather than a literal at the call site.
for (const g of ['checkmark-circle', 'time', 'hourglass', 'ribbon', 'close-circle', 'ban',
                 'alert-circle', 'information-circle', 'refresh', 'ellipsis-horizontal']) {
  if (glyphmap[g] !== undefined) used.add(g);
}

const unicodes = [...used].map((n) => glyphmap[n]);
console.log(`[subset-icons] ${used.size} glyphs of ${Object.keys(glyphmap).length} in use`);

// ---- 3. Subset every Ionicons TTF in the deploy ---------------------------
const fonts = [];
const findFonts = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { findFonts(p); continue; }
    if (/^Ionicons\..*\.ttf$/i.test(name)) fonts.push(p);
  }
};
findFonts(join(dist, 'vendor'));
if (fonts.length === 0) {
  console.log('[subset-icons] no Ionicons TTF in dist/vendor — skipped');
  process.exit(0);
}

for (const fontPath of fonts) {
  const before = statSync(fontPath).size;
  const input = readFileSync(fontPath);
  // subset-font signature: subsetFont(buffer, text, options)
  const chars = [...used].map((n) => String.fromCodePoint(glyphmap[n])).join('');
  const out = await subset(input, chars, {
    targetFormat: 'truetype',
    preserveNameIds: [1, 2, 6],
  });
  // Verify the result is smaller before replacing, otherwise keep the original.
  if (out.length > 0 && out.length < before) {
    const tmp = `${fontPath}.subset`;
    writeFileSync(tmp, out);
    renameSync(tmp, fontPath);
    console.log(
      `[subset-icons] ${basename(fontPath)}: ${(before / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB ` +
      `(-${(100 - (out.length / before) * 100).toFixed(0)}%)`
    );
  } else {
    console.log(`[subset-icons] ${basename(fontPath)}: subset not smaller, kept original`);
  }
}