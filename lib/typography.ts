// Typography bootstrap (restored — this module was referenced by app/_layout.tsx
// but missing from the repository upload; see AUDIT.md).
//
// FONT_ASSETS: map handed to expo-font's useFonts(). The app renders with the
// platform system font stack by design (fast, zero download on rural data),
// so the map is intentionally empty — useFonts({}) resolves immediately and
// `fontsLoaded` becomes true on the first render.
//
// installTypography(): one-time global tweaks after fonts are ready. The
// react-native-web text rendering treats letterSpacing in em consistently, so
// this only needs to set the web flag that keeps numerals tabular inside
// price/seat-count badges. No-op on native.

import { Platform } from 'react-native';

export const FONT_ASSETS: Record<string, unknown> = {};

let installed = false;

export function installTypography(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.id = 'skillfarm-typography';
    style.textContent = `
      #root, #root button, #root input, #root textarea { font-variant-numeric: tabular-nums; }
    `;
    document.head.appendChild(style);
  }
}
