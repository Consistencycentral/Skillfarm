// ===========================================================================
// CourseCard — a single course shown in the Browse list.
// Image-led: 16:9 photo on top (category chip + bookmark overlaid), then title,
// Learning Partner, location and seat status. No photo -> sector colour + icon.
// Tapping the card navigates to the course detail screen.
// ===========================================================================
import { useState } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { FadeInView } from './motion';
import { Card } from './ui';
import { CATEGORY_LABELS, sectorColor, type CourseWithProvider } from '../api/courses';
import type { Batch } from '../api/batches';
import { NextBatchInfo } from './NextBatchInfo';
import { SaveCourseButton } from './SaveCourseButton';
import { useLanguage } from '../lib/i18n';
import { localizeCourse } from '../lib/courseText';
import { SECTOR_ICONS } from '../lib/sectorIcons';

export function CourseCard({ course, nextBatch = null, onSavedChange }: { course: CourseWithProvider; nextBatch?: Batch | null; onSavedChange?: (saved: boolean) => void }) {
  const { lang } = useLanguage();
  const router = useRouter();
  // Published batch is the only source of booking capacity.
  const left = nextBatch ? Math.max(0, nextBatch.seats_total - nextBatch.seats_filled) : null;
  const full = nextBatch ? left === 0 : false;
  const few = left !== null && left > 0 && left <= 5;
  const seatTone = !nextBatch ? theme.colors.textMuted : full ? theme.colors.teal : few ? theme.colors.warning : theme.colors.success;
  const seatBg = !nextBatch ? theme.colors.neutralBg : full ? theme.colors.tealBg : few ? theme.colors.warningBg : theme.colors.successBg;
  const [imgFailed, setImgFailed] = useState(false);
  const uri = course.images?.[0] ?? course.image_url ?? null;
  const showImage = Boolean(uri) && !imgFailed;
  const tint = sectorColor(course.category);
  const place = [course.city, course.state].filter(Boolean).join(', ') || course.address;
  return (
    <FadeInView>
      <Card style={styles.card} padded={false} onPress={() => router.push(`/course/${course.id}`)} accessibilityLabel={localizeCourse(course, lang).title}>
        <View style={styles.imageWrap}>
          {showImage ? (
            <Image source={{ uri: uri! }} style={styles.image} resizeMode="cover" onError={() => setImgFailed(true)} />
          ) : (
            <View style={[styles.image, styles.imageFallback, { backgroundColor: tint }]}>
              <Ionicons name={SECTOR_ICONS[course.category]} size={46} color="rgba(255,255,255,0.92)" />
            </View>
          )}
          {/* Soft scrim so the white chip / bookmark stay readable on any photo. */}
          <View pointerEvents="none" style={styles.scrim} />
          <View style={styles.categoryChip}>
            <Text style={styles.categoryChipText} numberOfLines={1}>{CATEGORY_LABELS[course.category]}</Text>
          </View>
          <View style={styles.bookmark}>
            <SaveCourseButton courseId={course.id} onChange={onSavedChange} />
          </View>
          {/* Certificate is per-course; only shown when the partner provides one. */}
          {course.certificate_available ? (
            <View style={styles.certChip}>
              <Ionicons name="ribbon" size={12} color="#fff" />
              <Text style={styles.certChipText}>Certificate</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>{localizeCourse(course, lang).title}</Text>

          {course.description ? (
            <Text style={styles.description} numberOfLines={2}>{course.description}</Text>
          ) : null}

          <View style={styles.metaBlock}>
            <View style={styles.row}>
              <Ionicons name="business-outline" size={15} color={theme.colors.textSubtle} />
              <Text style={styles.meta} numberOfLines={1}>{course.provider_name ?? 'Learning Partner'}</Text>
              {/* Every course a learner sees is from an Active partner (listCourses
                  filters inactive ones out), so this reads as a trust signal. */}
              {course.provider_active !== false ? (
                <Ionicons name="checkmark-circle" size={14} color={theme.colors.success} accessibilityLabel="Active partner" />
              ) : null}
            </View>
            {place ? (
              <View style={styles.row}>
                <Ionicons name="location-outline" size={15} color={theme.colors.textSubtle} />
                <Text style={styles.meta} numberOfLines={1}>{place}</Text>
              </View>
            ) : null}
          </View>

          <NextBatchInfo batch={nextBatch} compact />
        </View>

        <View style={styles.footer}>
          <View style={[styles.seatPill, { backgroundColor: seatBg }]}>
            <Ionicons name={full ? 'hourglass' : 'ticket'} size={13} color={seatTone} />
            <Text style={[styles.seatText, { color: seatTone }]}>
              {nextBatch ? (full ? 'Full — join waitlist' : few ? `Only ${left} left` : `${left} seats left`) : 'Event not published'}
            </Text>
          </View>
          <View style={styles.viewLink}>
            <Text style={styles.viewLinkText}>View</Text>
            <Ionicons name="arrow-forward" size={15} color={theme.colors.primary} />
          </View>
        </View>
      </Card>
    </FadeInView>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 14, overflow: 'hidden' },
  imageWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.colors.surfaceAlt },
  image: { width: '100%', height: '100%' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, top: 0, height: 64, backgroundColor: 'rgba(0,0,0,0.18)' },
  categoryChip: { position: 'absolute', top: 12, left: 12, maxWidth: '70%', backgroundColor: 'rgba(255,255,255,0.94)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill },
  categoryChipText: { fontSize: 11.5, fontWeight: '700', color: theme.colors.primaryDark, letterSpacing: 0.1 },
  bookmark: { position: 'absolute', top: 10, right: 10, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.94)', alignItems: 'center', justifyContent: 'center' },
  certChip: { position: 'absolute', bottom: 10, left: 12, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 9, paddingVertical: 4, borderRadius: theme.radius.pill },
  certChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 14 },
  title: { ...theme.type.h2, color: theme.colors.text },
  description: { ...theme.type.small, fontSize: 14, lineHeight: 20, color: theme.colors.textMuted, marginTop: 6 },
  metaBlock: { marginTop: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { ...theme.type.small, color: theme.colors.textMuted, flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.colors.background, borderTopWidth: 1, borderTopColor: theme.colors.border },
  seatPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: theme.radius.pill },
  seatText: { fontSize: 12.5, fontWeight: '700' },
  viewLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  viewLinkText: { fontSize: 13.5, fontWeight: '700', color: theme.colors.primary },
});
