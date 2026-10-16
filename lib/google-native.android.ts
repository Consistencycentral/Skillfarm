// @ts-ignore React Native Google Sign-In is installed when the native build is prepared.
import { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { supabase } from './supabase';

// This is the WEB OAuth client ID generated for the SkillFarm Firebase project.
// It is intentionally used here (not the Android client ID) because Supabase
// validates the Google ID token issued for the web audience.
const GOOGLE_WEB_CLIENT_ID =
  '987642843599-sbfnb2v6dc89tn8pt1m423s2vc5hsint.apps.googleusercontent.com';

let configured = false;

function configureGoogle() {
  if (configured) return;
  GoogleSignin.configure({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    scopes: ['email', 'profile'],
    offlineAccess: false,
  });
  configured = true;
}

export async function signInWithGoogleNative(): Promise<{ ok: true } | { ok: false; cancelled: boolean; message?: string }> {
  configureGoogle();

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    if (!isSuccessResponse(response)) {
      return { ok: false, cancelled: true };
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      return { ok: false, cancelled: false, message: 'Google did not return an ID token.' };
    }

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) throw error;
    return { ok: true };
  } catch (error: any) {
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        return { ok: false, cancelled: true };
      }
      if (error.code === statusCodes.IN_PROGRESS) {
        return { ok: false, cancelled: false, message: 'Google sign-in is already in progress.' };
      }
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { ok: false, cancelled: false, message: 'Google Play Services is unavailable or needs an update.' };
      }
    }

    const raw = String(error?.message ?? '');
    if (/DEVELOPER_ERROR|developer console is not set up correctly|\b10\b/i.test(raw)) {
      // Not a code bug: the SHA-1/SHA-256 of the key that signed THIS build is
      // not registered in Firebase for com.skillfarm.app. See FIXES_20261009.md.
      return {
        ok: false,
        cancelled: false,
        message: 'Google sign-in is not configured for this app build yet. Please sign in with email for now, or contact support.',
      };
    }

    return { ok: false, cancelled: false, message: raw || 'Google sign-in failed.' };
  }
}
