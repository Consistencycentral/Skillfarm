import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CourseMaterial } from '../api/materials';

const KEY = 'skillfarm.material-versions.v1';
export async function notifyMaterialUpdates(courseTitle: string, materials: CourseMaterial[]) {
  const raw = await AsyncStorage.getItem(KEY); let known: Record<string, number> = {};
  try { known = raw ? JSON.parse(raw) : {}; } catch {}
  const updates = materials.filter(m => known[m.id] != null && known[m.id] < m.version);
  for (const m of updates) {
    await Notifications.scheduleNotificationAsync({ content: {
      title: 'New learning material',
      body: `${courseTitle}: ${m.title} has been updated to v${m.version}. Download the new version when you are ready.`,
      data: { type: 'material-update', materialId: m.id, courseId: m.course_id },
    }, trigger: null }).catch(() => {});
  }
  for (const m of materials) known[m.id] = m.version;
  await AsyncStorage.setItem(KEY, JSON.stringify(known));
}
