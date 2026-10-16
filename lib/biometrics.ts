import * as LocalAuthentication from 'expo-local-authentication';

export async function canUseBiometrics() {
  try {
    const hardware = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    return hardware && enrolled;
  } catch { return false; }
}

export async function authenticateSensitiveAction(reason = 'Confirm this action securely') {
  try {
    const available = await canUseBiometrics();
    if (!available) return true;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success;
  } catch { return false; }
}
