export async function signInWithGoogleNative(): Promise<{ ok: false; cancelled: boolean; message?: string }> {
  return { ok: false, cancelled: false, message: 'Use the web OAuth flow.' };
}
