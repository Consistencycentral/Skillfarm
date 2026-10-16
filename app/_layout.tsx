// ===========================================================================
// Root layout — owns the session/role guard for the whole app.
//
// Before this, both tab groups were registered unconditionally, so a learner
// could deep-link straight into /(provider)/home and drive the partner UI. RLS
// stopped them reading anyone else's data, but the screens still rendered and
// the role was effectively cosmetic. Stack.Protected removes a group from the
// navigation tree entirely when its guard is false, so those routes stop
// existing rather than merely being hidden.
// ===========================================================================
import { headerOptions } from '../constants/navStyle';
import { theme } from '../constants/theme';
import { Stack } from 'expo-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '../lib/queryClient';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Platform, View } from 'react-native';
import { SessionProvider, useSession } from '../lib/session';
import { LanguageProvider } from '../lib/language';
import { useLanguage } from '../lib/i18n';
import { BrandMark } from '../components/ui';
import { useFonts } from 'expo-font';
import { FONT_ASSETS, installTypography } from '../lib/typography';

function RootNavigator() {
  const { session, role, loading } = useSession();
  const { t } = useLanguage();

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background, gap: 20 }}>
        <BrandMark size="lg" stacked />
        <ActivityIndicator size="small" color={theme.colors.primary} />
      </View>
    );
  }

  const signedIn = Boolean(session);

  return (
    <Stack
      screenOptions={{
        ...headerOptions,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {/* The gate is always reachable — it decides where to send people. */}
      <Stack.Screen name="index" options={{ headerShown: false }} />

      {/* Password-reset flow. Both are UNCONDITIONAL: /forgot-password must be
          reachable from the sign-in screen, and /reset-password is the deep-link
          target of the recovery email (skillfarm://reset-password) which must
          resolve even though the user holds only a recovery session, not a
          normal signed-in one. The screens gate themselves on `session`. */}
      <Stack.Screen name="auth/callback" options={{ headerShown: false }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Reset password' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Choose a new password' }} />

      {/* Shareable web surfaces. Both are UNCONDITIONAL so a link opened by a
          signed-out visitor (WhatsApp on a friend's phone, a pasted URL in a
          browser) renders instead of bouncing to /login. Each screen reads the
          anon-safe public views and shows a "sign in to register" CTA when it
          has no session. course/[id]'s name must be the FULL route path —
          app/course has no _layout, so expo-router hoists it as "course/[id]". */}
      {/* Course detail draws its own transparent back/save/share buttons over the photo carousel. */}
      <Stack.Screen name="course/[id]" options={{ title: t.courseDetails, headerShown: false }} />
      <Stack.Screen name="materials/[courseId]" options={{ title: t.materials }} />
      <Stack.Protected guard={signedIn && role === 'student'}>
        <Stack.Screen name="payment/[id]" options={{ title: 'Payment' }} />
      </Stack.Protected>
      {/* QR deep link: self-gating (login / learner ticket / partner marks attendance). */}
      <Stack.Screen name="attendance/[id]" options={{ title: 'Attendance', headerShown: false }} />
      <Stack.Screen name="downloads/index" options={{ title: t.downloadedLearning }} />
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="ai-assistant" options={{ title: 'Ask SkillFarm', headerShown: false }} />
      </Stack.Protected>
      <Stack.Screen name="org/[id]" options={{ headerShown: false }} />
      <Stack.Protected guard={signedIn && role === 'student'}>
        <Stack.Screen name="ticket/[id]" options={{ title: 'My QR Ticket' }} />
      </Stack.Protected>

      <Stack.Screen name="language-select" options={{ title: t.chooseLanguage || 'Language' }} />

      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ title: 'SkillFarm' }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="role-select" options={{ title: t.roleTitle }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && role === 'student'}>
        <Stack.Screen name="(student)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && role === 'provider'}>
        <Stack.Screen name="(provider)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  // Inter + Noto Sans Tamil/Devanagari. Hold the first paint until they are in
  // (a few ms from cache) so text never visibly swaps from the system font.
  // If loading fails we still render — the system font is an acceptable fallback.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const fontsReady = fontsLoaded || !!fontError;
  if (fontsLoaded) installTypography();
  if (!fontsReady) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }
  return (
    <>
      <StatusBar style="dark" />
      {/* Web scroll fix (Bug 2). React Native Web renders every RN <View> as a
          <div> with `display:flex`. On web the DOM body defaults to
          height:100% with overflow:hidden semantics once a full-height flex
          child is in play, and RNW's #root is a fixed-height flex container —
          so a page longer than the viewport gets CLIPPED instead of scrolled.
          The style below restores normal document flow on web only: #root
          grows with its content (minHeight, not height) and the document is
          the scroller (overflow-y:auto). Native is untouched. */}
      {Platform.OS === 'web' && (
        // RNW's <style> element: scoped by default — dangerouslySetInnerHTML
        // plus a selector list that targets document-level nodes is how we
        // reach html/body/#root, which no RN component can style directly.
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body {
                height: auto !important;
                min-height: 100% !important;
                overflow-y: auto !important;
                overflow-x: hidden !important;
                -webkit-overflow-scrolling: touch;
              }
              #root {
                height: auto !important;
                min-height: 100vh !important;
                overflow-y: visible !important;
              }
              /* React Navigation's web wrapper also imposes a fixed-height
                 flex box; let it size to content so the page can grow. */
              #root > div {
                min-height: 100vh;
                height: auto;
                overflow-y: visible;
              }
            `,
          }}
        />
      )}
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <LanguageProvider>
            <RootNavigator />
          </LanguageProvider>
        </SessionProvider>
      </QueryClientProvider>
    </>
  );
}
