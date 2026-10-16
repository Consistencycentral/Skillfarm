// ===========================================================================
// Cross-platform Alert.
//
// react-native-web implements Alert.alert as an empty function, so every error
// message, confirmation and "are you sure?" dialog in the app silently did
// nothing in a browser — and destructive confirmations (delete course, cancel
// registration, sign out) never fired their onPress. This wrapper keeps the
// exact React Native signature, delegates to the real Alert on iOS/Android, and
// on web maps it onto window.alert / window.confirm.
//
//   • 0 or 1 button  -> window.alert, then run that button's onPress
//   • 2+ buttons     -> window.confirm. OK runs the first non-cancel button,
//                       Cancel runs the 'cancel' button's onPress (if any).
// ===========================================================================
import { Alert as RNAlert, Platform, type AlertButton, type AlertOptions } from 'react-native';

function webAlert(title: string, message?: string, buttons?: AlertButton[]) {
  const text = message ? `${title}\n\n${message}` : title;
  const list = buttons ?? [];

  if (list.length <= 1) {
    window.alert(text);
    list[0]?.onPress?.();
    return;
  }

  const cancel = list.find((b) => b.style === 'cancel');
  const confirmBtn = list.find((b) => b.style !== 'cancel') ?? list[0];
  if (window.confirm(text)) confirmBtn.onPress?.();
  else cancel?.onPress?.();
}

// Database errors that mean "the one-time SQL update has not been applied yet".
// Show a clear instruction instead of a raw Postgres message.
function friendlyMessage(message?: string) {
  if (message && /stack depth limit exceeded/i.test(message)) {
    return 'The database needs a one-time update (supabase/migrations/20261013_client_fixes_v6.sql). Ask the SkillFarm admin to run it in Supabase → SQL Editor, then try again.';
  }
  return message;
}

export const Alert = {
  alert(title: string, rawMessage?: string, buttons?: AlertButton[], options?: AlertOptions) {
    const message = friendlyMessage(rawMessage);
    if (Platform.OS === 'web') webAlert(title, message, buttons);
    else RNAlert.alert(title, message, buttons, options);
  },
};
