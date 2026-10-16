import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RegistrationWithCourse } from '../api/registrations';
import { isPushActive } from './pushNotifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function prepareLocalNotifications() {
  const permissions = await Notifications.getPermissionsAsync();
  if (!permissions.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    if (!requested.granted) return false;
  }
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('training-reminders', {
      name: 'Training reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: undefined,
    });
  }
  return true;
}

function reminderId(registrationId: string, hours: number) {
  return `skillfarm-training-${registrationId}-${hours}h`;
}

/** Schedule on-device reminders; these work even when the app is closed/offline. */
export async function syncTrainingReminders(registrations: RegistrationWithCourse[]) {
  if (Platform.OS === 'web') return;
  const ok = await prepareLocalNotifications();
  if (!ok) return;

  // Rebuild the reminder set from the current registrations. This prevents a
  // cancelled/rejected registration from leaving behind an old reminder, and
  // also removes reminders for registrations that disappeared from the list.
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((item) => item.identifier.startsWith('skillfarm-training-'))
      .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier).catch(() => {})),
  );

  for (const reg of registrations) {
    if (reg.status !== 'registered' || !reg.batch?.start_date) continue;
    const start = new Date(reg.batch.start_date);
    if (Number.isNaN(start.getTime())) continue;
    // Batches currently store a date (not a start time), so use a predictable
    // 09:00 local reminder anchor instead of firing at midnight.
    start.setHours(9, 0, 0, 0);

    for (const hours of [24, 1]) {
      const trigger = new Date(start.getTime() - hours * 60 * 60 * 1000);
      if (trigger.getTime() <= Date.now()) continue;
      const id = reminderId(reg.id, hours);
      await Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
      await Notifications.scheduleNotificationAsync({
        identifier: id,
        content: {
          title: hours === 24 ? 'SkillFarm training tomorrow' : 'SkillFarm training starts soon',
          body: `${reg.course.title}${reg.assigned_seat_number ? ` · Seat ${reg.assigned_seat_number}` : ''}`,
          data: { registrationId: reg.id, type: 'training-reminder' },
        },
        trigger: Platform.OS === 'android'
          ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger, channelId: 'training-reminders' }
          : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: trigger },
      });
    }
  }
}

const APPROVED_SEEN_KEY = 'skillfarm.approvedSeen.v1';

/**
 * Local "your QR ticket is ready" alert. Compares the learner's approved seats with
 * the ones already seen on this device; the first run only records them (no spam).
 * Works while the app is open or alive in the background. When real push is active on
 * this device (lib/pushNotifications.ts) this stays silent so alerts are not doubled.
 */
export async function notifyNewlyApproved(registrations: RegistrationWithCourse[], userId: string) {
  if (Platform.OS === 'web') return;
  const key = `${APPROVED_SEEN_KEY}.${userId}`;
  const approved = registrations.filter((r) => r.status === 'registered');
  let seen: string[] | null = null;
  try { const raw = await AsyncStorage.getItem(key); seen = raw ? (JSON.parse(raw) as string[]) : null; } catch { seen = null; }

  if (seen === null) {
    try { await AsyncStorage.setItem(key, JSON.stringify(approved.map((r) => r.id))); } catch {}
    return;
  }
  const fresh = approved.filter((r) => !seen!.includes(r.id));
  if (fresh.length === 0) return;
  try { await AsyncStorage.setItem(key, JSON.stringify(Array.from(new Set([...seen, ...approved.map((r) => r.id)])))); } catch {}

  // Real push already tells this learner (also when the app is closed). Showing the
  // on-device alert as well would make every approval pop up twice.
  if (await isPushActive(userId)) return;

  const ok = await prepareLocalNotifications();
  if (!ok) return;
  for (const reg of fresh) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Seat approved — your QR ticket is ready',
        body: `${reg.course.title}. Tap to open your attendance ticket.`,
        data: { registrationId: reg.id, type: 'ticket-ready' },
      },
      trigger: null,
    }).catch(() => {});
  }
}
