import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  type TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { useSession } from '../lib/session';
import { FormScreen } from '../components/FormScreen';
import { theme } from '../constants/theme';
import { getMyProfile, ensureProfile } from '../api/profile';
import { getPreferredLanguageLocal, getHasSignedInBefore, markSignedInBefore } from '../lib/localPreferences';
import { buildLabel } from '../lib/buildInfo';
import { authRedirectUrl, consumeAuthCallbackUrl } from '../lib/auth-callback';
import { signInWithGoogleNative } from '../lib/google-native';
import { Alert } from '../lib/alert';
import { Button } from '../components/Button';
import { BrandMark, Field, Segmented } from '../components/ui';
import { FadeInView } from '../components/motion';

// v12.4: Android's autofill dropdown (the floating email-suggestion card) pulls
// focus away from the field, which then hops Name -> Phone -> Email -> Name by
// itself while the screen scrolls after it. Switch autofill OFF on every input,
// for both Sign in and Sign up. (Spread it LAST so nothing overrides it.)
const NO_AUTOFILL = {
  autoComplete: 'off',
  importantForAutofill: 'noExcludeDescendants',
  textContentType: 'none',
  autoCorrect: false,
  spellCheck: false,
} as const;

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const { refresh } = useSession();
  const [oauthLoading, setOauthLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // v12.13: the saved "has signed in before" flag is read asynchronously. It used to flip
  // Sign up -> Sign in AFTER the user had already tapped a field, which unmounted the focused
  // input and killed the keyboard. The form is now drawn only once the mode is known.
  const [modeReady, setModeReady] = useState(false);

  // v12.12: keyboard "Next" key moves Name -> Phone -> Email -> Password -> Confirm,
  // and "Done" submits. No focus-guard / forced focus() tricks any more.
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  // Shared-link return target: /course/[id] renders read-only for visitors and
  // sends them here with ?next=/course/<id> when they tap "Sign in to
  // register". Whitelisted to our two public share routes only — a hand-typed
  // or attacker-supplied next must never be passed to router.replace.
  const params = useLocalSearchParams<{ next?: string; mode?: string }>();
  const nextHref =
    typeof params.next === 'string' && /^\/(course|org)\/[\w-]+$/.test(params.next)
      ? params.next
      : null;

  useEffect(() => {
    if (params.mode === 'signup') { setMode('signup'); setModeReady(true); }
    else if (params.mode === 'signin') { setMode('signin'); setModeReady(true); }
  }, [params.mode]);

  // First open on a phone that has signed in before -> start on "Sign in".
  useEffect(() => {
    if (params.mode === 'signup' || params.mode === 'signin') return;
    let alive = true;
    const done = setTimeout(() => { if (alive) setModeReady(true); }, 1500); // never block the screen
    void getHasSignedInBefore()
      .then((b) => { if (alive && b) setMode('signin'); })
      .catch(() => {})
      .finally(() => { if (alive) { clearTimeout(done); setModeReady(true); } });
    return () => { alive = false; clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleCallback = async (url: string) => {
      if (!url.includes('auth/callback')) return;
      setOauthLoading(true);
      const consumed = await consumeAuthCallbackUrl(url);
      if (!consumed) { setOauthLoading(false); return; }
      const { data } = await supabase.auth.getUser();
      if (data.user) await ensureProfile(data.user);
    void markSignedInBefore();
      await refresh();
      const profile = await getMyProfile();
      const localLang = await getPreferredLanguageLocal();
      setOauthLoading(false);
      if (!localLang) router.replace('/language-select');
      else if (!profile?.onboarding_complete) router.replace('/role-select');
      else router.replace(nextHref ?? '/');
    };
    const sub = Linking.addEventListener('url', ({ url }) => { void handleCallback(url); });
    void Linking.getInitialURL().then((url) => { if (url) void handleCallback(url); });
    return () => sub.remove();
  }, [nextHref, refresh]);

  async function finishGoogleSession() {
    const { data } = await supabase.auth.getUser();
    if (data.user) await ensureProfile(data.user);
    void markSignedInBefore();
    await refresh();
    const profile = await getMyProfile();
    const localLang = await getPreferredLanguageLocal();
    if (!localLang) { router.replace('/language-select'); return; }
    if (!profile?.onboarding_complete) { router.replace('/role-select'); return; }
    router.replace(nextHref ?? '/');
  }

  async function handleGoogleSignIn() {
    setOauthLoading(true);
    try {
      // Android uses the Firebase-configured native Google Sign-In module and
      // exchanges the Google ID token for a Supabase Auth session. This keeps
      // Supabase as the actual auth/RLS identity for the rest of the app.
      if (Platform.OS === 'android') {
        const result = await signInWithGoogleNative();
        if (!result.ok) {
          if (result.cancelled) { setOauthLoading(false); return; }
          throw new Error(result.message ?? 'Google sign-in failed.');
        }
        await finishGoogleSession();
        setOauthLoading(false);
        return;
      }

      // Web keeps the existing Supabase OAuth callback flow. iOS also keeps
      // this fallback until an iOS GoogleService-Info.plist is provided.
      const redirectTo = authRedirectUrl();
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) {
        const message = error.message ?? '';
        if (/provider is not enabled/i.test(message) || /unsupported provider/i.test(message)) {
          throw new Error(
            'Google sign-in is not enabled in the SkillFarm Supabase project yet. Open Supabase → Authentication → Providers → Google, enable Google, and add the Google Web Client ID and Client Secret.'
          );
        }
        throw error;
      }
      if (!data?.url) throw new Error('Google sign-in could not start.');

      if (typeof window !== 'undefined' && window.location) {
        window.location.assign(data.url);
      } else {
        await Linking.openURL(data.url);
      }
    } catch (err: any) {
      setOauthLoading(false);
      Alert.alert('Google sign-in', err?.message ?? 'Could not start Google sign-in.');
    }
  }

  async function handleSubmit() {
    // Normalize once. Supabase treats "You@X.com" and "you@x.com" as the same
    // account, but a stray leading space or capital in the sign-in field reads
    // to the user as a wrong address. Trim + lowercase before we do anything.
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = fullName.trim();
    const cleanPhone = phone.trim();

    if (!cleanEmail || !password) {
      Alert.alert('Missing info', 'Please enter both email and password.');
      return;
    }
    if (mode === 'signup') {
      if (!cleanName) {
        Alert.alert('Missing name', 'Please enter your full name.');
        return;
      }
      // Supabase's own minimum is 6; ask for 8 so a pilot account isn't trivially
      // guessable. Kept as a length check only — no character-class rules that
      // would frustrate the target users on a phone keyboard.
      if (password.length < 8) {
        Alert.alert('Weak password', 'Please use at least 8 characters.');
        return;
      }
      if (password !== confirmPassword) {
        Alert.alert('Passwords do not match', 'Re-enter the same password in both fields.');
        return;
      }
    }
    setLoading(true);
    try {
      if (mode === 'signup') {
        // 1) Create the auth user, attaching metadata the trigger *would* use.
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { full_name: cleanName, phone: cleanPhone } },
        });
        if (error) throw error;

        if (!data.user) throw new Error('Account could not be created.');

        // With email confirmation enabled, Supabase can return an existing
        // account from signUp() without a useful error. Such a user can have
        // an empty identities array, which must NOT be treated as a new
        // registration. Send them to Sign in instead.
        const identities = Array.isArray(data.user.identities) ? data.user.identities : null;
        if (identities && identities.length === 0) {
          setMode('signin');
          setPassword('');
          setConfirmPassword('');
          Alert.alert(
            'Account already exists',
            'This email is already registered. Please sign in with your existing password.'
          );
          return;
        }

        if (data.session) {
          await ensureProfile(data.user, cleanPhone);
          void markSignedInBefore();
          await refresh();
          router.replace('/language-select');
        } else {
          Alert.alert('Check your email', 'Your account was created. Confirm your email, then return here and sign in.');
          setMode('signin');
          setPassword('');
          setConfirmPassword('');
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        if (!data.user) throw new Error('Sign-in did not create a session.');
        void markSignedInBefore();
        await ensureProfile(data.user);
        await refresh();
        const profile = await getMyProfile();
        const localLang = await getPreferredLanguageLocal();
        if (!localLang) { router.replace('/language-select'); return; }
        if (!profile?.onboarding_complete) { router.replace('/role-select'); return; }
        // Return through the gate so returning users land in the tabs for the
        // role they already chose — unless they came from a shared link, in
        // which case nextHref brings them straight back to that course/org.
        router.replace(nextHref ?? '/');
      }
    } catch (err: any) {
      const message = String(err?.message ?? '');
      const code = String(err?.code ?? '');
      const alreadyExists =
        code === 'user_already_exists' ||
        /user already registered|already registered|already exists|email.*already/i.test(message);
      if (mode === 'signup' && alreadyExists) {
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        Alert.alert(
          'Email already registered',
          'An account already exists with this email. Please sign in with your existing password.'
        );
      } else if (/jwt issued at future/i.test(message)) {
        // A stale browser session can survive after a clock mismatch. Clear the
        // local Supabase session so the next sign-in gets a fresh server-issued
        // token instead of looping on the same JWT.
        await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        Alert.alert(
          'Session refreshed',
          'Your previous session was invalid. Please sign in again with your existing password.'
        );
      } else {
        Alert.alert('Authentication failed', /failed to fetch|network request failed/i.test(message || '') ? 'Cannot reach the server. Check your internet, and that the Supabase project is not paused.' : (message || 'Something went wrong.'));
      }
    } finally {
      setLoading(false);
    }
  }

  const isSignup = mode === 'signup';
  const switchMode = (m: 'signin' | 'signup') => {
    if (m === mode) return;
    // No Keyboard.dismiss() here: blurring makes Android hand focus to the first input and
    // pop the keyboard open again on a different field.
    setConfirmPassword('');
    setMode(m);
  };

  if (!modeReady) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }

  return (
    <FormScreen style={{ backgroundColor: theme.colors.background }} contentContainerStyle={styles.container}>
      <FadeInView style={styles.hero}>
        <BrandMark size="lg" stacked />
        <Text style={styles.tagline}>Learn farming skills, hands-on{'\n'}with trusted partners near you.</Text>
      </FadeInView>

      <View style={styles.card}>
        <Segmented
          value={mode}
          onChange={switchMode}
          options={[{ value: 'signup', label: 'Sign up' }, { value: 'signin', label: 'Sign in' }]}
        />

        <Text style={styles.title}>{isSignup ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>
          {isSignup ? 'Takes less than a minute.' : 'Sign in to continue to your courses.'}
        </Text>

        <Pressable
          style={({ pressed }) => [styles.googleBtn, pressed && { backgroundColor: theme.colors.background }, oauthLoading && styles.btnDisabled]}
          onPress={handleGoogleSignIn}
          disabled={oauthLoading}
          accessibilityRole="button"
          accessibilityLabel="Continue with Google"
        >
          {oauthLoading ? <ActivityIndicator color={theme.colors.text} /> : (
            <>
              <Ionicons name="logo-google" size={18} color="#DB4437" />
              <Text style={styles.googleText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <View style={styles.dividerRow}>
          <View style={styles.divider} /><Text style={styles.dividerText}>or use email</Text><View style={styles.divider} />
        </View>

        {isSignup && (
          <>
            <Field label="Full name" icon="person-outline" value={fullName} onChangeText={setFullName} placeholder="Your name" autoCapitalize="words" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => phoneRef.current?.focus()} {...NO_AUTOFILL} />
            <Field label="Phone (optional)" icon="call-outline" inputRef={phoneRef} value={phone} onChangeText={setPhone} placeholder="9876543210" keyboardType="phone-pad" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => emailRef.current?.focus()} {...NO_AUTOFILL} />
          </>
        )}

        <Field label="Email" icon="mail-outline" inputRef={emailRef} value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} {...NO_AUTOFILL} />

        <Field
          label="Password"
          icon="lock-closed-outline"
          inputRef={passwordRef}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          {...(isSignup
            ? { returnKeyType: 'next' as const, submitBehavior: 'submit' as const, onSubmitEditing: () => confirmRef.current?.focus() }
            : { returnKeyType: 'done' as const, submitBehavior: 'submit' as const, onSubmitEditing: () => { void handleSubmit(); } })}
          {...NO_AUTOFILL}
          hint={isSignup ? 'At least 8 characters.' : undefined}
          right={
            <Pressable onPress={() => setShowPassword((v) => !v)} hitSlop={10} accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSubtle} />
            </Pressable>
          }
        />

        {isSignup && (
          <Field label="Confirm password" icon="lock-closed-outline" inputRef={confirmRef} value={confirmPassword} onChangeText={setConfirmPassword} placeholder="••••••••" secureTextEntry={!showPassword} autoCapitalize="none" returnKeyType="done" submitBehavior="submit" onSubmitEditing={() => { void handleSubmit(); }} {...NO_AUTOFILL} />
        )}

        {!isSignup && (
          <Pressable onPress={() => router.push('/forgot-password')} style={styles.forgotRow} hitSlop={8}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        )}

        <View style={{ marginTop: 22 }}>
          <Button label={isSignup ? 'Create account' : 'Sign in'} size="lg" fullWidth loading={loading} onPress={handleSubmit} />
        </View>
      </View>

      <Text style={styles.legal}>By continuing you agree to use SkillFarm responsibly.</Text>
      <Text style={styles.build}>{buildLabel()}</Text>

    </FormScreen>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingVertical: 32, maxWidth: 520, width: '100%', alignSelf: 'center' },
  hero: { alignItems: 'center', marginBottom: 28 },
  tagline: { ...theme.type.body, color: theme.colors.textMuted, textAlign: 'center', marginTop: 14 },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.xl + 4, padding: 22, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.raised, shadowOpacity: 0.08 },
  title: { ...theme.type.h1, color: theme.colors.text, marginTop: 22 },
  subtitle: { ...theme.type.body, color: theme.colors.textMuted, marginTop: 4, marginBottom: 18 },
  googleBtn: { flexDirection: 'row', gap: 10, minHeight: 50, borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.radius.md + 2, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  googleText: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 18, marginBottom: 2 },
  divider: { flex: 1, height: 1, backgroundColor: theme.colors.border },
  dividerText: { ...theme.type.caption, color: theme.colors.textSubtle },
  forgotRow: { alignSelf: 'flex-end', marginTop: 12 },
  forgotText: { color: theme.colors.primary, fontSize: 13.5, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  build: { fontSize: 12, fontWeight: '600', color: theme.colors.textMuted, textAlign: 'center', marginTop: 8 },
  legal: { ...theme.type.caption, color: theme.colors.textSubtle, textAlign: 'center', marginTop: 20 },
});
