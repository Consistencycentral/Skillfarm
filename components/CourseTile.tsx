// ===========================================================================
// CourseTile — compact vertical card for the horizontal discovery rows on Home.
// Narrower and image-led (unlike the full-width, text-led CourseCard used in the
// flat lists). Props are primitives only so React.memo actually holds: passing a
// freshly-built { avg, count } object would give a new identity every render.
// ===========================================================================
import React, { memo, useEffect, useState } from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { PressableScale, FadeInView } from './motion';
import { listBatches, type Batch, batchSeatsLeft } from '../api/batches';
import { SECTOR_ICONS } from '../lib/sectorIcons';
import { useLanguage } from '../lib/i18n';
import { localizeCourse } from '../lib/courseText';
import {
  CATEGORY_LABELS, sectorColor, seatsLeft, isFull, netFee,
  type CourseCategory, type CourseWithProvider,
} from '../api/courses';

export const TILE_WIDTH = 172;
export const TILE_GAP = 12;

interface Props {
  course: CourseWithProvider;
  ratingAvg?: number;
  ratingCount?: number;
}

function CourseTileBase({ course, ratingAvg = 0, ratingCount = 0 }: Props) {
  const { lang } = useLanguage();
  const router = useRouter();
  const [imgFailed, setImgFailed] = useState(false);
  const [nextBatch, setNextBatch] = useState<Batch | null>(null);
  const [batchCount, setBatchCount] = useState(0);

  useEffect(() => {
    let alive = true;
    listBatches(course.id).then((rows) => {
      if (!alive) return;
      setBatchCount(rows.length);
      setNextBatch(rows[0] ?? null);
    }).catch(() => {
      if (!alive) return;
      setBatchCount(0);
      setNextBatch(null);
    });
    return () => { alive = false; };
  }, [course.id]);

  const uri = course.images?.[0] ?? course.image_url ?? null;
  const showImage = Boolean(uri) && !imgFailed;
  const tint = sectorColor(course.category);
  const left = seatsLeft(course);
  const full = isFull(course);
  const price = netFee(course);

  const a11y = `${localizeCourse(course, lang).title}, ${CATEGORY_LABELS[course.category]}` +
    (course.provider_active !== false ? ', active partner' : '') +
    (course.certificate_available ? ', certificate available' : '') +
    (ratingCount > 0 ? `, rated ${ratingAvg.toFixed(1)} out of 5` : '');

  return (
    <FadeInView>
    <PressableScale
      scaleTo={0.97}
      style={styles.tile}
      onPress={() => router.push(`/course/${course.id}`)}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <View style={styles.imageWrap}>
        {showImage ? (
          <Image
            source={{ uri: uri! }}
            style={styles.image}
            resizeMode="cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={[styles.image, styles.imageFallback, { backgroundColor: tint }]}>
            <Ionicons name={SECTOR_ICONS[course.category]} size={34} color="rgba(255,255,255,0.92)" />
          </View>
        )}

        {/* Certificate is the differentiating value signal, so it rides on the
            image where it is seen even before the title. Only when provided. */}
        {course.certificate_available ? (
          <View style={styles.certOverlay}>
            <Ionicons name="ribbon" size={11} color="#fff" />
            <Text style={styles.certOverlayText}>Certificate</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        <View style={styles.sectorRow}>
          <Text style={[styles.sector, { color: tint }]} numberOfLines={1}>
            {CATEGORY_LABELS[course.category].toUpperCase()}
          </Text>
          {/* Active-partner trust check (every visible course is from an active
              partner — inactive ones are filtered out in listCourses). */}
          {course.provider_active !== false ? (
            <Ionicons name="checkmark-circle" size={12} color={theme.colors.success} />
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={2}>{localizeCourse(course, lang).title}</Text>

        {ratingCount > 0 ? (
          <View style={styles.ratingRow}>
            <Ionicons name="star" size={12} color="#E9A21B" />
            <Text style={styles.ratingText}>{ratingAvg.toFixed(1)}</Text>
            <Text style={styles.ratingCount}>({ratingCount})</Text>
          </View>
        ) : (
          <View style={styles.ratingSpacer} />
        )}

        <View style={styles.priceRow}>
          <Text style={styles.price} numberOfLines={1}>
            {price === 0 ? 'Free' : `₹${price.toLocaleString('en-IN')}`}
          </Text>
          {course.city ? <Text style={styles.city} numberOfLines={1}>{course.city}</Text> : null}
        </View>

        <View style={styles.batchHintRow}>
          <Ionicons name="calendar-outline" size={12} color={theme.colors.primary} />
          <Text style={styles.batchHint} numberOfLines={1}>
            {nextBatch
              ? `${nextBatch.name} · ${nextBatch.start_date ?? 'Date TBC'}${nextBatch.timings ? ` · ${nextBatch.timings}` : ''}`
              : course.start_date ? `Batch 1 · ${course.start_date}` : 'Batch dates to be confirmed'}
          </Text>
        </View>
        <View style={styles.capacityRow}>
          <Text style={[styles.seats, { color: (nextBatch ? batchSeatsLeft(nextBatch) === 0 : full) ? theme.colors.teal : theme.colors.success }]} numberOfLines={1}>
            {nextBatch
              ? (batchSeatsLeft(nextBatch) === 0 ? 'Full — join waitlist' : `${batchSeatsLeft(nextBatch)} seats available`)
              : (full ? 'Full — join waitlist' : `${left} seat${left === 1 ? '' : 's'} left`)}
          </Text>
          {batchCount > 1 ? <Text style={styles.batchCount}>{batchCount} batches</Text> : null}
        </View>
      </View>
    </PressableScale>
    </FadeInView>
  );
}

// Primitive-only props → shallow memo is sound and prevents whole rows from
// re-rendering when an unrelated section's data changes.
export const CourseTile = memo(CourseTileBase);

const styles = StyleSheet.create({
  tile: {
    width: TILE_WIDTH,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
    ...theme.shadow.card,
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.94 },
  imageWrap: { width: '100%', height: 108 },
  image: { width: '100%', height: 108 },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  certOverlay: {
    position: 'absolute', top: 6, left: 6,
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: theme.radius.pill,
  },
  certOverlayText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  body: { padding: 12 },
  sectorRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 3 },
  sector: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '800', color: theme.colors.text, lineHeight: 20, height: 40, letterSpacing: -0.1 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, height: 18 },
  ratingSpacer: { height: 18, marginTop: 4 },
  ratingText: { fontSize: 12, fontWeight: '700', color: theme.colors.text },
  ratingCount: { fontSize: 11, color: theme.colors.textMuted },
  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4, gap: 6 },
  price: { fontSize: 16, fontWeight: '900', color: theme.colors.primary, flexShrink: 0 },
  city: { fontSize: 12, color: theme.colors.textMuted, flexShrink: 1, textAlign: 'right' },
  batchHintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  batchHint: { flex: 1, fontSize: 11, color: theme.colors.textMuted },
  capacityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  seats: { fontSize: 12, fontWeight: '700', marginTop: 5, flex: 1 },
  batchCount: { fontSize: 11, fontWeight: '700', color: theme.colors.primary, marginTop: 5 },
});
