import * as Haptics from 'expo-haptics';

export async function tapFeedback() {
  try { await Haptics.selectionAsync(); } catch {}
}
export async function successFeedback() {
  try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } catch {}
}
export async function errorFeedback() {
  try { await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); } catch {}
}
