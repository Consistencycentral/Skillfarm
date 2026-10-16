// ===========================================================================
// Landing — the public course catalog for the web landing page.
//
// Reads the `public_courses` view (supabase/public_catalog.sql), which is the
// deliberate anon-readable exception to the authenticated-only RLS on
// `courses`: marketing columns only, no partner contact details, no learner
// PII. Keep this file's field list in sync with that view.
// ===========================================================================
import { supabase } from '../lib/supabase';
import { CATEGORY_LABELS, type CourseCategory, type CourseWithProvider } from './courses';

export interface LandingCourse {
  id: string;
  provider_id: string;
  title: string;
  description: string | null;
  category: CourseCategory;
  address: string | null;
  city: string | null;
  state: string | null;
  start_date: string | null;
  duration_weeks: number | null;
  seats_total: number;
  seats_filled: number;
  fee: number | null;
  discount: number | null;
  image_url: string | null;
  images: string[] | null;
  learning_outcomes: string | null;
  agenda: string | null;
  batch_timings: string | null;
  registration_deadline: string | null;
  language: string | null;
  certificate_available: boolean | null;
  eligibility: string | null;
  provider_name: string | null;
  created_at: string;
  translations?: any;
  trainer_name?: string | null;
  trainer_bio?: string | null;
  certificate_url?: string | null;
  certificate_name?: string | null;
}

// The public org shape the /org/<id> page + OrganizationCard render for
// anonymous visitors — same field names as PublicOrgProfile, minus email/phone
// (excluded from the view) and with trainers flattened in.
export interface PublicOrg {
  id: string;
  full_name: string | null;
  org_name: string | null;
  org_logo_url: string | null;
  org_images: string[] | null;
  org_about: string | null;
  org_year_established: number | null;
  org_type: string | null;
  org_registration_number: string | null;
  org_website: string | null;
  org_address: string | null;
  org_maps_url: string | null;
  org_languages: string | null;
  org_sectors: string[] | null;
  trainers: { name: string | null; qualification: string | null; experience: number | null; expertise: string | null }[];
}

const LANDING_COLUMNS =
  'id, provider_id, title, description, category, address, city, state, start_date, duration_weeks, seats_total, seats_filled, fee, discount, image_url, images, learning_outcomes, agenda, batch_timings, registration_deadline, language, certificate_available, eligibility, provider_name, created_at';

// v8 columns. If the v8 SQL has not been run yet the view lacks them (Postgres
// 42703), so every public query retries with the old column list instead of
// breaking the landing page.
const LANDING_COLUMNS_V8 = LANDING_COLUMNS + ', translations, trainer_name, trainer_bio, certificate_url, certificate_name';

function isMissingColumn(error: any): boolean {
  return error?.code === '42703' || /column .* does not exist|Could not find the/i.test(String(error?.message ?? ''));
}

export async function listPublicCourses(): Promise<LandingCourse[]> {
  let { data, error } = (await supabase
    .from('public_courses')
    .select(LANDING_COLUMNS_V8)
    .order('created_at', { ascending: false })
    .limit(12)) as unknown as { data: any; error: any };
  if (error && isMissingColumn(error)) {
    ({ data, error } = (await supabase
      .from('public_courses')
      .select(LANDING_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(12)) as unknown as { data: any; error: any });
  }
  if (error) {
    // The usual cause of a live failure here is the view not existing yet
    // (public_catalog.sql never run against this project).
    throw new Error(
      error.code === '42P01' || error.code === 'PGRST116'
        ? 'Public catalog not available yet — run supabase/public_catalog.sql in the SQL Editor.'
        : error.message,
    );
  }
  return (data ?? []) as LandingCourse[];
}

// A single course for the shared /course/<id> web link, readable while signed
// out. Returns null (not a throw) for an unknown id so the page can show a
// friendly "course not found" instead of an error stack.
export async function getPublicCourse(id: string): Promise<CourseWithProvider | null> {
  let { data, error } = (await supabase
    .from('public_courses')
    .select(LANDING_COLUMNS_V8)
    .eq('id', id)
    .maybeSingle()) as unknown as { data: any; error: any };
  if (error && isMissingColumn(error)) {
    ({ data, error } = (await supabase
      .from('public_courses')
      .select(LANDING_COLUMNS)
      .eq('id', id)
      .maybeSingle()) as unknown as { data: any; error: any });
  }
  if (error) throw error;
  if (!data) return null;
  // Contact phone is intentionally not in the public view; the detail screen's
  // phone/whatsapp buttons simply don't render for anonymous visitors.
  return { ...(data as any), provider_phone: null, contact_phone: null } as CourseWithProvider;
}

// A single org for the shared /org/<id> web link, readable while signed out.
export async function getPublicOrg(id: string): Promise<PublicOrg | null> {
  const { data, error } = await supabase
    .from('public_orgs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as PublicOrg) ?? null;
}

// The public view also powers the landing's per-org course lists; keep it cheap.
export async function listPublicCoursesByOrg(providerId: string): Promise<LandingCourse[]> {
  let { data, error } = (await supabase
    .from('public_courses')
    .select(LANDING_COLUMNS_V8)
    .eq('provider_id', providerId)
    .order('created_at', { ascending: false })) as unknown as { data: any; error: any };
  if (error && isMissingColumn(error)) {
    ({ data, error } = (await supabase
      .from('public_courses')
      .select(LANDING_COLUMNS)
      .eq('provider_id', providerId)
      .order('created_at', { ascending: false })) as unknown as { data: any; error: any });
  }
  if (error) throw error;
  return (data ?? []) as LandingCourse[];
}

export { CATEGORY_LABELS };
