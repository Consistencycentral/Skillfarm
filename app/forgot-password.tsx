// ===========================================================================
// Forgot Password — collects the email and asks Supabase to send a recovery
// link. The link's redirect target is the app's own reset-password route (built
// via expo-linking so it matches the configured `skillfarm` scheme), so tapping
// the email link re-opens the app on the right screen. session.tsx picks up the
// PASSWORD_RECOVERY auth event and routes to /reset-password.
// ===========================================================================
import { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, Keyboard
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { authRedirectUrl } from '../lib/deeplink';
import { FormScreen } from '../components/FormScreen';
import { theme } from '../constants/theme';
import { Alert } from '../lib/alert';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    const cleanEmail = email.trim().toLowerCase();
    if (!/.+@.+\..+/.test(cleanEmail)) {
      Alert.alert('Enter an email', 'Type the email you signed up with.');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      // Web-first redirect: once EXPO_PUBLIC_SITE_URL is deployed, the emailed
      // link is https://yoursite/reset-password — it opens on ANY device the
      // user checks mail on, the browser app there completes the reset, and
      // they then sign into the phone app with the new password. Until a site
      // is set it falls back to this device's own app link.
      const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: authRedirectUrl('/reset-password'),
      });
      if (error) throw error;
      setSent(true);
    } catch (err: any) {
      Alert.alert('Could not send link', err?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormScreen contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Reset your password</Text>

        {sent ? (
          <>
            <Text style={styles.body}>
              If an account exists for {'\u201C'}{email.trim()}{ '\u201D' }, we sent a
              password-reset link to it. Open the link on this device to choose a new
              password — then tap the button below.
            </Text>
            <Pressable style={styles.primaryBtn} onPress={() => router.replace('/reset-password')}>
              <Text style={styles.primaryBtnText}>I opened the link — set new password</Text>
            </Pressable>
            <Pressable style={styles.switchBtn} onPress={() => router.replace('/login')}>
              <Text style={styles.switchText}>Back to sign in</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Enter your account email and we{ '\u2019' }ll send you a link to choose a
              new password.
            </Text>

            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <Pressable
              style={[styles.primaryBtn, loading && styles.btnDisabled]}
              onPress={handleSubmit}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>Send reset link</Text>
              )}
            </Pressable>

            <Pressable style={styles.switchBtn} onPress={() => router.replace('/login')}>
              <Text style={styles.switchText}>Back to sign in</Text>
            </Pressable>
          </>
        )}
      </View>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.colors.background },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 20 },
  title: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginBottom: 8 },
  body: { fontSize: 14, color: theme.colors.textMuted, lineHeight: 20, marginBottom: 8 },
  label: { fontSize: 13, color: theme.colors.textMuted, marginTop: 12, marginBottom: 4 },
  input: {
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md,
    paddingHorizontal: 12, paddingVertical: 12, fontSize: theme.font.body,
    backgroundColor: theme.colors.surfaceAlt,
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary, borderRadius: theme.radius.md,
    paddingVertical: 14, alignItems: 'center', marginTop: 20,
  },
  btnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  switchBtn: { marginTop: 16, alignItems: 'center' },
  switchText: { color: theme.colors.primary, fontSize: 14 },
});
