// Shows exactly which build / JS bundle is running (used on the login screen).
// Bump APP_BUILD on every release so "which APK is on this phone?" is never a guess.
// (Deliberately a plain constant - Constants.expoConfig can be stale in Metro's cache.)
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';

export const APP_BUILD = 'v1.7.4 · build 12.14';

export function buildLabel(): string {
  let src = '';
  try {
    if (Platform.OS !== 'web') {
      src = Updates.isEmbeddedLaunch ? 'built-in' : `update ${String(Updates.updateId ?? '').slice(0, 6)}`;
    }
  } catch { /* updates module not available (dev client / web) */ }
  return ['SkillFarm', APP_BUILD, src].filter(Boolean).join(' · ');
}
