// ===========================================================================
// Learning Partner — Organization Profile editor.
// Lets the partner fill in the public org profile learners see (name, logo,
// about, year established, type, registration number, website, email, phone,
// office address, Google Maps location, languages), manage trainers (one
// organization can have many trainers), and toggle Active/Inactive.
//
// Active/Inactive is the public-visibility switch: while Inactive, this
// partner's courses are excluded from the learner Browse list by listCourses()
// (an `!inner` join on the profile plus a filter, so the rows never leave the
// database). Learners already holding a seat keep it.
// ===========================================================================
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, KeyboardAvoidingView, Platform, Switch
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../constants/theme';
import { Button } from '../../components/Button';
import { CATEGORY_LIST, CATEGORY_LABELS } from '../../api/courses';
import { supabase } from '../../lib/supabase';
import { pickAndUploadImage, deleteImage, storagePathFromUrl } from '../../lib/storage';
import {
  getMyProfile, updateMyProfile, setActive, type Profile,
} from '../../api/profile';
import {
  listMyTrainers, createTrainer, updateTrainer, deleteTrainer, type Trainer,
} from '../../api/trainers';
import { Alert } from '../../lib/alert';
import { useLanguage } from '../../lib/i18n';

const ORG_TYPES = ['Individual', 'Partnership', 'Private Ltd', 'LLP', 'Society', 'Trust', 'Govt. Body', 'Other'];

export default function ProviderProfileScreen() {
  return <ProviderProfileInner />;
}

function ProviderProfileInner() {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [uid, setUid] = useState<string>('');
  const [trainers, setTrainers] = useState<Trainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [active, setActiveState] = useState(true);

  // Editable org fields keyed to the Profile.
  const [orgName, setOrgName] = useState('');
  const [orgAbout, setOrgAbout] = useState('');
  const [orgYear, setOrgYear] = useState('');
  const [orgType, setOrgType] = useState('');
  const [orgReg, setOrgReg] = useState('');
  const [orgWebsite, setOrgWebsite] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [orgPhone, setOrgPhone] = useState('');
  const [orgAddress, setOrgAddress] = useState('');
  const [orgMaps, setOrgMaps] = useState('');
  const [orgLanguages, setOrgLanguages] = useState('');
  // Multi-select training sectors (the 18 agriculture/allied sectors).
  const [orgSectors, setOrgSectors] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [orgImages, setOrgImages] = useState<string[]>([]);
  const [uploadingOrgImage, setUploadingOrgImage] = useState(false);

  // Trainer editor (inline add).
  const [newTrainerName, setNewTrainerName] = useState('');
  const [newTrainerQual, setNewTrainerQual] = useState('');
  const [newTrainerExp, setNewTrainerExp] = useState('');
  const [newTrainerExperto, setNewTrainerExperto] = useState('');
  const [addingTrainer, setAddingTrainer] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id ?? '';
      setUid(myId);
      const p = await getMyProfile();
      setProfile(p);
      setOrgName(p?.org_name ?? '');
      setOrgAbout(p?.org_about ?? '');
      setOrgYear(p?.org_year_established ? String(p.org_year_established) : '');
      setOrgType(p?.org_type ?? '');
      setOrgReg(p?.org_registration_number ?? '');
      setOrgWebsite(p?.org_website ?? '');
      setOrgEmail(p?.org_email ?? '');
      setOrgPhone(p?.org_phone ?? '');
      setOrgAddress(p?.org_address ?? '');
      setOrgMaps(p?.org_maps_url ?? '');
      setOrgLanguages(p?.org_languages ?? '');
      setOrgSectors(p?.org_sectors ?? []);
      setLogoUrl(p?.org_logo_url ?? null);
      setOrgImages(p?.org_images ?? []);
      setActiveState(p?.is_active ?? true);
      if (myId) setTrainers(await listMyTrainers());
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ---- Logo upload / remove ----------------------------------------------
  async function onPickLogo() {
    if (!uid) return;
    try {
      setUploadingLogo(true);
      const uploaded = await pickAndUploadImage('org-logos', uid);
      if (uploaded) {
        if (logoPath) await deleteImage('org-logos', logoPath);
        setLogoUrl(uploaded.url);
        setLogoPath(uploaded.path);
        await updateMyProfile({ org_logo_url: uploaded.url });
      }
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    } finally {
      setUploadingLogo(false);
    }
  }

  async function onRemoveLogo() {
    if (logoPath) await deleteImage('org-logos', logoPath);
    setLogoUrl(null);
    setLogoPath(null);
    await updateMyProfile({ org_logo_url: null });
  }

  async function onAddOrgImage() {
    if (!uid || orgImages.length >= 6) return;
    try {
      setUploadingOrgImage(true);
      const uploaded = await pickAndUploadImage('org-logos', uid, [4, 3]);
      if (!uploaded) return;
      const next = [...orgImages, uploaded.url];
      setOrgImages(next);
      await updateMyProfile({ org_images: next });
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    } finally {
      setUploadingOrgImage(false);
    }
  }

  async function onRemoveOrgImage(url: string) {
    try {
      const path = storagePathFromUrl('org-logos', url);
      if (path) await deleteImage('org-logos', path);
      const next = orgImages.filter((x) => x !== url);
      setOrgImages(next);
      await updateMyProfile({ org_images: next });
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    }
  }

  // ---- Save org profile --------------------------------------------------
  async function onSaveProfile() {
    try {
      setSaving(true);
      await updateMyProfile({
        org_name: orgName.trim() || null,
        org_about: orgAbout.trim() || null,
        org_year_established: orgYear ? Number(orgYear) : null,
        org_type: orgType || null,
        org_registration_number: orgReg.trim() || null,
        org_website: orgWebsite.trim() || null,
        org_email: orgEmail.trim() || null,
        org_phone: orgPhone.trim() || null,
        org_address: orgAddress.trim() || null,
        org_maps_url: orgMaps.trim() || null,
        org_languages: orgLanguages.trim() || null,
        org_sectors: orgSectors,
        org_images: orgImages,
      });
      Alert.alert(`✓ ${t.savedOk}`, t.profileUpdated);
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    } finally {
      setSaving(false);
    }
  }

  // ---- Active / inactive toggle -----------------------------------------
  async function onToggleActive(value: boolean) {
    setActiveState(value);
    try {
      await setActive(value);
    } catch (e: any) {
      setActiveState(!value); // revert
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    }
  }

  // ---- Trainers CRUD -----------------------------------------------------
  async function onAddTrainer() {
    if (!newTrainerName.trim() || !profile) return;
    try {
      setAddingTrainer(true);
      const t = await createTrainer(profile.id, {
        name: newTrainerName.trim(),
        qualification: newTrainerQual.trim() || null,
        experience: newTrainerExp.trim() || null,
        expertise: newTrainerExperto.trim() || null,
      });
      setTrainers((prev) => [...prev, t]);
      setNewTrainerName(''); setNewTrainerQual(''); setNewTrainerExp(''); setNewTrainerExperto('');
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    } finally {
      setAddingTrainer(false);
    }
  }

  async function onDeleteTrainer(id: string) {
    try {
      await deleteTrainer(id);
      setTrainers((prev) => prev.filter((t) => t.id !== id));
    } catch (e: any) {
      Alert.alert(t.couldNotLoad, e?.message ?? t.retrySub);
    }
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
    >
      <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>
        ) : (
          <>
            {/* Switch role — deliberately the first and most prominent thing on
                this screen. It only navigates to the role picker (which has its
                own Cancel path via Sign out), so a stray tap changes nothing
                until a role is actually chosen — no confirm dialog needed. */}
            <Pressable
              style={({ pressed }) => [styles.switchBanner, pressed && styles.switchBannerPressed]}
              onPress={() => router.replace('/role-select')}
              accessibilityRole="button"
              accessibilityLabel="Switch role. You are signed in as a Learning Partner."
            >
              <View style={styles.switchIcon}>
                <Ionicons name="swap-horizontal" size={22} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.switchTitle}>{t.switchRole}</Text>
                <Text style={styles.switchSub}>{t.switchRoleProvider}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color="#fff" />
            </Pressable>

            <Text style={styles.heading}>{t.organizationProfile}</Text>
            <Text style={styles.subheading}>
              {t.organizationProfileSub}
            </Text>

            {/* Logo */}
            <View style={styles.logoRow}>
              {logoUrl ? (
                <Image source={{ uri: logoUrl }} style={styles.logo} />
              ) : (
                <View style={[styles.logo, styles.logoPlaceholder]}>
                  <Ionicons name="business" size={26} color={theme.colors.primary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Button
                  label={uploadingLogo ? '…' : (logoUrl ? t.changeLogo : t.addLogo)}
                  variant="outline"
                  loading={uploadingLogo}
                  onPress={onPickLogo}
                />
                {logoUrl ? (
                  <Pressable onPress={onRemoveLogo} style={styles.removeLogo}>
                    <Text style={styles.removeLogoText}>{t.remove}</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>

            <Text style={styles.fieldLabel}>{t.organizationPhotos}</Text>
            <Text style={styles.subheading}>{t.organizationPhotosSub}</Text>
            <View style={styles.orgGallery}>
              {orgImages.map((url) => (
                <View key={url} style={styles.orgGalleryItem}>
                  <Image source={{ uri: url }} style={styles.orgGalleryImage} />
                  <Pressable onPress={() => onRemoveOrgImage(url)} style={styles.orgGalleryRemove} accessibilityLabel="Remove organization photo">
                    <Ionicons name="close" size={13} color="#fff" />
                  </Pressable>
                </View>
              ))}
              {orgImages.length < 6 ? (
                <Pressable onPress={onAddOrgImage} style={styles.orgGalleryAdd} disabled={uploadingOrgImage}>
                  <Ionicons name={uploadingOrgImage ? 'cloud-upload-outline' : 'add'} size={24} color={theme.colors.primary} />
                  <Text style={styles.orgGalleryAddText}>{uploadingOrgImage ? '…' : t.addPhoto}</Text>
                </Pressable>
              ) : null}
            </View>

            <LabeledInput label={t.organizationName} value={orgName} onChange={setOrgName} placeholder="e.g. GreenFields Agri Academy" />
            <LabeledInput label={t.aboutOrganization} value={orgAbout} onChange={setOrgAbout} placeholder={t.aboutPlaceholder} multiline />
            <LabeledInput label={t.yearEstablished} value={orgYear} onChange={setOrgYear} placeholder="e.g. 2015" keyboardType="numeric" />

            {/* Organization type chips */}
            <Text style={styles.fieldLabel}>{t.organizationType}</Text>
            <View style={styles.chips}>
              {ORG_TYPES.map((t) => (
                <Pressable
                  key={t}
                  style={[styles.chip, orgType === t ? styles.chipActive : styles.chipInactive]}
                  onPress={() => setOrgType(orgType === t ? '' : t)}
                >
                  <Text style={[styles.chipText, orgType === t ? styles.chipTextActive : {}]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            {/* Training sectors — multi-select (18 agriculture/allied sectors) */}
            <Text style={styles.fieldLabel}>{t.trainingSectors}</Text>
            <Text style={styles.subheading}>{t.trainingSectorsSub}</Text>
            <View style={styles.chips}>
              {CATEGORY_LIST.map((s) => {
                const on = orgSectors.includes(s);
                return (
                  <Pressable
                    key={s}
                    style={[styles.chip, on ? styles.chipActive : styles.chipInactive]}
                    onPress={() =>
                      setOrgSectors((prev) =>
                        on ? prev.filter((x) => x !== s) : [...prev, s],
                      )
                    }
                  >
                    <Text style={[styles.chipText, on ? styles.chipTextActive : {}]}>
                      {CATEGORY_LABELS[s]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <LabeledInput label={t.registrationNumber} value={orgReg} onChange={setOrgReg} placeholder="Verified reg. no." />
            <LabeledInput label={t.website} value={orgWebsite} onChange={setOrgWebsite} placeholder="https://…" keyboardType="url" autoCap="none" />
            <LabeledInput label={t.email ?? 'Email'} value={orgEmail} onChange={setOrgEmail} placeholder="org@example.com" keyboardType="email-address" autoCap="none" />
            <LabeledInput label={t.phone} value={orgPhone} onChange={setOrgPhone} placeholder="+91…" keyboardType="phone-pad" />
            <LabeledInput label={t.officeAddress} value={orgAddress} onChange={setOrgAddress} placeholder="Street, city, state…" multiline />
            <LabeledInput label={t.mapsLocation} value={orgMaps} onChange={setOrgMaps} placeholder="https://maps.google.com/…" autoCap="none" />
            <LabeledInput label={t.languagesOffered} value={orgLanguages} onChange={setOrgLanguages} placeholder="Tamil, English, Hindi…" />

            <Pressable onPress={() => router.push('/language-select?next=profile')} style={styles.languageCard} accessibilityRole="button">
              <View style={styles.languageIcon}><Ionicons name="language-outline" size={20} color={theme.colors.primary} /></View>
              <View style={{flex:1}}><Text style={styles.languageTitle}>{t.preferredLanguage}</Text><Text style={styles.languageSub}>{t.preferredLanguageSub}</Text></View>
              <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
            </Pressable>

            {/* Save profile */}
            <View style={{ marginTop: 12 }}>
              <Button label={t.saveProfile} fullWidth size="lg" loading={saving} onPress={onSaveProfile} />
            </View>

            {/* Trainers */}
            <Text style={styles.sectionTitle}>{t.trainers}</Text>
            <Text style={styles.subheading}>{t.trainersSub}</Text>

            {trainers.length > 0 ? (
              <View style={styles.trainerList}>
                {trainers.map((t) => (
                  <View key={t.id} style={styles.trainerRow}>
                    <View style={styles.trainerIcon}>
                      <Ionicons name="person" size={18} color={theme.colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.trainerName}>{t.name}</Text>
                      {t.qualification ? <Text style={styles.trainerMeta}>Qualification · {t.qualification}</Text> : null}
                      {t.experience ? <Text style={styles.trainerMeta}>Experience · {t.experience}</Text> : null}
                      {t.expertise ? <Text style={styles.trainerMeta}>Expertise · {t.expertise}</Text> : null}
                    </View>
                    <Pressable onPress={() => onDeleteTrainer(t.id)} style={styles.trainerDelete} accessibilityRole="button" accessibilityLabel="Delete">
                      <Ionicons name="trash-outline" size={18} color={theme.colors.danger} />
                    </Pressable>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.empty}>{t.noTrainers}</Text>
            )}

            {/* Add trainer */}
            <View style={styles.addTrainerCard}>
              <LabeledInput label="Name" value={newTrainerName} onChange={setNewTrainerName} placeholder="Trainer full name" />
              <LabeledInput label="Qualification" value={newTrainerQual} onChange={setNewTrainerQual} placeholder="e.g. B.Sc Agriculture" />
              <LabeledInput label="Experience" value={newTrainerExp} onChange={setNewTrainerExp} placeholder="e.g. 8 years" />
              <LabeledInput label="Expertise" value={newTrainerExperto} onChange={setNewTrainerExperto} placeholder="e.g. Organic farming" />
              <Button label={t.addTrainer} variant="secondary" loading={addingTrainer} onPress={onAddTrainer} />
            </View>

            {/* Active / Inactive — controls whether learners see this partner's
                courses on the Browse page. */}
            <View style={styles.toggleCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.toggleTitle}>
                  {t.publicListing}: {active ? t.active : t.inactive}
                </Text>
                <Text style={styles.subheading}>
                  {active ? t.activeSub : t.inactiveSub}
                </Text>
              </View>
              <Switch
                value={active}
                onValueChange={onToggleActive}
                trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
                thumbColor="#fff"
                accessibilityLabel="Show my courses on the learner Browse page"
              />
            </View>

            {/* Bottom links — "Switch role" lives in the banner at the top of
                this screen now, so only Sign out is left here. */}
            <View style={styles.linksRow}>
              <Pressable onPress={async () => { await supabase.auth.signOut(); router.replace('/login'); }}>
                <Text style={[styles.link, { color: theme.colors.danger }]}>{t.signOut}</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// LabeledInput — a label + rounded TextInput, used across the profile form.
function LabeledInput(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad' | 'url';
  autoCap?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const { label, value, onChange, placeholder, multiline, keyboardType, autoCap } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        multiline={multiline}
        numberOfLines={multiline ? 3 : undefined}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCap ?? 'sentences'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  languageCard:{marginTop:12,padding:13,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface,flexDirection:'row',alignItems:'center',gap:10},
  languageIcon:{width:40,height:40,borderRadius:11,backgroundColor:theme.colors.primary+'14',alignItems:'center',justifyContent:'center'},
  languageTitle:{fontWeight:'800',color:theme.colors.text},
  languageSub:{fontSize:12,color:theme.colors.textMuted,marginTop:2},
  container: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: theme.font.heading, fontWeight: '800', color: theme.colors.text, marginTop: 16, marginBottom: 4 },
  // Switch role banner — solid primary on the page background so it reads as
  // the primary action before any of the form fields.
  switchBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: theme.colors.primary, borderRadius: theme.radius.lg,
    paddingHorizontal: 14, paddingVertical: 14, marginTop: 16,
  },
  switchBannerPressed: { opacity: 0.85 },
  switchIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center',
  },
  switchTitle: { fontSize: 17, fontWeight: '800', color: '#fff' },
  switchSub: { fontSize: 13, color: 'rgba(255,255,255,0.9)', marginTop: 2, lineHeight: 18 },
  sectionTitle: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginTop: 28, marginBottom: 4 },
  subheading: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 12, lineHeight: 18 },
  field: { marginBottom: 14 },
  orgGallery: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  orgGalleryItem: { width: 104, height: 78, borderRadius: theme.radius.md, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: theme.colors.border },
  orgGalleryImage: { width: '100%', height: '100%' },
  orgGalleryRemove: { position: 'absolute', top: 5, right: 5, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  orgGalleryAdd: { width: 104, height: 78, borderRadius: theme.radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.colors.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.surface },
  orgGalleryAddText: { color: theme.colors.primary, fontSize: 12, fontWeight: '700', marginTop: 3 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 6 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: theme.colors.text,
  },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 18, marginTop: 8 },
  logo: { width: 64, height: 64, borderRadius: theme.radius.md, backgroundColor: theme.colors.surfaceAlt },
  logoPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  removeLogo: { marginTop: 6, alignSelf: 'flex-start' },
  removeLogoText: { color: theme.colors.danger, fontSize: 13, fontWeight: '600' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors.border },
  chipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  chipInactive: { backgroundColor: theme.colors.surface },
  chipText: { fontSize: 13, fontWeight: '600', color: theme.colors.textMuted },
  chipTextActive: { color: '#fff' },
  trainerList: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 8, marginBottom: 12, ...theme.shadow.card },
  trainerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.border },
  trainerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  trainerName: { fontSize: 15, fontWeight: '700', color: theme.colors.text },
  trainerMeta: { fontSize: 13, color: theme.colors.textMuted, marginTop: 1 },
  trainerDelete: { padding: 8 },
  empty: { fontSize: 14, color: theme.colors.textMuted, marginBottom: 12 },
  addTrainerCard: { backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 14, marginBottom: 16, gap: 4, ...theme.shadow.card },
  toggleCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: theme.colors.surface, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: theme.colors.border, padding: 16, marginTop: 16, ...theme.shadow.card },
  toggleTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text, marginBottom: 4 },
  linksRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 24, marginBottom: 8 },
  link: { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
});

