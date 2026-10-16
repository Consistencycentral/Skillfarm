import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSession } from '../../lib/session';
import { getMyProfile, ensureProfile } from '../../api/profile';
import { getPreferredLanguageLocal } from '../../lib/localPreferences';
import { supabase } from '../../lib/supabase';
import { consumeAuthCallbackUrl, getInitialAuthCallbackUrl } from '../../lib/auth-callback';
import { theme } from '../../constants/theme';

export default function AuthCallback() {
  const { refresh } = useSession();
  useEffect(() => {
    let alive = true;
    (async () => {
      const initialUrl = await getInitialAuthCallbackUrl();
      if (initialUrl?.includes('auth/callback')) await consumeAuthCallbackUrl(initialUrl);
      await refresh();
      if (!alive) return;
      const { data } = await supabase.auth.getUser();
      if (!data.user) { router.replace('/login'); return; }
      await ensureProfile(data.user);
      const profile = await getMyProfile();
      const localLang = await getPreferredLanguageLocal();
      if (!alive) return;
      if (!localLang) router.replace('/language-select');
      else if (!profile?.onboarding_complete) router.replace('/role-select');
      else if (profile.role === 'student') router.replace('/(student)/browse');
      else if (profile.role === 'provider') router.replace('/(provider)/home');
      else router.replace('/role-select');
    })().catch(() => { if (alive) router.replace('/login'); });
    return () => { alive = false; };
  }, [refresh]);
  return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /><Text style={styles.text}>Completing Google sign-in…</Text></View>;
}
const styles=StyleSheet.create({center:{flex:1,alignItems:'center',justifyContent:'center',backgroundColor:theme.colors.background,gap:12},text:{color:theme.colors.textMuted,fontSize:14}});
