export async function signInWithGoogleNative(): Promise<{ ok: false; cancelled: boolean; message?: string }> {
  return { ok: false, cancelled: false, message: 'Native Google sign-in is configured for Android in this build.' };
}
