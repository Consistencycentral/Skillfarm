// ===========================================================================
// Courses — the flat, filterable catalogue. This is the old Browse screen:
// a search box, the 18 sector chips, and a newest-first list of every course.
// Home ("browse") is now the Udemy-style discovery screen, and each "See all"
// there deep-links into this tab with a sector pre-selected.
// ===========================================================================
import { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, TextInput, FlatList, StyleSheet, RefreshControl, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { listCourses, CATEGORY_LIST, CATEGORY_LABELS, isCourseCategory, type CourseCategory, type CourseWithProvider } from '../../api/courses';
import { listNextBatchesForCourses, type Batch } from '../../api/batches';
import { EMPTY_COURSE_FILTERS, hasCourseFilters, filterCoursesAdvanced, type CourseFilterState } from '../../lib/courseFilters';
import { CourseFilterSheet } from '../../components/CourseFilterSheet';
import { CourseCard } from '../../components/CourseCard';
import { EmptyState } from '../../components/EmptyState';
import { theme } from '../../constants/theme';
import { Ionicons } from '@expo/vector-icons';

type Filter = CourseCategory | 'all';

export default function CoursesScreen() {
  const [courses, setCourses] = useState<CourseWithProvider[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextBatches, setNextBatches] = useState<Record<string, Batch | null>>({});
  const [filters, setFilters] = useState<CourseFilterState>(EMPTY_COURSE_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);

  // Seed the chip from a "See all" deep link, but only ONCE per navigation. The
  // `ts` nonce makes each tap a distinct token even for the same sector, so a
  // repeat tap re-applies after the user changed the chip by hand; the ref stops
  // the param from re-clobbering a manual chip tap on every re-render.
  const params = useLocalSearchParams<{ category?: string; ts?: string }>();
  const appliedToken = useRef<string | null>(null);
  useEffect(() => {
    const token = `${params.ts ?? ''}:${params.category ?? ''}`;
    if (appliedToken.current === token) return;
    appliedToken.current = token;
    if (isCourseCategory(params.category)) setFilter(params.category);
    else if (params.category === 'all') setFilter('all');
  }, [params.category, params.ts]);

  // `isRefresh` is a parameter (not read from state) so `load`'s identity stays
  // stable and toggling `refreshing` doesn't re-fire the focus effect.
  const load = useCallback(async (category: Filter, isRefresh = false) => {
    try {
      setError(null);
      if (!isRefresh) setLoading(true);
      const data = await listCourses(category);
      setCourses(data);
      try { setNextBatches(await listNextBatchesForCourses(data.map((c) => c.id))); } catch { setNextBatches({}); }
    } catch (e: any) {
      setError(e?.message ?? 'Could not load courses.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(filter); }, [filter, load]));

  const onRefresh = () => { setRefreshing(true); load(filter, true); };

  // Category is filtered server-side; search is applied locally (title, city,
  // state, partner name, sector label — via the shared filterCourses helper).
  const visible = filterCoursesAdvanced(courses, search, filters, nextBatches);
  const activeFilters = hasCourseFilters(filters);

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search courses, sectors, cities…"
          placeholderTextColor={theme.colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        <Pressable style={[styles.filterBtn, activeFilters && styles.filterBtnActive]} onPress={() => setFilterOpen(true)} accessibilityLabel="Open filters">
          <Ionicons name="options-outline" size={18} color={activeFilters ? '#fff' : theme.colors.text} />
          <Text style={[styles.filterText, activeFilters && styles.filterTextActive]}>Filters</Text>
          {activeFilters ? <View style={styles.filterDot}><Text style={styles.filterDotText}>!</Text></View> : null}
        </Pressable>
      </View>
      {activeFilters ? (
        <Pressable style={styles.clearChip} onPress={() => setFilters(EMPTY_COURSE_FILTERS)}>
          <Text style={styles.clearChipText}>Clear filters</Text><Ionicons name="close" size={14} color={theme.colors.primary} />
        </Pressable>
      ) : null}

      {/* Horizontal single-row chip strip: the 18 sectors on one swipeable line
          rather than wrapping to ~4 rows and eating the list's height. */}
      <View style={styles.chipBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          <Pressable
            style={[styles.chip, filter === 'all' ? styles.chipActive : styles.chipInactive]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.chipText, filter === 'all' ? styles.chipTextActive : {}]}>All</Text>
          </Pressable>
          {CATEGORY_LIST.map((cat) => (
            <Pressable
              key={cat}
              style={[styles.chip, filter === cat ? styles.chipActive : styles.chipInactive]}
              onPress={() => setFilter(cat)}
            >
              <Text style={[styles.chipText, filter === cat ? styles.chipTextActive : {}]}>
                {CATEGORY_LABELS[cat]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {loading && !refreshing ? (
        <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-offline" title="Could not load" subtitle={error} />
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.center}>
          <EmptyState
            icon={search.trim() ? 'search-outline' : 'book-outline'}
            title={search.trim() ? 'No matches' : 'No courses available yet'}
            subtitle={search.trim() ? 'Try a different course, sector or city.' : 'Check back soon — Learning Partners are adding courses.'}
          />
        </View>
      ) : (
        <FlashList
          data={visible}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <CourseCard course={item} nextBatch={nextBatches[item.id] ?? null} />}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 4 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[theme.colors.primary]} />}
        />
      )}
      <CourseFilterSheet visible={filterOpen} value={filters} onClose={() => setFilterOpen(false)} onApply={setFilters} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: theme.colors.background },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  search: {
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.colors.text,
    flex: 1,
    marginBottom: 0,
  },
  filterBtn: { height: 46, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface },
  filterBtnActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  filterText: { fontSize: 13, fontWeight: '700', color: theme.colors.text },
  filterTextActive: { color: '#fff' },
  filterDot: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  filterDotText: { fontSize: 10, fontWeight: '800', color: theme.colors.primary },
  clearChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: theme.radius.pill, backgroundColor: theme.colors.primary + '12', marginBottom: 6 },
  clearChipText: { fontSize: 12, fontWeight: '700', color: theme.colors.primary },
  chipBar: { marginBottom: 12, paddingBottom: 4 },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipInactive: { backgroundColor: theme.colors.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted },
  chipTextActive: { color: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
