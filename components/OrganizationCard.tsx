// ===========================================================================
// OrganizationCard — the public Learning Partner profile shown to learners
// (on the course detail screen). Displays the organization's logo, name,
// about, year established, type, registration number, contact, address +
// maps link, languages offered, and its trainers. All fields gracefully
// hide when empty.
// ===========================================================================
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Linking, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../constants/theme';
import { getPublicOrgProfile, type PublicOrgProfile } from '../api/profile';
import { getPublicOrg, type PublicOrg } from '../api/landing';
import { listTrainersByProvider, type Trainer } from '../api/trainers';
import { CATEGORY_LABELS, sectorColor } from '../api/courses';
import { orgShareUrl } from '../lib/deeplink';
import { ShareButton } from './ShareButton';

interface Props {
  providerId: string;
}

export function OrganizationCard({ providerId }: Props) {
  const [org, setOrg] = useState<PublicOrgProfile | null>(null);
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [o, t] = await Promise.all([
          getPublicOrgProfile(providerId),
          listTrainersByProvider(providerId),
        ]);
        if (!alive) return;
        if (o) {
          setOrg(o);
          setTrainers(t);
          return;
        }
        // The authenticated and anonymous paths both use the safe public_orgs projection.
        throw new Error('fall-through-to-public');
      } catch {
        try {
          const pub = await getPublicOrg(providerId);
          if (!alive) return;
          if (pub) {
            const { trainers, ...rest } = pub;
            setOrg(rest as PublicOrgProfile);
            setTrainers((trainers ?? []) as unknown as Trainer[]);
          }
        } catch {
          /* best-effort: card is supplementary info */
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [providerId]);

  if (loading) {
    return (
      <View style={styles.loadingBox}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }
  if (!org) return null;

  const hasAnyOrgDetail = Boolean(
    org.org_name || org.org_about || org.org_logo_url || (org.org_images && org.org_images.length > 0) || org.org_email ||
    org.org_phone || org.org_address || org.org_website || org.org_languages ||
    org.org_year_established || org.org_type || org.org_registration_number ||
    (org.org_sectors && org.org_sectors.length > 0)
  );
  if (!hasAnyOrgDetail && trainers.length === 0) return null;

  const name = org.org_name || org.full_name || 'Learning Partner';

  function open(url: string | null) {
    if (!url) return;
    let u = url.trim();
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    Linking.openURL(u).catch(() => {});
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        {org.org_logo_url ? (
          <Image source={{ uri: org.org_logo_url }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoPlaceholder]}>
            <Ionicons name="business" size={24} color={theme.colors.primary} />
          </View>
        )}
        <View style={styles.headerText}>
          <Text style={styles.orgName}>{name}</Text>
          {org.org_type ? <Text style={styles.orgType}>{org.org_type}</Text> : null}
        </View>
        <ShareButton
          message={`Check out ${name} and their training courses on SkillFarm!`}
          url={orgShareUrl(providerId)}
          variant="ghost"
          size={24}
          color={theme.colors.textMuted}
        />
      </View>

      {org.org_about ? <Text style={styles.about}>{org.org_about}</Text> : null}

      {org.org_images && org.org_images.length > 0 ? (
        <View style={styles.gallerySection}>
          <Text style={styles.galleryTitle}>Training centre</Text>
          <View style={styles.gallery}>
            {org.org_images.map((url) => <Image key={url} source={{ uri: url }} style={styles.galleryImage} />)}
          </View>
        </View>
      ) : null}

      {org.org_sectors && org.org_sectors.length > 0 ? (
        <View style={styles.sectors}>
          {org.org_sectors.map((s) => (
            <View key={s} style={[styles.sectorChip, { backgroundColor: sectorColor(s) }]}>
              <Text style={styles.sectorChipText}>
                {CATEGORY_LABELS[s as keyof typeof CATEGORY_LABELS] ?? s}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.facts}>
        {org.org_year_established ? (
          <Fact icon="ribbon-outline" label="Established" value={`${org.org_year_established}`} />
        ) : null}
        {org.org_registration_number ? (
          <Fact icon="shield-checkmark-outline" label="Reg. number" value={org.org_registration_number} />
        ) : null}
        {org.org_languages ? (
          <Fact icon="language-outline" label="Languages" value={org.org_languages} />
        ) : null}
        {org.org_website ? (
          <Pressable onPress={() => open(org.org_website)} style={styles.factRow}>
            <Ionicons name="globe-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.factLabel}>Website</Text>
            <Text style={[styles.factValue, styles.link]} numberOfLines={1}>{org.org_website}</Text>
          </Pressable>
        ) : null}
        {org.org_email ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${org.org_email}`).catch(() => {})} style={styles.factRow}>
            <Ionicons name="mail-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.factLabel}>Email</Text>
            <Text style={[styles.factValue, styles.link]} numberOfLines={1}>{org.org_email}</Text>
          </Pressable>
        ) : null}
        {org.org_phone ? (
          <Pressable onPress={() => Linking.openURL(`tel:${org.org_phone}`).catch(() => {})} style={styles.factRow}>
            <Ionicons name="call-outline" size={18} color={theme.colors.primary} />
            <Text style={styles.factLabel}>Phone</Text>
            <Text style={[styles.factValue, styles.link]}>{org.org_phone}</Text>
          </Pressable>
        ) : null}
        {org.org_address ? (
          <Fact icon="location-outline" label="Office" value={org.org_address} multiline />
        ) : null}
        {org.org_maps_url ? (
          <Pressable onPress={() => open(org.org_maps_url)} style={styles.mapsBtn}>
            <Ionicons name="map-outline" size={16} color={theme.colors.primary} />
            <Text style={styles.mapsText}>View on Google Maps</Text>
          </Pressable>
        ) : null}
      </View>

      {trainers.length > 0 ? (
        <View style={styles.trainers}>
          <Text style={styles.trainersTitle}>Our Trainers</Text>
          {trainers.map((t) => (
            <View key={t.id} style={styles.trainer}>
              <View style={styles.trainerAvatar}>
                <Ionicons name="person" size={16} color={theme.colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.trainerName}>{t.name}</Text>
                {t.qualification ? <Text style={styles.trainerMeta}>Qualification · {t.qualification}</Text> : null}
                {t.experience ? <Text style={styles.trainerMeta}>Experience · {t.experience}</Text> : null}
                {t.expertise ? <Text style={styles.trainerMeta}>Expertise · {t.expertise}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Fact({ icon, label, value, multiline }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string; multiline?: boolean }) {
  return (
    <View style={styles.factRow}>
      <Ionicons name={icon} size={18} color={theme.colors.primary} />
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={[styles.factValue, multiline && styles.factValueMulti]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, padding: 16, borderWidth: 1, borderColor: theme.colors.border, ...theme.shadow.card },
  loadingBox: { padding: 24, alignItems: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  logo: { width: 56, height: 56, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  logoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1 },
  orgName: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text },
  orgType: { fontSize: 13, color: theme.colors.textMuted, marginTop: 2 },
  about: { fontSize: 15, color: theme.colors.text, lineHeight: 22, marginBottom: 12 },
  facts: { gap: 10 },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  factLabel: { fontSize: 14, color: theme.colors.textMuted, width: 96 },
  factValue: { flex: 1, fontSize: 15, color: theme.colors.text, fontWeight: '600' },
  factValueMulti: { fontWeight: '400', lineHeight: 20 },
  link: { color: theme.colors.info },
  mapsBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingVertical: 6 },
  mapsText: { color: theme.colors.primary, fontSize: 14, fontWeight: '600' },
  trainers: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border },
  trainersTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, marginBottom: 10 },
  trainer: { flexDirection: 'row', gap: 10, paddingVertical: 6 },
  trainerAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  trainerName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  trainerMeta: { fontSize: 13, color: theme.colors.textMuted, marginTop: 1 },
  gallerySection: { marginBottom: 14 },
  galleryTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.text, marginBottom: 8 },
  gallery: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  galleryImage: { width: 92, height: 68, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  sectors: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  sectorChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: theme.radius.pill },
  sectorChipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
