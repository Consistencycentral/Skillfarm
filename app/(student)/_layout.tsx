import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Tabs, router } from 'expo-router';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUnreadUpdates } from '../../lib/updatesSeen';
import { theme } from '../../constants/theme';
import { useSession } from '../../lib/session';
import { listMyRegistrations } from '../../api/registrations';
import { notifyNewlyApproved } from '../../lib/localNotifications';
import { registerForPush } from '../../lib/pushNotifications';
import { TabIcon } from '../../components/motion';
import { useTabOptions } from '../../constants/navStyle';
import { useLanguage } from '../../lib/i18n';

type PushData = { registrationId?: string; type?: string } | undefined;
let lastHandledNotification: string | null = null;

/** Opens the right screen when the learner taps a notification (also from a closed app). */
function openFromNotification(resp: Notifications.NotificationResponse | null | undefined) {
  if (!resp) return;
  const id = resp.notification.request.identifier;
  if (id === lastHandledNotification) return;
  lastHandledNotification = id;
  const data = resp.notification.request.content.data as PushData;
  if (data?.type === 'ticket-ready' && data.registrationId) {
    router.push(`/ticket/${data.registrationId}` as any);
  } else if (data?.type === 'seat-opened' || data?.type === 'request-rejected') {
    router.push('/(student)/my-registrations' as any);
  }
}

/**
 * Registers this phone for real push, watches for partner approvals while the app is
 * open (fallback when push is not available, e.g. Expo Go) and opens the right screen
 * when a notification is tapped.
 */
function useApprovalWatcher() {
  const { session } = useSession();
  const userId = session?.user?.id;
  useEffect(() => {
    if (!userId || Platform.OS === 'web') return;
    let alive = true;
    const check = async () => {
      if (AppState.currentState !== 'active') return;
      try { const regs = await listMyRegistrations(userId); if (alive) await notifyNewlyApproved(regs, userId); } catch { /* offline */ }
    };
    // Register for push first so the local fallback knows whether to stay silent.
    void registerForPush(userId).finally(() => { if (alive) void check(); });
    const timer = setInterval(check, 45_000);
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => openFromNotification(resp));
    // App was closed and opened by tapping a notification.
    void Promise.resolve(Notifications.getLastNotificationResponse?.()).then((resp) => { if (alive) openFromNotification(resp); }).catch(() => {});
    return () => { alive = false; clearInterval(timer); sub.remove(); };
  }, [userId]);
}

export default function StudentTabs() {
  const tabOptions = useTabOptions();
  const { t } = useLanguage();
  useApprovalWatcher();
  const { session } = useSession();
  const unread = useUnreadUpdates(session?.user?.id);
  return (
    <Tabs
      screenOptions={tabOptions}
    >
      <Tabs.Screen
        name="browse"
        options={{
          title: t.home,
          tabBarIcon: ({ color, focused }) => <TabIcon name="home" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="saved"
        options={{
          title: t.saved,
          tabBarIcon: ({ color, focused }) => <TabIcon name="bookmark" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="my-registrations"
        options={{
          title: t.registrations,
          tabBarIcon: ({ color, focused }) => <TabIcon name="ticket" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t.updates,
          tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: theme.colors.danger, color: '#fff', fontSize: 10, fontWeight: '800' },
          tabBarIcon: ({ color, focused }) => <TabIcon name="notifications" color={color} focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t.profile,
          tabBarIcon: ({ color, focused }) => <TabIcon name="person" color={color} focused={focused} />,
        }}
      />
      {/* Courses is no longer a tab: it is the "See all" list that Home opens (hidden route, back arrow). */}
      <Tabs.Screen
        name="courses"
        options={{
          href: null,
          title: t.courses,
          headerLeft: () => (
            <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/(student)/browse' as any))} hitSlop={10} style={{ paddingHorizontal: 14 }} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="arrow-back" size={22} color={theme.colors.primary} />
            </Pressable>
          ),
        }}
      />
    </Tabs>
  );
}
