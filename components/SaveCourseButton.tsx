import { useEffect, useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSavedCourseIds, toggleSavedCourse } from '../lib/localPreferences';
import { theme } from '../constants/theme';
import { Pop } from './motion';
import { tapFeedback } from '../lib/haptics';

export function SaveCourseButton({ courseId, size = 20, onChange }: { courseId: string; size?: number; onChange?: (saved: boolean) => void }) {
  const [saved, setSaved] = useState(false);
  useEffect(() => { getSavedCourseIds().then(ids => setSaved(ids.includes(courseId))); }, [courseId]);
  return (
    <Pressable
      onPress={async () => { void tapFeedback(); const ids = await toggleSavedCourse(courseId); setSaved(ids.includes(courseId)); onChange?.(ids.includes(courseId)); }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Remove course from saved' : 'Save course'}
    >
      <Pop trigger={saved}><Ionicons name={saved ? 'bookmark' : 'bookmark-outline'} size={size} color={saved ? theme.colors.primary : theme.colors.textMuted} /></Pop>
    </Pressable>
  );
}
