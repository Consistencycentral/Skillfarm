// ===========================================================================
// LandingContent — the public marketing site for the web root route
// (app/index.tsx renders it when nobody is signed in on Platform web).
//
// Design language mirrors the app exactly (constants/theme.ts): deep
// agriculture green + warm amber, calm neutrals, generous whitespace. Written
// in plain react-native primitives so it renders through React Native for Web
// untouched — "responsive" = flexWrap + a useWindowDimensions breakpoint, the
// RNW way rather than media queries.
//
// Section order is conversion-optimised: hero promise → one-line CTA → proof
// stats → how it works → live course catalog → sector breadth → closing CTA →
// footer. Every CTA routes to /login, where the normal auth flow takes over.
// ===========================================================================
import { useMemo } from 'react';
import { View, Text, StyleSheet, Image, Pressable, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CATEGORY_LABELS, type LandingCourse } from '../api/landing';
import { CATEGORY_LIST, sectorColor } from '../api/courses';
import { theme } from '../constants/theme';

interface Props {
  courses: LandingCourse[];
  onGetStarted: () => void;
}

export function LandingContent({ courses, onGetStarted }: Props) {
  const { width } = useWindowDimensions();
  const wide = width >= 900; // desktop layout

  // Proof stats, derived live from the public catalog — no fabricated numbers.
  const stats = useMemo(() => {
    const sectors = new Set(courses.map((c) => c.category)).size;
    const partners = new Set(courses.map((c) => c.provider_name ?? c.id)).size;
    const openSeats = courses.reduce((n, c) => n + Math.max(0, c.seats_total - c.seats_filled), 0);
    return { courses: courses.length, sectors, partners, openSeats };
  }, [courses]);

  // Which of the 18 sectors currently have at least one listing — drives the
  // sector strip so it always matches reality.
  const liveSectors = useMemo(() => {
    const present = new Set(courses.map((c) => c.category));
    return CATEGORY_LIST.filter((cat) => present.has(cat));
  }, [courses]);

  return (
    <View style={styles.page}>
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <View style={styles.nav}>
        <View style={styles.brand}>
          <Ionicons name="leaf" size={26} color={theme.colors.primary} />
          <Text style={styles.logo}>SkillFarm</Text>
        </View>
        <View style={styles.navActions}>
          <Pressable onPress={onGetStarted} style={styles.navSignIn}>
            <Text style={styles.navSignInText}>Sign in</Text>
          </Pressable>
          <Pressable onPress={onGetStarted} style={styles.navCta}>
            <Text style={styles.navCtaText}>Join free</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.heroInner}>
          <View style={[styles.heroText, wide && styles.heroTextWide]}>
            <View style={styles.heroBadge}>
              <Ionicons name="location-outline" size={13} color={theme.colors.primaryDark} />
              <Text style={styles.heroBadgeText}>In-person training • Offline-first</Text>
            </View>
            <Text style={styles.heroTitle}>
              Learn agriculture and rural skills{' '}
              <Text style={{ color: theme.colors.primary }}>from trainers near you</Text>.
            </Text>
            <Text style={styles.heroSub}>
              SkillFarm connects learners with local Learning Partners — crop
              cultivation, horticulture, dairy, poultry, food processing and more.
              Find a course, choose your seat, book in a few taps, show up and learn. No
              internet needed in the classroom.
            </Text>
            <View style={styles.heroCtaRow}>
              <Pressable style={styles.heroCta} onPress={onGetStarted}>
                <Text style={styles.heroCtaText}>Get started — it's free</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </Pressable>
              <Text style={styles.heroFine}>For learners and training organisations.</Text>
            </View>
          </View>
          {/* Decorative art column — hidden on phones where vertical space matters */}
          {wide && (
            <View style={styles.heroArtWrap}>
              <View style={styles.heroArtCard}>
                <Ionicons name="school-outline" size={54} color={theme.colors.primary} />
                <Text style={styles.heroArtTitle}>Practical-first batches</Text>
                <Text style={styles.heroArtSub}>Small groups, local sites, real equipment.</Text>
              </View>
              <View style={[styles.heroArtCard, styles.heroArtCardB]}>
                <Ionicons name="ticket-outline" size={54} color={theme.colors.accent} />
                <Text style={styles.heroArtTitle}>Book your seat in a few taps</Text>
                <Text style={styles.heroArtSub}>Get an immediate booking confirmation.</Text>
              </View>
              <View style={[styles.heroArtCard, styles.heroArtCardC]}>
                <Ionicons name="cloud-offline-outline" size={54} color={theme.colors.primaryDark} />
                <Text style={styles.heroArtTitle}>Works offline</Text>
                <Text style={styles.heroArtSub}>Your enrolments stay with you.</Text>
              </View>
            </View>
          )}
        </View>

        {/* Proof strip */}
        <View style={styles.statsBar}>
          <Stat value={String(stats.courses)} label={stats.courses === 1 ? 'course listed' : 'courses listed'} />
          <Divider wide={wide} />
          <Stat value={String(stats.sectors)} label="skill sectors" />
          <Divider wide={wide} />
          <Stat value={String(stats.partners)} label={stats.partners === 1 ? 'learning partner' : 'learning partners'} />
          <Divider wide={wide} />
          <Stat value={String(stats.openSeats)} label="seats open now" />
        </View>
      </View>

      {/* ── How it works ────────────────────────────────────────────────── */}
      <View style={styles.section}>
        <Text style={styles.kicker}>How it works</Text>
        <Text style={styles.sectionTitle}>Three steps from browsing to bench</Text>
        <View style={styles.steps}>
          <Step n="1" icon="search" title="Find a course" body="Browse trainings by sector, district or date — the catalog is always current." />
          <Step n="2" icon="flash-outline" title="Choose your seat" body="Choose an available seat, confirm your details, and see your booking under My Seats." />
          <Step n="3" icon="people" title="Show up and learn" body="In-person batches with real equipment. Your enrolment lives on your phone, not in the cloud." />
        </View>
      </View>

      {/* ── Course catalog ──────────────────────────────────────────────── */}
      <View style={[styles.section, styles.sectionTinted]}>
        <View style={styles.catalogHead}>
          <View style={{ flexShrink: 1 }}>
            <Text style={styles.kicker}>Live catalog</Text>
            <Text style={styles.sectionTitle}>
              {courses.length > 0 ? `Courses open for enrollment (${courses.length})` : 'No courses listed yet'}
            </Text>
          </View>
          <Pressable onPress={onGetStarted} style={styles.catalogCta}>
            <Text style={styles.catalogCtaText}>See all & register →</Text>
          </Pressable>
        </View>
        {courses.length === 0 ? (
          <Text style={styles.empty}>
            Learning Partners are joining every week — check back soon, or sign in
            and register your own organization as a partner.
          </Text>
        ) : (
          <View style={styles.grid}>
            {courses.map((c) => (
              <View key={c.id} style={styles.card}>
                {c.image_url ? (
                  <Image source={{ uri: c.image_url }} style={styles.cardImage} />
                ) : (
                  <View style={[styles.cardImage, { backgroundColor: sectorColor(c.category) }]}>
                    <Ionicons name="book-outline" size={36} color="#fff" />
                  </View>
                )}
                <View style={styles.cardBody}>
                  <View style={[styles.chip, { backgroundColor: sectorColor(c.category) }]}>
                    <Text style={styles.chipText}>{CATEGORY_LABELS[c.category] ?? c.category}</Text>
                  </View>
                  <Text style={styles.cardTitle} numberOfLines={2}>{c.title}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>
                    <Ionicons name="business-outline" size={13} color={theme.colors.textMuted} />
                    {' '}{c.provider_name ?? 'Learning Partner'}
                    {c.city ? ` • ${c.city}${c.state ? `, ${c.state}` : ''}` : ''}
                  </Text>
                  {c.description ? <Text style={styles.cardDesc} numberOfLines={2}>{c.description}</Text> : null}
                  <View style={styles.cardFoot}>
                    <Text style={styles.cardFee}>
                      {c.fee && c.fee > 0 ? `₹${c.fee}` : 'Free'}
                      {c.discount && c.discount > 0 ? `  (₹${c.discount} off)` : ''}
                    </Text>
                    <Text style={[styles.cardSeats, c.seats_total - c.seats_filled > 0 ? {} : styles.cardSeatsFull]}>
                      {c.seats_total - c.seats_filled > 0
                        ? `${c.seats_total - c.seats_filled} seats left`
                        : 'Waitlist only'}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* ── Sector breadth ──────────────────────────────────────────────── */}
      {liveSectors.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.kicker}>What we teach</Text>
          <Text style={styles.sectionTitle}>Training across {liveSectors.length} {liveSectors.length === 1 ? 'sector' : 'sectors'}</Text>
          <View style={styles.sectorGrid}>
            {liveSectors.map((cat) => (
              <View key={cat} style={styles.sectorChip}>
                <View style={[styles.sectorDot, { backgroundColor: sectorColor(cat) }]} />
                <Text style={styles.sectorText}>{CATEGORY_LABELS[cat]}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* ── Closing CTA ─────────────────────────────────────────────────── */}
      <View style={styles.footerCta}>
        <Text style={styles.footerCtaTitle}>Ready to learn something new?</Text>
        <Text style={styles.footerCtaSub}>
          Create a free learner account, or register your organization as a
          Learning Partner and publish your first course today.
        </Text>
        <Pressable style={styles.footerCtaBtn} onPress={onGetStarted}>
          <Text style={styles.footerCtaBtnText}>Create a free account</Text>
          <Ionicons name="arrow-forward" size={16} color="#fff" />
        </Pressable>
      </View>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <View style={styles.footer}>
        <Text style={styles.footerLogo}>SkillFarm</Text>
        <Text style={styles.footerTag}>
          Offline-first course registration for rural skilling.
        </Text>
        <View style={styles.footerLinks}>
          <Pressable onPress={onGetStarted}>
            <Text style={styles.footerLink}>Sign in</Text>
          </Pressable>
          <Pressable onPress={onGetStarted}>
            <Text style={styles.footerLink}>Create account</Text>
          </Pressable>
          <Text style={styles.footerLink}>© {new Date().getFullYear()} SkillFarm</Text>
        </View>
      </View>
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Divider({ wide }: { wide: boolean }) {
  return <View style={[styles.divider, !wide && styles.dividerHiddenMobile]} />;
}

function Step({ n, icon, title, body }: { n: string; icon: keyof typeof Ionicons.glyphMap; title: string; body: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepTop}>
        <View style={styles.stepNum}>
          <Text style={styles.stepNumText}>{n}</Text>
        </View>
        <Ionicons name={icon} size={24} color={theme.colors.primary} />
      </View>
      <Text style={styles.stepTitle}>{title}</Text>
      <Text style={styles.stepBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.colors.background },

  // nav
  nav: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    maxWidth: 1120, width: '100%', alignSelf: 'center',
    paddingHorizontal: 24, paddingVertical: 16,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { fontSize: 22, fontWeight: '800', color: theme.colors.primary },
  navActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navSignIn: { paddingHorizontal: 12, paddingVertical: 8 },
  navSignInText: { color: theme.colors.text, fontWeight: '600', fontSize: 14 },
  navCta: {
    backgroundColor: theme.colors.primary, borderRadius: theme.radius.pill,
    paddingHorizontal: 18, paddingVertical: 9,
  },
  navCtaText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // hero
  hero: {
    backgroundColor: theme.colors.surface,
    borderBottomWidth: 1, borderBottomColor: theme.colors.border,
    paddingTop: 32,
  },
  heroInner: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 1120, width: '100%',
    alignSelf: 'center', paddingHorizontal: 24, gap: 48,
  },
  heroText: { flexBasis: 0, flexGrow: 1 },
  heroTextWide: { maxWidth: 560 },
  heroBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.pill,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16,
  },
  heroBadgeText: { fontSize: 12, fontWeight: '700', color: theme.colors.primaryDark },
  heroTitle: { fontSize: 38, lineHeight: 46, fontWeight: '800', color: theme.colors.text },
  heroSub: { fontSize: 16.5, lineHeight: 26, color: theme.colors.textMuted, marginTop: 16 },
  heroCtaRow: { marginTop: 26 },
  heroCta: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: theme.colors.primary, borderRadius: theme.radius.md,
    paddingHorizontal: 24, paddingVertical: 15,
  },
  heroCtaText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  heroFine: { fontSize: 13, color: theme.colors.textMuted, marginTop: 10 },
  heroArtWrap: { flexDirection: 'column', gap: 14, maxWidth: 320 },
  heroArtCard: {
    backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radius.lg,
    padding: 16, borderWidth: 1, borderColor: theme.colors.border,
  },
  heroArtCardB: { marginLeft: 40 },
  heroArtCardC: { marginLeft: 20 },
  heroArtTitle: { fontWeight: '800', color: theme.colors.text, marginTop: 8 },
  heroArtSub: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },

  // stats
  statsBar: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between',
    maxWidth: 1120, width: '100%', alignSelf: 'center',
    marginHorizontal: 'auto', paddingHorizontal: 24, paddingVertical: 22, gap: 12,
  },
  stat: { alignItems: 'center', minWidth: 110 },
  statValue: { fontSize: 26, fontWeight: '800', color: theme.colors.primary },
  statLabel: { fontSize: 12.5, color: theme.colors.textMuted, marginTop: 2 },
  divider: { width: 1, height: 34, backgroundColor: theme.colors.border },
  dividerHiddenMobile: { display: 'none' },

  // sections
  section: { maxWidth: 1120, width: '100%', alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 44 },
  sectionTinted: {
    backgroundColor: theme.colors.surfaceAlt, maxWidth: undefined, width: '100%',
  },
  kicker: {
    fontSize: 12.5, fontWeight: '800', letterSpacing: 1.2,
    textTransform: 'uppercase', color: theme.colors.accent, marginBottom: 6,
  },
  sectionTitle: { fontSize: 24, fontWeight: '800', color: theme.colors.text, marginBottom: 20 },

  // how it works
  steps: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  step: {
    flexGrow: 1, flexBasis: 260, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg, padding: 20, borderWidth: 1, borderColor: theme.colors.border,
  },
  stepTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  stepNum: {
    width: 30, height: 30, borderRadius: 15, backgroundColor: theme.colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  stepTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, marginBottom: 4 },
  stepBody: { fontSize: 14, color: theme.colors.textMuted, lineHeight: 20 },

  // catalog
  catalogHead: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' },
  catalogCta: { paddingVertical: 8 },
  catalogCtaText: { color: theme.colors.primary, fontWeight: '700', fontSize: 14 },
  empty: { fontSize: 15, color: theme.colors.textMuted, lineHeight: 22, maxWidth: 560 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 18 },
  card: {
    flexGrow: 1, flexBasis: 270, maxWidth: 340, backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, overflow: 'hidden',
  },
  cardImage: { width: '100%', height: 150, alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 14 },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill, marginBottom: 8 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  cardTitle: { fontSize: 16.5, fontWeight: '800', color: theme.colors.text },
  cardMeta: { fontSize: 13, color: theme.colors.textMuted, marginTop: 4 },
  cardDesc: { fontSize: 13, color: theme.colors.textMuted, marginTop: 6, lineHeight: 18 },
  cardFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  cardFee: { fontSize: 14, fontWeight: '800', color: theme.colors.primary },
  cardSeats: { fontSize: 12.5, fontWeight: '700', color: theme.colors.success },
  cardSeatsFull: { color: theme.colors.warning },

  // sectors
  sectorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sectorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.pill, paddingHorizontal: 14, paddingVertical: 8,
  },
  sectorDot: { width: 10, height: 10, borderRadius: 5 },
  sectorText: { fontSize: 13.5, fontWeight: '600', color: theme.colors.text },

  // closing CTA
  footerCta: {
    backgroundColor: theme.colors.primary, alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 56,
  },
  footerCtaTitle: { fontSize: 28, fontWeight: '800', color: '#fff', textAlign: 'center' },
  footerCtaSub: { fontSize: 15.5, color: '#DDEBDD', textAlign: 'center', marginTop: 10, maxWidth: 520, lineHeight: 22 },
  footerCtaBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#fff', borderRadius: theme.radius.md,
    paddingHorizontal: 24, paddingVertical: 14, marginTop: 24,
  },
  footerCtaBtnText: { color: theme.colors.primaryDark, fontWeight: '800', fontSize: 16 },

  // footer
  footer: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 36 },
  footerLogo: { fontSize: 18, fontWeight: '800', color: theme.colors.primary },
  footerTag: { fontSize: 13, color: theme.colors.textMuted, marginTop: 6 },
  footerLinks: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 20, marginTop: 16 },
  footerLink: { fontSize: 13, color: theme.colors.textMuted, fontWeight: '600' },
});
