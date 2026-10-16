// ===========================================================================
// Profile helpers — read/update a user's profile, including the Learning
// Partner organization profile fields + the active/inactive toggle.
// ===========================================================================
import { supabase } from '../lib/supabase';
import type { Lang } from '../lib/i18n';
import { getPreferredLanguageLocal, setPreferredLanguageLocal } from '../lib/localPreferences';

export type Role = 'student' | 'provider';

export interface Profile {
  id: string;
  full_name: string | null;
  phone: string | null;
  role: Role;
  onboarding_complete: boolean;
  preferred_language: Lang | null;
  // Learner profile fields (see migration 20260822_learner_profile.sql).
  // The email is NOT stored here — auth.users owns it, read it from
  // supabase.auth.getUser() so it can never drift from the login identity.
  // first_name mirrors full_name; last_name is written null by the app and kept
  // only so existing rows can be cleared.
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  // Learning Partner (organization) profile fields:
  org_name: string | null;
  org_logo_url: string | null;
  org_images: string[] | null;
  org_about: string | null;
  org_year_established: number | null;
  org_type: string | null;
  org_registration_number: string | null;
  org_website: string | null;
  org_email: string | null;
  org_phone: string | null;
  org_address: string | null;
  org_maps_url: string | null;
  org_languages: string | null;
  org_sectors: string[] | null;  // multi-select training sectors (see CATEGORY_LIST)
  is_active: boolean;
  created_at?: string;
}

// Public-facing fields a learner is allowed to see.
export interface PublicOrgProfile {
  id: string;
  org_name: string | null;
  org_logo_url: string | null;
  org_images: string[] | null;
  org_about: string | null;
  org_year_established: number | null;
  org_type: string | null;
  org_registration_number: string | null;
  org_website: string | null;
  org_email: string | null;
  org_phone: string | null;
  org_address: string | null;
  org_maps_url: string | null;
  org_languages: string | null;
  org_sectors: string[] | null;
  full_name: string | null;
}

const PROFILE_FIELDS = '*';

const ORG_FIELDS =
  'id, full_name, phone, role, onboarding_complete, org_name, org_logo_url, org_images, org_about, '
  'org_year_established, org_type, org_registration_number, org_website, ' +
  'org_email, org_phone, org_address, org_maps_url, org_languages, org_sectors, ' +
  'is_active, created_at, first_name, last_name, avatar_url';

// ---------------------------------------------------------------------------
// Fetch my own profile (any role). Scoped by auth.uid() so it returns exactly
// one row — relying only on RLS + maybeSingle() breaks once >1 profile exists
// ("JSON object requested, multiple rows returned").
// ---------------------------------------------------------------------------
export async function getMyProfile(): Promise<Profile | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return null;
  const { data, error } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', u.user.id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const profile: any = { ...(data as any) };
  if (typeof profile.onboarding_complete !== 'boolean') profile.onboarding_complete = true;
  profile.preferred_language = profile.preferred_language ?? await getPreferredLanguageLocal();
  return profile as Profile;
}

// ---------------------------------------------------------------------------
// Fetch a PUBLIC org projection (what learners/visitors are allowed to see).
// ---------------------------------------------------------------------------
export async function getPublicOrgProfile(userId: string): Promise<PublicOrgProfile | null> {
  const { data, error } = await supabase
    .from('public_orgs')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data ? ({ ...(data as any), org_email: null, org_phone: null } as PublicOrgProfile) : null;
}

// Create a profile only when it does not already exist. This deliberately does
// not upsert defaults over an existing account's role/language/profile fields.
export async function ensureProfile(user: { id: string; user_metadata?: Record<string, any> | null }, phone?: string | null) {
  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return;

  const metadata = user.user_metadata ?? {};
  const fullName = String(metadata.full_name ?? metadata.name ?? '').trim() || null;
  const cleanPhone = phone ?? (metadata.phone ? String(metadata.phone).trim() : null);
  let { error } = await supabase.from('profiles').insert({
    id: user.id,
    full_name: fullName,
    first_name: fullName,
    phone: cleanPhone,
    role: 'student',
    onboarding_complete: false,
  });
  if (error && /onboarding_complete|schema cache|column/i.test(error.message ?? '')) {
    const fallback = await supabase.from('profiles').insert({
      id: user.id, full_name: fullName, first_name: fullName, phone: cleanPhone, role: 'student'
    });
    error = fallback.error;
  }
  if (error && error.code !== '23505') throw error;
}

// ---------------------------------------------------------------------------
// Update my profile. `changes` may include any subset of profile fields.
// We filter by the current user's id — PostgREST refuses a blanket update
// ("Update requires a Where clause"), and scoping to auth.uid() also matches
// the RLS "update own" policy.
// ---------------------------------------------------------------------------
export async function updateMyProfile(changes: Partial<Profile>): Promise<void> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error('Not signed in.');
  const { error } = await supabase
    .from('profiles')
    .update(changes as Record<string, any>)
    .eq('id', u.user.id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Toggle the Learning Partner's public visibility.
// Inactive partners are dropped from the learner Browse list by listCourses()
// (`!inner` join + a filter on the embedded profile), so their courses stop
// being offered to new learners. Existing registrations are untouched.
// ---------------------------------------------------------------------------
export async function setActive(isActive: boolean): Promise<void> {
  await updateMyProfile({ is_active: isActive });
}


export async function savePreferredLanguage(language: Lang): Promise<void> {
  // Runtime language persistence is local-first so older Supabase schemas do
  // not block the user from continuing through onboarding.
  await setPreferredLanguageLocal(language);
}

// ===========================================================================
// Learner profile — name, phone and photo only. The public learner profile
// (headline/bio/links/privacy switches and the /learner/[id] viewer) was
// removed; those columns still exist in the database but nothing reads them.
// ===========================================================================

export interface LearnerProfileInput {
  name: string | null;
  phone: string | null;
  preferred_language?: Lang | null;
}

// `full_name` is what api/courses.ts, api/reviews.ts and api/registrations.ts
// join for a display name, so it is the value the single name field writes.
// first_name is kept in step for the signup path in login.tsx, and last_name is
// cleared because the app no longer has a field for it.
export async function saveLearnerProfile(input: LearnerProfileInput): Promise<void> {
  const name = input.name?.trim() || null;
  await updateMyProfile({ full_name: name, phone: input.phone });
  try { await updateMyProfile({ first_name: name, last_name: null }); } catch { /* optional legacy columns */ }
}
