// ===========================================================================
// Reset Password — step 2 of the forgot-password flow. Reached when the user
// taps the recovery link in their email: GoTrue verifies the token in the
// browser and redirects to skillfarm://reset-password#access_token=...
// session.tsx consumes that fragment via setSession(), so by the time this
// screen is mounted the user holds a short-lived RECOVERY session and the only
// thing left to do is updateUser({ password }).
// ===========================================================================
import { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ActivityIndicator, Keyboard
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { FormScreen } from '../components/FormScreen';
import { FocusGroup, FocusTextInput as TextInput } from '../components/ui';
import { theme } from '../constants/theme';
import { Alert } from '../lib/alert';

export default function ResetPasswordScreen() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const { session, refresh } = useSession();

  // Not signed in with a recovery session: either the email link was never
  // opened on this device or its token expired (1 hour). Send them back to the
  // start of the flow instead of letting updateUser fail cryptically.
  if (!session) {
    return (
      <FormScreen contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Open your reset link first</Text>
          <Text style={styles.body}>
            This screen only works right after you tap the password-reset link we
            emailed you, on this device. Open the link and return — or start over:
          </Text>
          <Pressable style={styles.primaryBtn} onPress={() => router.replace('/forgot-password')}>
            <Text style={styles.primaryBtnText}>Send a new reset link</Text>
          </Pressable>
          <Pressable style={styles.switchBtn} onPress={() => router.replace('/login')}>
            <Text style={styles.switchText}>Back to sign in</Text>
          </Pressable>
        </View>
      </FormScreen>
    );
  }

  async function handleSubmit() {
    // Same 8-char floor as sign-up, and keep the two boxes in sync.
    if (password.length < 8) {
      Alert.alert('Weak password', 'Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Passwords do not match', 'Re-enter the same password in both fields.');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      // updateUser keeps the session alive; the next refresh() reads the real
      // role from profiles so the gate can send them to the right tab group.
      await refresh();
      Alert.alert('Password updated', 'You are signed in with your new password.', [
        { text: 'OK', onPress: () => router.replace('/') },
      ]);
    } catch (err: any) {
      Alert.alert('Could not reset password', err?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <FormScreen contentContainerStyle={styles.container}>
      <FocusGroup>
      <View style={styles.card}>
        <Text style={styles.title}>Choose a new password</Text>
        <Text style={styles.body}>Signed in as {session.user.email}</Text>

        <Text style={styles.label}>New password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry
        />

        <Text style={styles.label}>Confirm new password</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          placeholder="••••••••"
          secureTextEntry
        />
        <Text style={styles.hint}>At least 8 characters.</Text>

        <Pressable
          style={[styles.primaryBtn, loading && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>Update password</Text>
          )}
        </Pressable>
      </View>
      </FocusGroup>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, backgroundColor: theme.colors.background },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 20 },
  title: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginBottom: 8 },
  body: { fontSize: 14, color: theme.colors.textMuted, lineHeight: 20, marginBottom: 4 },
  label: { fontSize: 13, color: theme.colors.textMuted, marginTop: 12, marginBottom: 4 },
  hint: { fontSize: 12, color: theme.colors.textMuted, marginTop: 4 },
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
