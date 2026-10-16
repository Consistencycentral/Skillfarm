import AsyncStorage from '@react-native-async-storage/async-storage';

export async function cacheJson<T>(key: string, value: T) {
  try { await AsyncStorage.setItem(`skillfarm.cache.${key}`, JSON.stringify({ savedAt: Date.now(), value })); } catch {}
}
export async function readCachedJson<T>(key: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(`skillfarm.cache.${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.value as T;
  } catch { return null; }
}
