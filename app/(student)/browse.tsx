// ===========================================================================
// Home — the learner's discovery screen (tab route stays "browse" so the
// role-select redirect and root layout keep working). A pinned search bar sits
// above either:
//   • sections mode — horizontal rows for Recommendations / Top / Trending and
//     one row per populated sector, all derived client-side from live data by
//     buildDiscoverySections(); or
//   • results mode — a flat list of matching CourseCards while a query is typed.
//
// The search TextInput lives in a FIXED header (never in ListHeaderComponent):
// a header component is re-created on every list render, which would remount the
// input and drop the keyboard mid-word. The two modes are separate FlatLists
// with distinct `key`s so switching resets scroll instead of restoring the
// other mode's offset.
// ===========================================================================
import { useState, useCallback, useMemo, useDeferredValue } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  View, Text, TextInput, FlatList, StyleSheet, Pressable, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listCourses, CATEGORY_LIST, CATEGORY_LABELS, type CourseCategory, type CourseWithProvider } from '../../api/courses';
import { listNextBatchesForCourses, type Batch } from '../../api/batches';
import { listAllCourseRatings, type CourseRatingMap } from '../../api/reviews';
import { listMyRegistrations, type RegistrationWithCourse } from '../../api/registrations';
import { buildDiscoverySections } from '../../lib/discovery';
import { EMPTY_COURSE_FILTERS, hasCourseFilters, filterCoursesAdvanced, type CourseFilterState } from '../../lib/courseFilters';
import { CourseFilterSheet } from '../../components/CourseFilterSheet';
import { CourseRow } from '../../components/CourseRow';
import { CourseCard } from '../../components/CourseCard';
import { EmptyState } from '../../components/EmptyState';
import { supabase } from '../../lib/supabase';
import { theme } from '../../constants/theme';
import { useLanguage } from '../../lib/i18n';
import { cacheJson, readCachedJson } from '../../lib/offlineCache';
import { CourseSkeleton } from '../../components/CourseSkeleton';
import { Chip } from '../../components/ui';
import { Button } from '../../components/Button';

export default function HomeScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const [courses, setCourses] = useState<CourseWithProvider[]>([]);
  const [ratings, setRatings] = useState<CourseRatingMap>({});
  const [regs, setRegs] = useState<RegistrationWithCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [nextBatches, setNextBatches] = useState<Record<string, Batch | null>>({});
  const [category, setCategory] = useState<CourseCategory | null>(null);
  const [filters, setFilters] = useState<CourseFilterState>(EMPTY_COURSE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // Keep typing responsive: the input updates immediately while the (heavier)
  // filtered list recomputes against the deferred value.
  const deferredSearch = useDeferredValue(search);

  // Only the course fetch is a hard error (Retry). Ratings/regs are downgraded to
  // empty so the discovery screen still renders if `reviews` is slow or the user
  // has no registrations — ranking just falls back to its sparse branches.
  const load = useCallback(async (isRefresh = false) => {
    try {
      setError(null);
      if (!isRefresh) setLoading(true);
      const list = await listCourses();
      setCourses(list);
      void cacheJson('discovery.courses', list);
      try { setNextBatches(await listNextBatchesForCourses(list.map((c) => c.id))); } catch { setNextBatches({}); }

      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user?.id ?? null;
      const [ratingMap, myRegs] = await Promise.all([
        listAllCourseRatings(list.map((c) => c.id)).catch(() => ({} as CourseRatingMap)),
        uid ? listMyRegistrations(uid).catch(() => [] as RegistrationWithCourse[]) : Promise.resolve([]),
      ]);
      setRatings(ratingMap);
      setRegs(myRegs);
    } catch (e: any) {
      const cached = await readCachedJson<CourseWithProvider[]>('discovery.courses');
      if (cached?.length) {
        setCourses(cached);
        try { setNextBatches(await listNextBatchesForCourses(cached.map((c) => c.id))); } catch { setNextBatches({}); }
        setError(null);
      } else {
        setError(e?.message ?? 'Could not load courses.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Reload on focus so seat counts / new ratings refresh after visiting a course.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections = useMemo(
    () => buildDiscoverySections({ courses, ratings, regs }),
    [courses, ratings, regs],
  );

  const query = deferredSearch.trim();
  const activeFilters = hasCourseFilters(filters);
  // Results mode = anything narrowing the catalogue: text, a sector chip or advanced filters.
  const searching = query.length > 0 || category !== null || activeFilters;
  const results = useMemo(() => {
    if (!searching) return [];
    const base = category ? courses.filter((c) => c.category === category) : courses;
    return filterCoursesAdvanced(base, query, filters, nextBatches);
  }, [courses, query, category, filters, nextBatches, searching]);
  const clearAll = () => { setSearch(''); setCategory(null); setFilters(EMPTY_COURSE_FILTERS); };

  const onRefresh = () => { setRefreshing(true); load(true); };

  const refreshControl = (
    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />
  );

  return (
    <View style={styles.screen}>
      {/* Fixed header — the search bar never unmounts across mode switches. */}
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t.learningEyebrow}</Text>
        <Text style={styles.heroTitle}>{t.learningHero}</Text>
        <Text style={styles.heroSub}>{t.learningSub}</Text>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color={theme.colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t.searchCourses}
            placeholderTextColor={theme.colors.textMuted}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            numberOfLines={1}
          />
          {search.length > 0 ? (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel={t.clearSearch}>
              <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setFilterOpen(true)}
            style={[styles.filterBtn, activeFilters && styles.filterBtnActive]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Open filters"
          >
            <Ionicons name="options-outline" size={18} color={activeFilters ? '#fff' : theme.colors.text} />
          </Pressable>
        </View>
        <FlatList
          horizontal
          data={CATEGORY_LIST}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
          renderItem={({ item }) => (
            <Chip label={CATEGORY_LABELS[item]} onPress={() => setCategory(category === item ? null : item)} selected={category === item} />
          )}
        />
      </View>

      {loading && !refreshing ? (
        <View style={{ padding: 16 }}><CourseSkeleton /><CourseSkeleton /><CourseSkeleton /></View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline" title={t.languageErrorTitle} subtitle={error} />
          <View style={{ marginTop: 16 }}><Button label={t.retryLoad} icon="refresh" onPress={() => load()} /></View>
        </View>
      ) : searching ? (
        <FlashList
          key="results"
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CourseCard course={item} nextBatch={nextBatches[item.id] ?? null} />}
          ListHeaderComponent={
            <Text style={styles.resultsMeta}>
              {results.length} course{results.length === 1 ? '' : 's'}{query ? ` for “${query}”` : ''}{category ? ` · ${CATEGORY_LABELS[category]}` : ''}
              {'  '}<Text style={styles.clearLink} onPress={clearAll}>Clear</Text>
            </Text>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <EmptyState icon="search-outline" title={t.noMatches} subtitle={t.tryDifferent} />
            </View>
          }
          contentContainerStyle={styles.resultsContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        />
      ) : sections.length === 0 ? (
        <View style={styles.center}>
          <EmptyState icon="book-outline" title={t.noCourses} subtitle={t.noCoursesSub} />
        </View>
      ) : (
        <FlashList
          key="sections"
          data={sections}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <CourseRow
              rowKey={item.key}
              title={item.title}
              subtitle={item.subtitle}
              courses={item.courses}
              ratings={ratings}
              onSeeAll={
                item.seeAllCategory
                  ? () => router.push({
                      pathname: '/(student)/courses',
                      params: { category: item.seeAllCategory as string, ts: String(Date.now()) },
                    })
                  : undefined
              }
            />
          )}
          contentContainerStyle={styles.sectionsContent}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
          removeClippedSubviews={false}
        />
      )}
      <CourseFilterSheet visible={filterOpen} value={filters} onClose={() => setFilterOpen(false)} onApply={setFilters} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  header: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 8, backgroundColor: theme.colors.background },
  eyebrow: { ...theme.type.overline, color: theme.colors.primary, marginBottom: 6 },
  heroTitle: { ...theme.type.display, color: theme.colors.text, maxWidth: 620 },
  heroSub: { ...theme.type.body, color: theme.colors.textMuted, marginTop: 6, marginBottom: 16, maxWidth: 620 },
  filterBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background, borderWidth: 1, borderColor: theme.colors.border },
  filterBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  clearLink: { color: theme.colors.primary, fontWeight: '800' },
  categoryRow: { gap: 8, paddingVertical: 12, paddingRight: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border },
  categoryText: { fontSize: 12.5, fontWeight: '800', color: theme.colors.text },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.lg, paddingHorizontal: 16, paddingVertical: 13,
    ...theme.shadow.card,
  },
  searchInput: { flex: 1, fontSize: 15, color: theme.colors.text, padding: 0 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  retryBtn: { marginTop: 16, paddingHorizontal: 20, paddingVertical: 12, backgroundColor: theme.colors.primary, borderRadius: theme.radius.md },
  retryText: { color: '#fff', fontWeight: '700' },
  // No horizontal padding: rows bleed to the edge and supply their own, so a tile
  // peeks at the right edge to signal the row scrolls.
  sectionsContent: { paddingTop: 8, paddingBottom: 28 },
  resultsContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 },
  resultsMeta: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 10 },
});
