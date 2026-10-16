// ===========================================================================
// Entry route. Two personas:
//
//  • NATIVE (the app): a gate that fires before any other screen and redirects
//    not signed in -> /login, no role -> /role-select, student ->
//    /(student)/browse, provider -> /(provider)/home. Session and role come
//    from the shared SessionProvider (the root layout already reads them).
//
//  • WEB (expo export -web / npx expo start --web): an unauthenticated visitor
//    sees the public marketing landing page with the live course catalog
//    (public_courses view — supabase/public_catalog.sql). Signing in works on
//    web too; the same gate then applies. A course deep link opened on web
//    while signed out lands here, so the CTA button is the exit.
// ===========================================================================
import { useEffect, useState } from 'react';
import { Redirect, router } from 'expo-router';
import { View, ActivityIndicator, StyleSheet, Platform, Text } from 'react-native';
import { useSession } from '../lib/session';
import { listPublicCourses, type LandingCourse } from '../api/landing';
import { LandingContent } from '../components/LandingContent';
import { theme } from '../constants/theme';
import { BrandMark } from '../components/ui';

export default function Index() {
  const { session, role, loading } = useSession();

  // ---- Web-only public landing ------------------------------------------
  const isWebLanding = Platform.OS === 'web' && !session;
  const [publicCourses, setPublicCourses] = useState<LandingCourse[] | null>(null);
  const [landingError, setLandingError] = useState<string | null>(null);
  useEffect(() => {
    if (!isWebLanding) return;
    listPublicCourses()
      .then(setPublicCourses)
      .catch((e) => {
        // A failed catalog fetch must not blank the page: fall through to the
        // empty state below, which still renders the hero + sign-in CTA.
        setPublicCourses([]);
        console.warn('[landing] public catalog unavailable:', e?.message ?? e);
      });
  }, [isWebLanding]);

  if (isWebLanding) {
    if (publicCourses === null) {
      return (
        <View style={styles.center}>
          <BrandMark size="lg" stacked />
          <ActivityIndicator size="large" color={theme.colors.primary} />
        </View>
      );
    }
    return <LandingContent courses={publicCourses} onGetStarted={() => router.push('/login')} />;
  }

  // ---- Native / signed-in gate ------------------------------------------
  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
      </View>
    );
  }

  if (!session) return <Redirect href="/login" />;
  // No profile row, or a role the app does not recognise — make them pick.
  if (!role) return <Redirect href="/role-select" />;
  return <Redirect href={role === 'student' ? '/(student)/browse' : '/(provider)/home'} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background, gap: 16 },
  logo: { fontSize: 32, fontWeight: '800', color: theme.colors.primary },
});
