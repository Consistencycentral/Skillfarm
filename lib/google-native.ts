// Platform-neutral fallback. Android uses google-native.android.ts via React Native's platform resolver.
// Login currently calls native Google Sign-In only on Android; other platforms use Supabase OAuth.
export async function signInWithGoogleNative(): Promise<{ ok: true } | { ok: false; cancelled: boolean; message?: string }> {
  return { ok: false, cancelled: false, message: 'Native Google Sign-In is available only in the Android app build.' };
}
