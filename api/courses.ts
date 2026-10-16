// ===========================================================================
// Course helpers — read/create/update courses in Supabase.
// Used by the student Browse screen and the provider Courses screen.
// ===========================================================================
import { supabase } from '../lib/supabase';

// Agriculture & allied training sectors. Used for BOTH:
//   - `courses.category` (one sector per course — the single-select picker on
//     the course-edit form + the Browse filter chips), AND
//   - `profiles.org_sectors` (multi-select on the Organization Profile — which
//     sectors this training centre offers).
// Same fixed list in both places, so a partner's chosen org sectors and their
// individual courses stay consistent.
export type CourseCategory =
  | 'crop_cultivation'
  | 'horticulture'
  | 'seed_technology'
  | 'crop_protection'
  | 'agro_processing'
  | 'food_processing'
  | 'post_harvest'
  | 'dairy'
  | 'animal_husbandry'
  | 'fisheries'
  | 'poultry'
  | 'apiculture'
  | 'sericulture'
  | 'agroforestry'
  | 'organic_farming'
  | 'precision_agri'
  | 'agri_marketing'
  | 'entrepreneurship';

export interface Course {
  id: string;
  provider_id: string;
  title: string;
  description: string | null;
  category: CourseCategory;
  start_date: string | null;
  duration_weeks: number | null;
  seats_total: number;
  seats_filled: number;
  fee: number | null;
  address: string;
  city: string | null;
  state: string | null;
  contact_phone: string | null;
  image_url: string | null;
  // Enriched fields (Trust & Enrollment v2 migration):
  learning_outcomes: string | null;
  agenda: string | null;
  batch_timings: string | null;
  registration_deadline: string | null;
  discount: number | null;
  language: string | null;
  certificate_available: boolean | null;
  eligibility: string | null;
  images: string[] | null;
  // Trainer shown on the course page + partner-uploaded certificate file.
  trainer_name?: string | null;
  trainer_bio?: string | null;
  certificate_url?: string | null;
  certificate_name?: string | null;
  // Optional Tamil / Hindi versions of the partner-written text.
  translations?: CourseTranslations | null;
  created_at: string;
}

export type TranslatableField = 'title' | 'description' | 'agenda' | 'learning_outcomes' | 'eligibility' | 'batch_timings' | 'trainer_name' | 'trainer_bio';
export type CourseTranslations = Partial<Record<'ta' | 'hi', Partial<Record<TranslatableField, string>>>>;

// Columns shared by every course query (kept in sync with the Course type).
const COURSE_COLUMNS = '*';
const PUBLIC_COURSE_COLUMNS = '*';

function normalizeCourse(row: any): Course {
  return { ...(row as any), title: row.title ?? 'Untitled course', category: row.category ?? 'crop_cultivation', seats_total: Number(row.seats_total ?? 0), seats_filled: Number(row.seats_filled ?? 0), fee: Number(row.fee ?? 0), address: row.address ?? '', images: Array.isArray(row.images) ? row.images : [] } as Course;
}

export interface CourseWithProvider extends Course {
  // provider profile fields are joined from profiles at runtime
  provider_name?: string | null;
  provider_phone?: string | null;
  // The partner's public-visibility flag. Every course that reaches a learner is
  // from an active partner (listCourses filters inactive ones out), so on the
  // learner side this is effectively always true and drives the "Active" trust
  // badge. null (column added by a later migration) counts as active.
  provider_active?: boolean | null;
}

// Pretty labels for the sector chips (Browse filter + course card + org card).
export const CATEGORY_LABELS: Record<CourseCategory, string> = {
  crop_cultivation: 'Crop Cultivation',
  horticulture: 'Horticulture',
  seed_technology: 'Seed Technology',
  crop_protection: 'Crop Protection',
  agro_processing: 'Agro-Processing',
  food_processing: 'Food Processing',
  post_harvest: 'Post-Harvest Management',
  dairy: 'Dairy',
  animal_husbandry: 'Animal Husbandry',
  fisheries: 'Fisheries & Aquaculture',
  poultry: 'Poultry Farming',
  apiculture: 'Apiculture',
  sericulture: 'Sericulture',
  agroforestry: 'Agroforestry',
  organic_farming: 'Organic Farming',
  precision_agri: 'Precision Agriculture',
  agri_marketing: 'Agri Marketing',
  entrepreneurship: 'Entrepreneurship',
};

export const CATEGORY_LIST: CourseCategory[] = [
  'crop_cultivation', 'horticulture', 'seed_technology', 'crop_protection',
  'agro_processing', 'food_processing', 'post_harvest', 'dairy',
  'animal_husbandry', 'fisheries', 'poultry', 'apiculture', 'sericulture',
  'agroforestry', 'organic_farming', 'precision_agri', 'agri_marketing',
  'entrepreneurship',
];

// SkillFarm uses one consistent brand color across category chips and course cards.
// This keeps the learner experience visually calm and avoids unrelated accent colors.
export function sectorColor(_sector: string): string {
  return '#216B45';
}


// ---------------------------------------------------------------------------
// Student: list courses for the Browse page (optionally filtered by sector).
//
// Active/Inactive is the partner's public-visibility switch: a Learning Partner
// who sets themselves Inactive disappears from Browse. That is now enforced in
// the QUERY (`!inner` join + a filter on the embedded profile) rather than by
// dropping rows after they arrive, so an inactive partner's courses no longer
// cross the wire at all. The post-filter below is kept as a cheap backstop.
//
// `is_active is null` counts as active — the column was added by a later
// migration, so partners who never touched the switch have null, not true.
// A partner always sees their own courses through listMyCourses().
// ---------------------------------------------------------------------------
export async function listCourses(category?: CourseCategory | 'all') {
  let query = supabase.from('courses').select('*').order('created_at', { ascending: false });
  if (category && category !== 'all') query = query.eq('category', category);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []).map(normalizeCourse);
  const ids = [...new Set(rows.map(r => r.provider_id).filter(Boolean))];
  let providers: Record<string, any> = {};
  if (ids.length) {
    const p = await supabase.from('profiles').select('*').in('id', ids);
    if (!p.error) providers = Object.fromEntries((p.data ?? []).map((x: any) => [x.id, x]));
  }
  return rows.map((row): CourseWithProvider => ({ ...row, provider_name: providers[row.provider_id]?.org_name ?? providers[row.provider_id]?.full_name ?? null, provider_phone: providers[row.provider_id]?.org_phone ?? providers[row.provider_id]?.phone ?? null, provider_active: providers[row.provider_id]?.is_active ?? true }));
}

// ---------------------------------------------------------------------------
// Student: fetch a single course by id using the safe authenticated course projection.
// ---------------------------------------------------------------------------
export async function getCourse(id: string) {
  const { data, error } = await supabase.from('courses').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Course not found.');
  const course = normalizeCourse(data);
  let provider: any = null;
  if (course.provider_id) { const p = await supabase.from('profiles').select('*').eq('id', course.provider_id).maybeSingle(); if (!p.error) provider = p.data; }
  return { ...course, provider_name: provider?.org_name ?? provider?.full_name ?? null, provider_phone: provider?.org_phone ?? provider?.phone ?? null, provider_active: provider?.is_active ?? true } as CourseWithProvider;
}

// ---------------------------------------------------------------------------
// Provider: list ONLY this provider's courses.
// ---------------------------------------------------------------------------
export async function listMyCourses(providerId: string) {
  const primary = await supabase.from('courses').select('*').eq('provider_id', providerId).order('created_at', { ascending: false });
  if (primary.error) throw primary.error;
  return (primary.data ?? []).map(normalizeCourse);
}

// ---------------------------------------------------------------------------
// Provider: create a new course.
// ---------------------------------------------------------------------------
// Columns added by later SQL migrations. If the live database does not have
// them yet, we drop them from the payload and retry so the course still saves.
const OPTIONAL_COLUMNS = ['translations', 'trainer_name', 'trainer_bio', 'certificate_url', 'certificate_name'] as const;
let droppedOptional: string[] = [];

/** Columns that were skipped on the last save because the DB migration is missing. */
export function getDroppedOptionalColumns() {
  return droppedOptional;
}

function missingOptionalColumns(message: string | undefined | null, payload: Record<string, any>) {
  const msg = message ?? '';
  return OPTIONAL_COLUMNS.filter((c) => c in payload && new RegExp(c, 'i').test(msg));
}

async function saveWithFallback<T>(
  run: (payload: Record<string, any>) => PromiseLike<{ data: T | null; error: any }>,
  payload: Record<string, any>
): Promise<T> {
  droppedOptional = [];
  let current = { ...payload };
  for (let attempt = 0; attempt < OPTIONAL_COLUMNS.length + 1; attempt++) {
    const { data, error } = await run(current);
    if (!error) return data as T;
    let missing = missingOptionalColumns(error.message, current);
    // PostgREST sometimes reports only the first unknown column; if the error
    // is a schema-cache / unknown-column error but names none of ours, drop all.
    if (!missing.length && /schema cache|column .* does not exist|could not find/i.test(error.message ?? '')) {
      missing = OPTIONAL_COLUMNS.filter((c) => c in current);
    }
    if (!missing.length) throw error;
    for (const c of missing) {
      delete current[c];
      droppedOptional.push(c);
    }
  }
  throw new Error('Could not save the course.');
}

export async function createCourse(
  providerId: string,
  input: Omit<Course, 'id' | 'provider_id' | 'created_at' | 'seats_filled'>
) {
  return saveWithFallback<Course>(
    (payload) =>
      supabase
        .from('courses')
        .insert({ ...payload, seats_total: 40, provider_id: providerId, seats_filled: 0 })
        .select()
        .single() as any,
    input as any
  );
}

// ---------------------------------------------------------------------------
// Provider: update an existing course (including editing seat capacity).
// ---------------------------------------------------------------------------
export async function updateCourse(
  id: string,
  input: Partial<Omit<Course, 'id' | 'provider_id' | 'created_at'>>
) {
  // Capacity is fixed at 40 per batch and managed by the database.
  const { seats_total: _seats, seats_filled: _filled, ...safe } = input as any;
  return saveWithFallback<Course>(
    (payload) => supabase.from('courses').update(payload).eq('id', id).select().single() as any,
    safe
  );
}

// ---------------------------------------------------------------------------
// Provider: delete a course.
// ---------------------------------------------------------------------------
export async function deleteCourse(id: string) {
  const { error } = await supabase.from('courses').delete().eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Convenience: how many seats are left on a course.
// ---------------------------------------------------------------------------
export function seatsLeft(course: Pick<Course, 'seats_total' | 'seats_filled'>) {
  return Math.max(0, course.seats_total - course.seats_filled);
}

export function isFull(course: Pick<Course, 'seats_total' | 'seats_filled'>) {
  return course.seats_filled >= course.seats_total;
}

// ---------------------------------------------------------------------------
// Type guard for a category coming off a route param / deep link. Used by the
// Courses screen so a stale or hand-typed `?category=` cannot seed an invalid
// filter (it would silently return zero rows from the server otherwise).
// ---------------------------------------------------------------------------
const CATEGORY_SET = new Set<string>(CATEGORY_LIST);
export function isCourseCategory(v: unknown): v is CourseCategory {
  return typeof v === 'string' && CATEGORY_SET.has(v);
}

// ---------------------------------------------------------------------------
// Effective price after discount. `discount` is an absolute ₹ amount (not a
// percent), so the net fee is fee minus discount, floored at 0. A null fee is
// treated as free (0).
// ---------------------------------------------------------------------------
export function netFee(course: Pick<Course, 'fee' | 'discount'>): number {
  return Math.max(0, (course.fee ?? 0) - (course.discount ?? 0));
}

// ---------------------------------------------------------------------------
// Auto-translate the partner's English text into Tamil + Hindi (v8). Calls the
// `translate-course` Edge Function; the result only pre-fills the form, the
// partner reviews/edits it and it is saved with the course on "Save".
// ---------------------------------------------------------------------------
export async function autoTranslateCourseText(
  fields: Partial<Record<TranslatableField, string>>,
): Promise<CourseTranslations> {
  const { data, error } = await supabase.functions.invoke('translate-course', { body: { fields } });
  if (error) {
    let detail = '';
    try { detail = (await (error as any).context?.json?.())?.error ?? ''; } catch {}
    throw new Error(detail || error.message || 'Auto-translate is not available right now.');
  }
  if (!data?.ok) throw new Error(data?.error ?? 'Auto-translate failed.');
  return data.translations as CourseTranslations;
}
