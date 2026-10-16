import { Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

/** Build the exact redirect URL used by Supabase OAuth/recovery callbacks. */
export function authRedirectUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return new URL('/auth/callback', window.location.origin).toString();
  }
  return Linking.createURL('auth/callback');
}

/**
 * Consume a Supabase auth callback URL when detectSessionInUrl is disabled.
 * Supports both PKCE (?code=...) and implicit (#access_token=...) callbacks.
 */
export async function consumeAuthCallbackUrl(url: string | null | undefined): Promise<boolean> {
  if (!url || !url.includes('auth/callback')) return false;
  try {
    const [beforeHash, hash = ''] = url.split('#');
    const query = beforeHash.split('?')[1] ?? '';

    if (query) {
      const params = new URLSearchParams(query);
      const code = params.get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;
        return true;
      }
    }

    if (hash) {
      const params = new URLSearchParams(hash);
      const access_token = params.get('access_token');
      const refresh_token = params.get('refresh_token');
      if (access_token && refresh_token) {
        const { error } = await supabase.auth.setSession({ access_token, refresh_token });
        if (error) throw error;
        return true;
      }
    }
  } catch (error) {
    if (__DEV__) console.warn('Auth callback could not be consumed', error);
  }
  return false;
}

export async function getInitialAuthCallbackUrl(): Promise<string | null> {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.href;
    return await Linking.getInitialURL();
  } catch {
    return null;
  }
}
