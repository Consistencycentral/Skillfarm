// ===========================================================================
// Public Organization Page — /org/<id>. The landing- and course-share links
// for a Learning Partner resolve here, and it is deliberately viewable while
// signed OUT (web): it reads the anon-safe `public_orgs` + `public_courses`
// views, never `profiles` directly. This is the web counterpart of the in-app
// OrganizationCard — same trust story (logo, about, sectors, trainers), no
// contact details (the public view excludes email/phone by design).
//
// Each listed course links to /course/<id>, which likewise renders a read-only
// preview for visitors and full register flow once signed in — that is the
// "share a course and anyone can access it" path.
// ===========================================================================
import { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, Image, Pressable, ActivityIndicator, Linking, Platform,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getPublicOrg, listPublicCoursesByOrg, type PublicOrg, type LandingCourse } from '../../api/landing';
import { CATEGORY_LABELS, sectorColor } from '../../api/courses';
import { BackHome } from '../../components/BackHome';
import { EmptyState } from '../../components/EmptyState';
import { theme } from '../../constants/theme';

export default function PublicOrgScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [org, setOrg] = useState<PublicOrg | null>(null);
  const [courses, setCourses] = useState<LandingCourse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null); setLoading(true);
      // Public views only — a signed-out visitor has no session, and the
      // authenticated paths would silently return nothing.
      const [o, c] = await Promise.all([
        getPublicOrg(id as string),
        listPublicCoursesByOrg(id as string).catch(() => [] as LandingCourse[]),
      ]);
      setOrg(o);
      setCourses(c);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this organization.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }
  if (error || !org) {
    return (
      <View style={styles.center}>
        <EmptyState icon="alert-circle-outline" title="Organization not found"
          subtitle={error ?? 'This link may be old, or the partner went inactive.'} />
        <Pressable style={styles.retryBtn} onPress={() => router.replace('/')}>
          <Text style={styles.retryText}>Go to SkillFarm</Text>
        </Pressable>
      </View>
    );
  }

  const name = org.org_name || org.full_name || 'Learning Partner';

  return (
    <View style={styles.page}>
      {/* Banner */}
      <View style={styles.banner}>
        {/* BackHome instead of bare router.back(): when this page IS the first
            history entry (cold link open), back() closes the tab/app. It now
            falls through to the landing page instead. */}
        <BackHome />
        <Pressable onPress={() => router.replace('/')} hitSlop={8}>
          <Text style={styles.bannerLogo}>SkillFarm</Text>
        </Pressable>
      </View>

      <View style={styles.body}>
        {/* Org identity */}
        <View style={styles.orgHead}>
          {org.org_logo_url ? (
            <Image source={{ uri: org.org_logo_url }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoFallback]}>
              <Ionicons name="business" size={30} color="#fff" />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.orgName}>{name}</Text>
            {org.org_type ? <Text style={styles.orgType}>{org.org_type}</Text> : null}
          </View>
        </View>

        {org.org_about ? <Text style={styles.about}>{org.org_about}</Text> : null}

        {org.org_images && org.org_images.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Training centre</Text>
            <View style={styles.gallery}>
              {org.org_images.map((url) => <Image key={url} source={{ uri: url }} style={styles.galleryImage} />)}
            </View>
          </>
        ) : null}

        {/* Facts row — public subset only */}
        <View style={styles.facts}>
          {org.org_year_established ? <Fact icon="ribbon-outline" label="Established" value={String(org.org_year_established)} /> : null}
          {org.org_registration_number ? <Fact icon="shield-checkmark-outline" label="Reg. number" value={org.org_registration_number} /> : null}
          {org.org_languages ? <Fact icon="language-outline" label="Languages" value={org.org_languages} /> : null}
          {org.org_address ? <Fact icon="location-outline" label="Address" value={org.org_address} /> : null}
          {org.org_website ? (
            <Pressable onPress={() => Linking.openURL(org.org_website!).catch(() => {})} style={styles.factRow}>
              <Ionicons name="globe-outline" size={16} color={theme.colors.primary} />
              <Text style={[styles.factValue, styles.link]} numberOfLines={1}>{org.org_website}</Text>
            </Pressable>
          ) : null}
        </View>

        {org.org_sectors && org.org_sectors.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Training sectors</Text>
            <View style={styles.sectors}>
              {org.org_sectors.map((s) => (
                <View key={s} style={[styles.sectorChip, { borderColor: sectorColor(s) }]}>
                  <Text style={[styles.sectorText, { color: sectorColor(s) }]}>
                    {CATEGORY_LABELS[s as keyof typeof CATEGORY_LABELS] ?? s}
                  </Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {org.trainers && org.trainers.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Trainers ({org.trainers.length})</Text>
            {org.trainers.map((t, i) => (
              <View key={i} style={styles.trainerRow}>
                <Ionicons name="person-circle-outline" size={28} color={theme.colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.trainerName}>{t.name ?? 'Trainer'}</Text>
                  <Text style={styles.trainerMeta} numberOfLines={1}>
                    {[t.qualification, t.experience != null ? `${t.experience} yrs` : null, t.expertise]
                      .filter(Boolean).join(' • ')}
                  </Text>
                </View>
              </View>
            ))}
          </>
        ) : null}

        {/* Public course list -> links into the app/web course pages */}
        <Text style={styles.sectionTitle}>
          {courses.length > 0 ? `Courses (${courses.length})` : 'No courses listed yet'}
        </Text>
        {courses.length === 0 ? (
          <Text style={styles.empty}>This partner hasn't published a course yet — check back soon.</Text>
        ) : (
          courses.map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/course/${c.id}`)} style={styles.courseCard}>
              {c.image_url ? (
                <Image source={{ uri: c.image_url }} style={styles.courseImage} />
              ) : (
                <View style={[styles.courseImage, { backgroundColor: sectorColor(c.category) }]} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.courseTitle} numberOfLines={2}>{c.title}</Text>
                <Text style={styles.courseMeta} numberOfLines={1}>
                  {CATEGORY_LABELS[c.category]}{c.city ? ` • ${c.city}` : ''} • {c.fee && c.fee > 0 ? `₹${c.fee}` : 'Free'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </Pressable>
          ))
        )}

        {/* CTA */}
        <View style={styles.cta}>
          <Text style={styles.ctaTitle}>Want to join {name}'s next batch?</Text>
          <Text style={styles.ctaSub}>
            Create a free SkillFarm account to request a seat — the partner
            approves it right in the app.{Platform.OS === 'web' ? ' Or open the SkillFarm app on your phone.' : ''}
          </Text>
          <Pressable style={styles.ctaBtn} onPress={() => router.push('/login')}>
            <Text style={styles.ctaBtnText}>Sign up free</Text>
            <Ionicons name="arrow-forward" size={15} color="#fff" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Fact({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={16} color={theme.colors.primary} />
      <Text style={styles.factValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: theme.colors.background },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 11, backgroundColor: theme.colors.primary, borderRadius: theme.radius.md },
  retryText: { color: '#fff', fontWeight: '700' },
  banner: {
    backgroundColor: theme.colors.primary, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14,
  },
  back: { padding: 6 },
  bannerLogo: { color: '#fff', fontWeight: '800', fontSize: 16 },
  body: { padding: 20, maxWidth: 760, width: '100%', alignSelf: 'center' },
  orgHead: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  logo: { width: 64, height: 64, borderRadius: 14, backgroundColor: theme.colors.surfaceAlt },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  orgName: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  orgType: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  about: { fontSize: 15, color: theme.colors.text, lineHeight: 22, marginTop: 14 },
  gallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  galleryImage: { width: 112, height: 82, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  facts: { marginTop: 14, gap: 8 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  factValue: { fontSize: 14, color: theme.colors.text, flex: 1 },
  link: { color: theme.colors.info, textDecorationLine: 'underline' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.text, marginTop: 22, marginBottom: 10 },
  sectors: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sectorChip: { borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 12, paddingVertical: 6 },
  sectorText: { fontSize: 13, fontWeight: '700' },
  trainerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  trainerName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  trainerMeta: { fontSize: 13, color: theme.colors.textMuted, marginTop: 1 },
  empty: { fontSize: 14, color: theme.colors.textMuted },
  courseCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.surface,
    borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg,
    padding: 10, marginBottom: 10,
  },
  courseImage: { width: 60, height: 60, borderRadius: 10 },
  courseTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  courseMeta: { fontSize: 13, color: theme.colors.textMuted, marginTop: 3 },
  cta: {
    marginTop: 26, backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg,
    borderWidth: 1, borderColor: theme.colors.border, padding: 18,
  },
  ctaTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  ctaSub: { fontSize: 14, color: theme.colors.textMuted, lineHeight: 20, marginTop: 6 },
  ctaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: theme.colors.primary, borderRadius: theme.radius.md,
    paddingHorizontal: 18, paddingVertical: 12, marginTop: 14,
  },
  ctaBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
