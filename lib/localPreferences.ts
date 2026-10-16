import * as SecureStore from 'expo-secure-store';
import { supabase } from './supabase';

const KEY_PREFIX = 'skillfarm_pref_';

async function read(key: string): Promise<string[]> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(KEY_PREFIX + key);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(KEY_PREFIX + key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

async function write(key: string, ids: string[]) {
  const value = JSON.stringify(ids);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(KEY_PREFIX + key, value);
    } else {
      await SecureStore.setItemAsync(KEY_PREFIX + key, value);
    }
  } catch { /* preferences are non-critical */ }
}

// Saved courses are stored per signed-in learner. They used to live under one
// device-wide key, so a second account on the same phone/browser saw (and
// changed) the first account's bookmarks.
async function savedKey(): Promise<string> {
  try {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    return uid ? `saved_courses_${uid}` : 'saved_courses_guest';
  } catch { return 'saved_courses_guest'; }
}
export async function getSavedCourseIds() { return read(await savedKey()); }
export async function toggleSavedCourse(id: string) {
  const key = await savedKey();
  const ids = await read(key);
  const next = ids.includes(id) ? ids.filter(x => x !== id) : [id, ...ids];
  await write(key, next.slice(0, 100));
  return next;
}
export async function getRecentCourseIds() { return read('recent_courses'); }
export async function rememberRecentCourse(id: string) {
  const ids = await read('recent_courses');
  await write('recent_courses', [id, ...ids.filter(x => x !== id)].slice(0, 12));
}


// Account language is also cached locally so the UI keeps working when an older
// Supabase schema has not yet received profiles.preferred_language.
export async function getPreferredLanguageLocal(): Promise<'en'|'ta'|'hi'|null> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const v = window.localStorage.getItem(KEY_PREFIX + 'language');
      return v === 'en' || v === 'ta' || v === 'hi' ? v : null;
    }
    const v = await SecureStore.getItemAsync(KEY_PREFIX + 'language');
    return v === 'en' || v === 'ta' || v === 'hi' ? v : null;
  } catch { return null; }
}

export async function setPreferredLanguageLocal(lang: 'en'|'ta'|'hi'): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(KEY_PREFIX + 'language', lang);
    } else {
      await SecureStore.setItemAsync(KEY_PREFIX + 'language', lang);
    }
  } catch { /* local preference is non-critical */ }
}

// Returning users should land on "Sign in", not "Sign up". We remember (on this
// device only) that someone has signed in before.
export async function getHasSignedInBefore(): Promise<boolean> {
  return (await read('signed_in_before')).length > 0;
}
export async function markSignedInBefore(): Promise<void> {
  await write('signed_in_before', ['1']);
}
