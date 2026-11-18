// ===========================================================================
// Provider Courses — list this provider's courses with seat usage + an
// "Add course" button that jumps to the add/edit form. Each row links to
// the edit form.
// ===========================================================================
import { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listMyCourses, deleteCourse, CATEGORY_LABELS, sectorColor, seatsLeft, type Course } from '../../api/courses';
import { getMyProfile } from '../../api/profile';
import { courseShareUrl } from '../../lib/deeplink';
import { supabase } from '../../lib/supabase';
import { listBatches, type Batch } from '../../api/batches';
import { listAllCourseRatings, type CourseRatingMap } from '../../api/reviews';
import { EmptyState } from '../../components/EmptyState';
import { Button } from '../../components/Button';
import { ShareButton } from '../../components/ShareButton';
import { theme } from '../../constants/theme';
import { Alert } from '../../lib/alert';
import { useLanguage } from '../../lib/i18n';

export default function ProviderCoursesScreen() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Public-listing switch from the org profile. Shown here because this is the
  // screen where "why aren't my courses in Browse?" gets asked.
  const [active, setActive] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [batchCounts, setBatchCounts] = useState<Record<string, number>>({});
  const [ratings, setRatings] = useState<CourseRatingMap>({});
  const { t } = useLanguage();

  // isRefresh (from pull-to-refresh) skips the full-screen spinner. Kept out of
  // the dep array so `load`'s identity is stable and the focus effect fires once.
  const load = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setLoadError(null);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const rows = await listMyCourses(u.user.id);
      setCourses(rows);
      const me = await getMyProfile().catch(() => null);
      setActive(me?.is_active ?? true);
      const counts: Record<string, number> = {};
      await Promise.all(rows.map(async (c) => {
        try { counts[c.id] = (await listBatches(c.id)).length; } catch { counts[c.id] = 0; }
      }));
      setBatchCounts(counts);
      // Ratings are best-effort: a reviews-table problem must not hide the courses.
      setRatings(await listAllCourseRatings(rows.map((c) => c.id)).catch(() => ({})));
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load your courses.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function handleDelete(course: Course) {
    Alert.alert('Delete course?', `"${course.title}" and all its registrations will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteCourse(course.id);
            load();
          } catch (e: any) {
            Alert.alert('Could not delete', e?.message ?? 'Please try again.');
          }
        },
      },
    ]);
  }

  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      {!active ? (
        <Pressable
          style={styles.hiddenBanner}
          onPress={() => router.push('/(provider)/profile')}
          accessibilityLabel={t.inactiveListing}
        >
          <Ionicons name="eye-off-outline" size={18} color={theme.colors.warning} />
          <Text style={styles.hiddenText}>
            {t.inactiveListing}
          </Text>
          <Text style={styles.hiddenAction}>Change</Text>
        </Pressable>
      ) : null}

      <View style={styles.hero}>
        <View style={{ flex: 1 }}><Text style={styles.eyebrow}>{t.courses}</Text><Text style={styles.heroTitle}>{courses.length} {courses.length === 1 ? 'course' : 'courses'} listed</Text><Text style={styles.heroSub}>{active ? 'Visible to learners when published.' : 'Currently hidden from learner discovery.'}</Text></View>
        <View style={styles.heroIcon}><Ionicons name="library-outline" size={26} color={theme.colors.primary} /></View>
      </View>
      <Button label={t.addCourse} size="lg" fullWidth onPress={() => router.push('/(provider)/course-edit')} />
      {loadError ? <View style={styles.errorCard}><Ionicons name="cloud-offline-outline" size={24} color={theme.colors.danger} /><View style={{flex:1}}><Text style={styles.errorTitle}>Couldn’t load courses</Text><Text style={styles.errorText}>{loadError}</Text></View><Pressable onPress={() => load()} style={styles.retryBtn}><Text style={styles.retryText}>{t.retry}</Text></Pressable></View> : courses.length === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="book-outline" title={t.noProviderCourses} subtitle={t.addFirstCourse} />
        </View>
      ) : (
        <FlatList
          data={courses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingTop: 16, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(true); }} colors={[theme.colors.primary]} />}
          renderItem={({ item }) => (
            <Pressable
              style={styles.card}
              onPress={() => router.push({ pathname: '/(provider)/course-edit', params: { id: item.id } })}
            >
              <View style={styles.cardHead}>
                <View style={[styles.chip, { backgroundColor: sectorColor(item.category) }]}>
                  <Text style={styles.chipText}>{CATEGORY_LABELS[item.category]}</Text>
                </View>
                <Text style={styles.seatText}>{item.seats_filled}/{item.seats_total} seats</Text>
              </View>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              <Text style={styles.address} numberOfLines={1}>
                {item.city ?? item.address}
              </Text>
              <View style={styles.batchRow}>
                <Ionicons name="layers-outline" size={15} color={theme.colors.primary} />
                <Text style={styles.batchText}>
                  {batchCounts[item.id] ? `${batchCounts[item.id]} ${t.batchConfigured}` : t.setBatches}
                </Text>
                <Text style={styles.batchAction}>{t.manage}</Text>
              </View>
              <Pressable
                style={styles.reviewRow}
                onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/course/[id]', params: { id: item.id } }); }}
                accessibilityRole="button"
                accessibilityLabel={`Reviews and ratings for ${item.title}`}
              >
                <Ionicons name="star" size={15} color="#F5A524" />
                <Text style={styles.reviewText}>
                  {ratings[item.id]?.count
                    ? `${ratings[item.id].avg.toFixed(1)} · ${ratings[item.id].count} review${ratings[item.id].count === 1 ? '' : 's'}`
                    : 'No reviews yet'}
                </Text>
                <Text style={styles.batchAction}>View & reply</Text>
              </Pressable>
              <View style={styles.cardFoot}>
                <Text style={styles.leftText}>
                  {seatsLeft(item)} {t.seatsLeft}
                </Text>
                <View style={styles.cardActions}>
                  {/* Share the PUBLIC web link — same payload as the share
                      button on the course detail screen, so a partner can
                      broadcast a course straight from their list. */}
                  <ShareButton
                    message={`Check out this course: ${item.title}`}
                    url={courseShareUrl(item.id)}
                    label={`Share ${item.title}`}
                    variant="ghost"
                    size={24}
                    color={theme.colors.textMuted}
                  />
                  <Pressable
                    style={styles.deleteBtn}
                    onPress={(e) => { e.stopPropagation?.(); router.push({ pathname: '/(provider)/course-materials/[courseId]', params: { courseId: item.id } }); }}
                    accessibilityRole="button"
                    accessibilityLabel={`Materials for ${item.title}`}
                  >
                    <Ionicons name="folder-open-outline" size={18} color={theme.colors.primary} />
                  </Pressable>
                  <Pressable style={styles.deleteBtn} onPress={(e) => { e.stopPropagation?.(); handleDelete(item); }} accessibilityRole="button" accessibilityLabel="Delete">
                    <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                  </Pressable>
                </View>
              </View>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.background },
  hero: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: 20, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: theme.colors.border },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 1, color: theme.colors.primary, textTransform: 'uppercase' }, heroTitle: { fontSize: 23, fontWeight: '800', color: theme.colors.text, marginTop: 4 }, heroSub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 4 }, heroIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: theme.colors.primary + '12', alignItems: 'center', justifyContent: 'center' }, errorCard: { flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 14, padding: 14, backgroundColor: '#FFF7F7', borderRadius: 16, borderWidth: 1, borderColor: '#F0CACA' }, errorTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.text }, errorText: { fontSize: 12, color: theme.colors.textMuted, marginTop: 3 }, retryBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: theme.colors.primary }, retryText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.card },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  seatText: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '600' },
  title: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginBottom: 4, lineHeight: 24 },
  address: { fontSize: 13, color: theme.colors.textMuted },
  batchRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingVertical: 9, paddingHorizontal: 10, backgroundColor: theme.colors.background, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  batchText: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.colors.text },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingVertical: 9, paddingHorizontal: 10, backgroundColor: theme.colors.background, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border },
  reviewText: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.colors.text },
  batchAction: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.colors.border },
  leftText: { fontSize: 13, fontWeight: '600', color: theme.colors.primary },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deleteBtn: { padding: 6 },
  hiddenBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12,
    backgroundColor: theme.colors.warning + '1A', borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.warning, padding: 12,
  },
  hiddenText: { flex: 1, fontSize: 13, color: theme.colors.text, lineHeight: 18 },
  hiddenAction: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
});
