// ===========================================================================
// Learner Profile — the learner's own account screen.
//
//   Profile picture    square-cropped upload to the `avatars` bucket
//   Basic information  name, registered email (read-only), phone
//   Stats              enrolled / completed / awaiting counts
//
// The email comes from the auth identity rather than a profiles column, so it
// always matches the account that signed in. There is deliberately no public
// learner profile: nothing on this screen is shown to other learners. The name
// written here is `full_name`, which is what the partner's enrollment dashboard,
// the export and the review list display.
// ===========================================================================
import { FocusGroup, FocusTextInput as TextInput } from '../../components/ui';
import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Image, ActivityIndicator, KeyboardAvoidingView, Platform, RefreshControl
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../../constants/theme';
import { Button } from '../../components/Button';
import { supabase } from '../../lib/supabase';
import { unregisterPush } from '../../lib/pushNotifications';
import { pickAndUploadImage, deleteImage, storagePathFromUrl } from '../../lib/storage';
import { getMyProfile, updateMyProfile, saveLearnerProfile } from '../../api/profile';
import { listMyRegistrations } from '../../api/registrations';
import { Alert } from '../../lib/alert';
import { useLanguage } from '../../lib/i18n';

export default function StudentProfileScreen() {
  const { t } = useLanguage();
  const [uid, setUid] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Editable fields
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  // Enrollment counters shown as stat tiles.
  const [stats, setStats] = useState({ enrolled: 0, completed: 0, pending: 0, waitlist: 0 });

  // isRefresh (from pull-to-refresh) skips the full-screen spinner. Kept out of
  // the dep array so `load`'s identity is stable and the focus effect fires once.
  const load = useCallback(async (isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      setLoadError(null);
      const { data: u } = await supabase.auth.getUser();
      const myId = u.user?.id ?? '';
      setUid(myId);
      setEmail(u.user?.email ?? '');
      if (!myId) return;

      const [p, regs] = await Promise.all([getMyProfile(), listMyRegistrations(myId)]);
      setName(p?.full_name ?? p?.first_name ?? '');
      setPhone(p?.phone ?? '');
      setAvatarUrl(p?.avatar_url ?? null);
      setStats({
        enrolled: regs.filter((r) => r.status === 'registered').length,
        completed: regs.filter((r) => r.status === 'completed').length,
        pending: regs.filter((r) => r.status === 'pending').length,
        waitlist: regs.filter((r) => r.status === 'waitlist').length,
      });
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load your profile.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ---- Profile picture ---------------------------------------------------
  // Uploaded and saved immediately (not on Save) so the picture cannot be lost
  // by abandoning the form, and the old object is removed rather than orphaned.
  async function onPickAvatar() {
    if (!uid) return;
    try {
      setUploading(true);
      const uploaded = await pickAndUploadImage('avatars', uid, [1, 1]);
      if (!uploaded) return;
      const previous = storagePathFromUrl('avatars', avatarUrl);
      await updateMyProfile({ avatar_url: uploaded.url });
      setAvatarUrl(uploaded.url);
      if (previous && previous !== uploaded.path) await deleteImage('avatars', previous);
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function onRemoveAvatar() {
    try {
      const previous = storagePathFromUrl('avatars', avatarUrl);
      await updateMyProfile({ avatar_url: null });
      setAvatarUrl(null);
      if (previous) await deleteImage('avatars', previous);
    } catch (e: any) {
      Alert.alert('Could not remove photo', e?.message ?? 'Please try again.');
    }
  }

  // ---- Save --------------------------------------------------------------
  async function onSave() {
    const finalName = name.trim();
    if (!finalName) {
      Alert.alert('Name required', 'Please enter your name before saving.');
      return;
    }
    try {
      setSaving(true);
      await saveLearnerProfile({ name: finalName, phone: phone.trim() || null });
      setName(finalName);
      Alert.alert('Saved ✅', 'Your details are up to date.');
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  // ---- Sign out ----------------------------------------------------------
  // Actually end the Supabase session (clears the persisted keychain entry too),
  // THEN go to the login screen. Just navigating to /login left the session
  // alive, so the user bounced straight back into the app on the next launch.
  function handleSignOut() {
    Alert.alert('Sign out?', 'You will be returned to the login screen.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          setSigningOut(true);
          try {
            // Stop push for this phone while we are still signed in (needs the session).
            await unregisterPush().catch(() => {});
            await supabase.auth.signOut();
          } catch {
            // Even if the network call fails, clear local state and leave.
          } finally {
            setSigningOut(false);
            router.replace('/login');
          }
        },
      },
    ]);
  }

  const initials =
    name.trim().split(/\s+/).slice(0, 2).map((s) => s.charAt(0)).join('').toUpperCase() || '?';

  if (loading && !refreshing) {
    return <View style={styles.center}><ActivityIndicator size="large" color={theme.colors.primary} /></View>;
  }

  return (
    // behavior="padding" works on iOS + edge-to-edge Android (SDK 54); the old
    // `Platform.OS === 'ios' ? 'padding' : undefined` left Android unprotected.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <FocusGroup>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(true); }}
            colors={[theme.colors.primary]}
          />
        }
      >
        {/* Switch role — deliberately the first and most prominent thing on this
            screen, mirroring the partner profile. It only navigates to the role
            picker (which has its own Sign out / Cancel path), so a stray tap
            changes nothing until a role is actually chosen — no confirm needed. */}
        <Pressable
          style={({ pressed }) => [styles.switchBanner, pressed && styles.switchBannerPressed]}
          onPress={() => router.replace('/role-select')}
          accessibilityRole="button"
          accessibilityLabel="Switch role. You are signed in as a Learner."
        >
          <View style={styles.switchIcon}>
            <Ionicons name="swap-horizontal" size={22} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.switchTitle}>Switch role</Text>
            <Text style={styles.switchSub}>
              You are a Learner. Tap to use SkillFarm as a Learning Partner.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#fff" />
        </Pressable>

        {loadError ? (
          <View style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={20} color={theme.colors.danger} />
            <Text style={styles.errorText}>{loadError}</Text>
            <Pressable onPress={() => load()} accessibilityLabel="Retry loading profile">
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {/* Profile picture */}
        <View style={styles.avatarRow}>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Button
              label={uploading ? 'Uploading…' : (avatarUrl ? 'Change photo' : 'Add photo')}
              variant="outline"
              loading={uploading}
              onPress={onPickAvatar}
            />
            <Text style={styles.hint}>Square crop, saved as soon as you pick it.</Text>
            {avatarUrl ? (
              <Pressable onPress={onRemoveAvatar} style={styles.removeBtn} accessibilityLabel="Remove profile photo">
                <Text style={styles.removeText}>Remove photo</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Stats */}
        <View style={styles.statRow}>
          <StatTile label={t.cd_enrolled} value={stats.enrolled} color={theme.colors.primary} />
          <StatTile label={t.cd_completed} value={stats.completed} color={theme.colors.info} />
          <StatTile label={t.cd_pendingApproval} value={stats.pending} color={theme.colors.warning} />
          <StatTile label={t.cd_waitlist} value={stats.waitlist} color={theme.colors.accent} />
        </View>

        {/* Basic information */}
        <Text style={styles.sectionTitle}>Basic information</Text>
        <Text style={styles.sectionSub}>
          Learning Partners see your name and phone for your booking.
        </Text>
        <Field label="Name" value={name} onChange={setName} placeholder="Priya Raman" autoCap="words" />

        {/* Registered email — read-only. It is the account identity; changing it
            means changing the login, which belongs in account settings. */}
        <Text style={styles.fieldLabel}>Registered email</Text>
        <View style={styles.readonlyBox}>
          <Ionicons name="mail-outline" size={16} color={theme.colors.textMuted} />
          <Text style={styles.readonlyText} numberOfLines={1}>{email || '—'}</Text>
          <Ionicons name="lock-closed" size={14} color={theme.colors.textMuted} />
        </View>
        <Text style={styles.hint}>This is the email you signed up with.</Text>

        <View style={{ height: 14 }} />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="+91…" keyboardType="phone-pad" />

        <Pressable onPress={() => router.push('/language-select?next=profile')} style={styles.languageCard} accessibilityRole="button">
          <View style={styles.languageIcon}><Ionicons name="language-outline" size={20} color={theme.colors.primary} /></View>
          <View style={{flex:1}}><Text style={styles.languageTitle}>Preferred language</Text><Text style={styles.languageSub}>Choose your language priority</Text></View>
          <Ionicons name="chevron-forward" size={20} color={theme.colors.textMuted} />
        </Pressable>

        <View style={{ marginTop: 10 }}>
          <Button label="Save" fullWidth size="lg" loading={saving} onPress={onSave} />
        </View>

        {/* Bottom links */}
        <View style={styles.linksRow}>
          <Pressable onPress={handleSignOut} disabled={signingOut} accessibilityLabel="Sign out">
            {signingOut ? (
              <View style={styles.signOutRow}>
                <ActivityIndicator color={theme.colors.danger} />
                <Text style={[styles.link, { color: theme.colors.danger }]}>Signing out…</Text>
              </View>
            ) : (
              <Text style={[styles.link, { color: theme.colors.danger }]}>Sign out</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
      </FocusGroup>
    </KeyboardAvoidingView>
  );
}

function StatTile({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statTile}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.75}>{label}</Text>
    </View>
  );
}

// A label + rounded TextInput. Same shape as the partner profile's LabeledInput.
function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad' | 'url';
  autoCap?: 'none' | 'sentences' | 'words' | 'characters';
}) {
  const { label, value, onChange, placeholder, keyboardType, autoCap } = props;
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        keyboardType={keyboardType ?? 'default'}
        autoCapitalize={autoCap ?? 'sentences'}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  languageCard:{marginTop:18,padding:13,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface,flexDirection:'row',alignItems:'center',gap:10},
  languageIcon:{width:40,height:40,borderRadius:11,backgroundColor:theme.colors.primary+'14',alignItems:'center',justifyContent:'center'},
  languageTitle:{fontWeight:'800',color:theme.colors.text},
  languageSub:{fontSize:12,color:theme.colors.textMuted,marginTop:2},
  quickLinks:{gap:8,marginTop:18}, quickCard:{flexDirection:'row',alignItems:'center',gap:10,padding:13,borderRadius:14,borderWidth:1,borderColor:theme.colors.border,backgroundColor:theme.colors.surface}, quickTitle:{fontWeight:'800',color:theme.colors.text}, quickSub:{fontSize:12,color:theme.colors.textMuted,marginTop:2},
  container: { flex: 1, backgroundColor: theme.colors.background, paddingHorizontal: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: theme.colors.background },

  // Switch role banner — copied verbatim from the partner profile so both roles
  // see the identical prominent action at the top of their screen.
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
  sectionTitle: { fontSize: theme.font.title, fontWeight: '800', color: theme.colors.text, marginTop: 26, marginBottom: 4 },
  sectionSub: { fontSize: 13, color: theme.colors.textMuted, marginBottom: 12, lineHeight: 18 },
  hint: { fontSize: 12, color: theme.colors.textMuted, marginTop: 6, lineHeight: 17 },

  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 20, marginBottom: 6 },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: theme.colors.surfaceAlt },
  avatarPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border },
  avatarInitials: { fontSize: 30, fontWeight: '800', color: theme.colors.primary },
  removeBtn: { marginTop: 8, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 2 },
  removeText: { color: theme.colors.danger, fontSize: 13, fontWeight: '600' },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 18 },
  statTile: { flexBasis: '22%', flexGrow: 1, minWidth: 72, backgroundColor: theme.colors.surface, borderRadius: theme.radius.md, padding: 12, borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { fontSize: 12, color: theme.colors.textMuted, marginTop: 2, textAlign: 'center' },

  field: { marginBottom: 14 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: theme.colors.text, marginBottom: 6 },
  input: {
    backgroundColor: theme.colors.surface, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: theme.colors.text,
  },
  readonlyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: theme.colors.surfaceAlt, borderWidth: 1, borderColor: theme.colors.border,
    borderRadius: theme.radius.md, paddingHorizontal: 14, paddingVertical: 13,
  },
  readonlyText: { flex: 1, fontSize: 16, color: theme.colors.textMuted },

  errorCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16,
    backgroundColor: theme.colors.surface, borderRadius: theme.radius.md,
    borderWidth: 1, borderColor: theme.colors.danger, padding: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: theme.colors.text },
  retryText: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },

  linksRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 8 },
  link: { color: theme.colors.primary, fontSize: 16, fontWeight: '600' },
  signOutRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
