// ===========================================================================
// CourseRow — a titled, horizontally-scrolling strip of CourseTiles for the
// learner Home. One row = one DiscoverySection. Nesting a horizontal FlatList
// inside the Home's vertical FlatList is fine (the "VirtualizedLists should never
// be nested" warning is only for SAME-axis nesting) and keeps tiles virtualized.
// ===========================================================================
import { View, Text, Pressable, FlatList, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { CourseTile, TILE_WIDTH, TILE_GAP } from './CourseTile';
import type { CourseWithProvider } from '../api/courses';
import type { CourseRatingMap } from '../api/reviews';

const STRIDE = TILE_WIDTH + TILE_GAP; // 184

interface Props {
  rowKey: string;
  title: string;
  subtitle?: string;
  courses: CourseWithProvider[];
  ratings: CourseRatingMap;
  onSeeAll?: () => void;
}

export function CourseRow({ rowKey, title, subtitle, courses, ratings, onSeeAll }: Props) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        {onSeeAll ? (
          <Pressable onPress={onSeeAll} hitSlop={8} style={styles.seeAll} accessibilityRole="button" accessibilityLabel={`See all ${title}`}>
            <Text style={styles.seeAllText}>See all</Text>
            <Ionicons name="chevron-forward" size={15} color={theme.colors.primary} />
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={courses}
        horizontal
        keyExtractor={(item) => `${rowKey}:${item.id}`}
        renderItem={({ item }) => (
          <CourseTile
            course={item}
            ratingAvg={ratings[item.id]?.avg}
            ratingCount={ratings[item.id]?.count}
          />
        )}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        getItemLayout={(_, index) => ({ length: STRIDE, offset: STRIDE * index, index })}
        initialNumToRender={3}
        windowSize={3}
        // Defaults to true on Android in RN 0.81, which blanks out horizontally
        // scrolled children living inside a vertical parent list.
        removeClippedSubviews={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '900', color: theme.colors.text, letterSpacing: -0.3 },
  subtitle: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 10 },
  seeAllText: { fontSize: 13, fontWeight: '800', color: theme.colors.primary },
  listContent: { paddingHorizontal: 16, gap: TILE_GAP },
});
