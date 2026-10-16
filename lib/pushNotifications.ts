// ===========================================================================
// Real push notifications (Expo Push Service).
//
// The device registers its Expo push token with Supabase (register_push_token).
// A database trigger + the `send-push` Edge Function then deliver "Seat approved",
// "Request not approved" and "A seat opened up" even when the app is closed.
//
// This does NOT work in Expo Go (Android) — it needs a real build (EAS). In Expo
// Go, or if the learner refuses permission, registerForPush() returns null and the
// older on-device alerts (lib/localNotifications.ts) keep working while the app is open.
// ===========================================================================
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const PUSH_CHANNEL_ID = 'seat-updates';
const STORAGE_KEY = 'skillfarm.pushToken.v1';

type Stored = { token: string; userId: string };

async function readStored(): Promise<Stored | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch { return null; }
}

/** True when this device is registered for real push for this learner. */
export async function isPushActive(userId: string): Promise<boolean> {
  const stored = await readStored();
  return !!stored && stored.userId === userId;
}

async function clearStored() {
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/** Ask permission, get the Expo push token and save it for this signed-in user. */
export async function registerForPush(userId: string): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(PUSH_CHANNEL_ID, {
        name: 'Seat updates',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) perm = await Notifications.requestPermissionsAsync();
    if (!perm.granted) { await clearStored(); return null; }

    const projectId =
      (Constants.expoConfig?.extra as any)?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
    if (!projectId) return null;

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return null;

    const stored = await readStored();
    if (!stored || stored.token !== token || stored.userId !== userId) {
      const { data, error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
      if (error) throw error;
      if (data && (data as any).ok === false) throw new Error((data as any).error ?? 'Could not register push token.');
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ token, userId } satisfies Stored));
    }
    return token;
  } catch (e: any) {
    // Expo Go (Android), no network, or the push SQL has not been run yet:
    // never block the app. The local alerts stay as the fallback.
    console.warn('Push registration skipped:', e?.message ?? e);
    await clearStored();
    return null;
  }
}

/** Call before signing out so the next person on this phone gets no old pushes. */
export async function unregisterPush(): Promise<void> {
  const stored = await readStored();
  if (!stored) return;
  try { await supabase.rpc('unregister_push_token', { p_token: stored.token }); } catch { /* offline */ }
  await clearStored();
}
