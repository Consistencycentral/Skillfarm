// ===========================================================================
// courseShareUrl — the URL a learner should receive when a course is shared
// (WhatsApp/SMS/copy). Two shapes depending on configuration:
//
//   • If EXPO_PUBLIC_SITE_URL is set (e.g. https://skillfarm.app once the web
//     export is deployed), sharing produces a normal https link. Clicking it on
//     a phone opens the website; the website is the same app bundle
//     (expo export -web), so signed-in users land straight on the course, and
//     signed-out visitors see the landing and sign in.
//
//   • Without a deployed site (today: Expo Go pilot), we fall back to the
//     app's own deep link, built with expo-linking so it always matches the
//     `skillfarm` scheme declared in app.json. Expo Go registers that scheme,
//     so on a device that has the project open the link jumps straight into the
//     Course Details screen. A device without the app simply can't open it —
//     which is exactly why setting EXPO_PUBLIC_SITE_URL is the upgrade path.
// ===========================================================================
import { createURL } from 'expo-linking';
import { Platform } from 'react-native';

// Root cause of the "share still shows the Netlify link" bug: the web export
// is built WITHOUT EXPO_PUBLIC_SITE_URL injected (local `expo export` doesn't
// read eas.json), so SITE_URL was undefined and shares fell back to
// createURL()/stale env values. The production web origin is stable, so it is
// inlined as the fallback — same env-first + inlined-fallback pattern as
// lib/supabase.ts. On native the env var (injected by EAS) still wins so a
// custom domain can replace pages.dev without a code change.
const INLINED_SITE_URL = 'https://skillfarm.pages.dev';

const SITE_URL: string | undefined =
  process.env.EXPO_PUBLIC_SITE_URL ??
  // On web there is exactly one correct answer: the origin the site is
  // actually served from — even if someone previews a build elsewhere.
  (Platform.OS === 'web' && typeof window !== 'undefined'
    ? window.location.origin
    : INLINED_SITE_URL);

export function courseShareUrl(id: string): string {
  // Deployed web origin wins (universal link, opens app or falls back to web).
  if (SITE_URL) return `${SITE_URL.replace(/\/+$/, '')}/course/${id}`;
  return createURL(`/course/${id}`);
}

/**
 * Shareable organization link. Same web-first resolution as courseShareUrl:
 * with a deployed site, tapping "Share" on a Learning Partner's card sends
 * everyone an https://yoursite/org/<id> page that works in any browser.
 */
export function orgShareUrl(id: string): string {
  if (SITE_URL) return `${SITE_URL.replace(/\/+$/, '')}/org/${id}`;
  return createURL(`/org/${id}`);
}

/** Absolute URL of the public web landing, for email/footer copy. */
export function siteUrl(): string {
  return SITE_URL ?? createURL('/');
}

/**
 * Auth redirect URL (password recovery). Prefers the deployed web origin:
 * a reset email must open on whatever device the user checks it on — their
 * phone, a laptop, a friend's tablet — which a native-only scheme link or a
 * localhost dev URL cannot do. Once EXPO_PUBLIC_SITE_URL is set, requests
 * sent from the APK point at https://yoursite/reset-password; the user sets
 * the new password in the web app (same Supabase project, same session
 * model) and then just signs into the app with the new password. Falls back
 * to the in-app deep link while no site is deployed yet (dev on localhost).
 */
export function authRedirectUrl(path: string): string {
  if (SITE_URL) return `${SITE_URL.replace(/\/+$/, '')}${path}`;
  return createURL(path);
}
