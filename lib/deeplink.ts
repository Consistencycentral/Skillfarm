// ===========================================================================
// Share URLs — the link a learner receives when a course, an organisation or
// a ticket is shared (WhatsApp / SMS / copy-link).
//
// HISTORY / ROOT CAUSE (do not regress):
//   This module used to read EXPO_PUBLIC_SITE_URL and nothing else. That env
//   var was baked as https://skillfarm.netlify.app into the APK that is
//   installed on users' phones, so shares kept emitting dead Netlify links
//   long after the site moved to Cloudflare Pages. Local `expo export` for
//   web does not read eas.json at all, so the web build saw no value and fell
//   back to bare scheme links.
//
//   Fix = three layers, strongest last:
//     1. env var, but SANITISED — a netlify host is never honoured;
//     2. on web, the true runtime origin (window.location.origin);
//     3. inlined production origin, used by any native build.
//   Any legacy *.netlify.app string that still arrives from stored data or an
//   old OTA bundle is rewritten to the Cloudflare origin by canonicalShareUrl.
// ===========================================================================
import { createURL } from 'expo-linking';
import { Platform } from 'react-native';

/** Canonical production web origin (Cloudflare Pages). */
export const PROD_SITE_URL = 'https://skillfarm.pages.dev';

/** Hosts that must never appear in a share link again. */
const DEAD_HOST_PATTERN = /(^|\.)skillfarm\.netlify\.app$/i;

/** Strip trailing slashes so callers can concatenate safely. */
const trimSlash = (u: string): string => u.replace(/\/+$/, '');

/** True when the string is an http(s) URL we are willing to share. */
function isUsableOrigin(value: string | undefined | null): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    return !DEAD_HOST_PATTERN.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Resolve the share origin once, at module load.
 * Never throws; never returns a dead Netlify host.
 */
const SITE_URL: string = (() => {
  const fromEnv = process.env.EXPO_PUBLIC_SITE_URL;
  if (isUsableOrigin(fromEnv)) return trimSlash(fromEnv);

  // Web: the origin the bundle is actually being served from is always right.
  if (Platform.OS === 'web' && typeof window !== 'undefined' && isUsableOrigin(window.location.origin)) {
    return trimSlash(window.location.origin);
  }

  return PROD_SITE_URL;
})();

/**
 * Rewrite any legacy/dead share URL to the canonical Cloudflare origin.
 * Used on values that come from stored data (org website fields, old shares
 * saved in a database row) so a Netlify link can never leak out again.
 */
export function canonicalShareUrl(url: string): string {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (DEAD_HOST_PATTERN.test(parsed.hostname)) {
      return `${PROD_SITE_URL}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return url;
  } catch {
    // Not an absolute URL (scheme link such as skillfarm://course/1) — leave it.
    return url;
  }
}

/** Public, shareable URL for a course. */
export function courseShareUrl(id: string): string {
  return `${SITE_URL}/course/${id}`;
}

/** Public, shareable URL for a Learning Partner (organisation) page. */
export function orgShareUrl(id: string): string {
  return `${SITE_URL}/org/${id}`;
}

/** Public URL of the web landing page, for email/footer copy. */
export function siteUrl(): string {
  return SITE_URL;
}

/**
 * Auth redirect URL (Google OAuth + password recovery). Must be the deployed
 * https origin: a reset mail has to open on whatever device the user checks it
 * on, which a native-only scheme link cannot do.
 */
export function authRedirectUrl(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `${SITE_URL}${suffix}`;
}

/** Kept for callers that still want the expo-linking form (dev only). */
export function appSchemeUrl(path: string): string {
  return createURL(path);
}