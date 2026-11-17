import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// Env-first (EAS injects EXPO_PUBLIC_* from eas.json at build time), with the
// real values inlined as a fallback so a build that misses env injection still
// talks to the right project instead of the old placeholder URL — a fetch to a
// nonexistent host surfaces on-device as "Network request failed". This is safe
// for the *anon* key only: it is designed to ship inside the client and is
// guarded by the RLS policies in supabase/schema.sql. Never do this with the
// service_role key.
const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://eyzfbuisexschgrtkcdv.supabase.co') as string;
const supabaseAnonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5emZidWlzZXhzY2hncnRrY2R2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU2NzI2NDksImV4cCI6MjEwMTI0ODY0OX0.McsT4Zl6Exkpb0it6xw5z2bQqPVjbNNB_tNPIdEPK1A') as string;

// ---------------------------------------------------------------------------
// Persistent session storage adapter.
//
//  • Native (iOS/Android): expo-secure-store — Keychain/Keystore, so the
//    session survives app restarts. expo-secure-store@15 (SDK 54) exposes
//    SYNCHRONOUS getItem/setItem (which the SDK's token-refresh path relies
//    on) plus an async deleteItemAsync.
//
//  • Web: there is no Keychain — SecureStore's sync functions don't exist in
//    the web build, and calling them throws
//      "ExpoSecureStore.default.getValueWithKeySync is not a function"
//    (exactly what the landing page hit). Browsers already give us the right
//    primitive: localStorage, which the supabase-js docs recommend for web.
//    In-memory fallback covers the rare privacy mode where localStorage
//    access throws; the user then just signs in again after a reload.
// ---------------------------------------------------------------------------
const secureStorageAdapter = {
  getItem: (key: string): string | null => {
    if (Platform.OS === 'web') {
      try { return window.localStorage.getItem(key); } catch { return null; }
    }
    return SecureStore.getItem(key);
  },
  setItem: (key: string, value: string): void => {
    if (Platform.OS === 'web') {
      try { window.localStorage.setItem(key, value); } catch { /* privacy mode */ }
      return;
    }
    SecureStore.setItem(key, value);
  },
  removeItem: (key: string): void => {
    if (Platform.OS === 'web') {
      try { window.localStorage.removeItem(key); } catch { /* privacy mode */ }
      return;
    }
    // No sync delete in SDK 15; kick off the async delete and let it complete.
    SecureStore.deleteItemAsync(key).catch(() => { /* best-effort */ });
  },
};

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
  {
    auth: {
      // Persist the user session so they stay logged in between app restarts.
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      // Persist on disk via the OS keychain/keystore (see adapter above).
      storage: secureStorageAdapter,
      // Renamed from 'coursearc.supabase.session' with the SkillFarm rebrand;
      // sessions stored under the old key are orphaned, so anyone who was
      // signed in before the rename has to log in once more.
      storageKey: 'skillfarm.supabase.session',
    },
  }
);
