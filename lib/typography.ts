// Typography + web-global affordances applied once at startup.
//
// FONT_ASSETS: map handed to expo-font's useFonts(). The app deliberately
// renders with the platform system font stack (fast, zero download on rural
// data), so the map is empty and `fontsLoaded` flips true on first render.
//
// installTypography(): web-only global CSS for things react-native-web does not
// give us for free:
//   • visible keyboard focus ring on every focusable element (WCAG 2.4.7 —
//     without it, tab navigation is invisible),
//   • tabular numerals so fee/seat counters do not jitter,
//   • prefers-reduced-motion respect for the animated helpers.
// No-op on native (RN handles focus and numerals itself).

import { Platform } from 'react-native';

export const FONT_ASSETS = {} as Record<string, never>;

let installed = false;

export function installTypography(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;

  const style = document.createElement('style');
  style.id = 'skillfarm-globals';
  style.textContent = `
    /* Tabular numerals: fee, seat and count columns stop shifting. */
    #root, #root button, #root input, #root textarea {
      font-variant-numeric: tabular-nums;
    }

    /* Keyboard focus: react-native-web renders Pressables as <div role=button>
       or <a>, and browsers only show a ring for some of them. Force a
       consistent, high-contrast ring — never on mouse clicks. */
    #root :focus { outline: none; }
    #root :focus-visible {
      outline: 2px solid #1F6B45;
      outline-offset: 2px;
      border-radius: 8px;
    }
    #root [role="button"]:focus-visible,
    #root a:focus-visible,
    #root input:focus-visible,
    #root textarea:focus-visible,
    #root [tabindex]:focus-visible {
      outline: 2px solid #1F6B45;
      outline-offset: 2px;
    }

    /* Audio/video and smooth scrolling obey the OS preference. */
    @media (prefers-reduced-motion: reduce) {
      #root * {
        animation-duration: 0.001ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.001ms !important;
        scroll-behavior: auto !important;
      }
    }

    /* Screen-reader-only utility, mirrors RN's accessibilityElementsHidden. */
    .sf-sr-only {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
      border: 0;
    }
  `;
  document.head.appendChild(style);
}