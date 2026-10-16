// Saved courses — shows ONLY the courses the learner bookmarked.
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { listCourses, type CourseWithProvider } from '../../api/courses';
import { listNextBatchesForCourses, type Batch } from '../../api/batches';
import { getSavedCourseIds } from '../../lib/localPreferences';
import { CourseCard } from '../../components/CourseCard';
import { EmptyState } from '../../components/EmptyState';
import { theme } from '../../constants/theme';

export default function SavedScreen() {
  const [courses, setCourses] = useState<CourseWithProvider[]>([]);
  const [next, setNext] = useState<Record<string, Batch | null>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setLoadError(null);
    try {
      const [all, savedIds] = await Promise.all([listCourses(), getSavedCourseIds()]);
      const byId = new Map(all.map((c) => [c.id, c]));
      const saved = savedIds.map((id) => byId.get(id)).filter(Boolean) as CourseWithProvider[];
      setCourses(saved);
      setNext(saved.length ? await listNextBatchesForCourses(saved.map((c) => c.id)) : {});
    } catch (e: any) {
      setCourses([]);
      setLoadError(e?.message ?? 'Could not load your saved courses.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <FlatList
      data={courses}
      keyExtractor={(i) => i.id}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[theme.colors.primary]} />}
      ListHeaderComponent={
        <View style={styles.headingRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>Saved courses</Text>
            <Text style={styles.sub}>
              {courses.length
                ? `${courses.length} course${courses.length === 1 ? '' : 's'} you bookmarked.`
                : 'Courses you bookmark will appear here.'}
            </Text>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <CourseCard
          course={item}
          nextBatch={next[item.id] ?? null}
          onSavedChange={(saved) => { if (!saved) setCourses((prev) => prev.filter((c) => c.id !== item.id)); }}
        />
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <EmptyState
            icon={loadError ? 'cloud-offline' : 'bookmark-outline'}
            title={loadError ? 'Could not load saved courses' : 'Nothing saved yet'}
            subtitle={loadError ?? 'Tap the bookmark on a course to save it here.'}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 30, backgroundColor: theme.colors.background },
  headingRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 10 },
  heading: { fontSize: 28, fontWeight: '800', color: theme.colors.text },
  sub: { fontSize: 13, lineHeight: 19, color: theme.colors.textMuted, marginTop: 4 },
  empty: { minHeight: 150, justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
