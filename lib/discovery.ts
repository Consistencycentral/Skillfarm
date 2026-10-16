// ===========================================================================
// discovery.ts — pure ranking + grouping for the learner Home screen.
//
// No I/O and no React here: the Home screen fetches courses, batched ratings and
// the learner's own registrations, then hands them to buildDiscoverySections()
// which returns the ordered list of horizontal rows to render. Keeping this
// side-effect-free makes the ranking testable and cheap to re-run in a useMemo.
//
// Every signal is derived from data a learner is already permitted to read —
// there is no popularity/rating aggregate in SQL, and a learner cannot see other
// learners' registrations, so `seats_filled` (bumped only by approve_registration
// = confirmed seats), `created_at`, `start_date`, `registration_deadline`, the
// batched review rows, and the learner's OWN registrations are all we have.
// ===========================================================================
import {
  CATEGORY_LABELS,
  type CourseWithProvider, type CourseCategory,
} from '../api/courses';
import type { CourseRatingMap } from '../api/reviews';
import type { RegistrationWithCourse } from '../api/registrations';

export interface DiscoverySection {
  key: string;
  title: string;
  subtitle?: string;
  courses: CourseWithProvider[];
  // When set, the row shows a "See all ›" that deep-links the Courses tab to this
  // sector. Curated rows (Top/Trending/Recs) leave it undefined — they are
  // rankings, not a filterable set.
  seeAllCategory?: CourseCategory;
}

export interface TasteProfile {
  categories: Map<CourseCategory, number>;
  cities: Map<string, number>;
  registeredCourseIds: Set<string>;
  count: number;
}

// ---- Tunables -------------------------------------------------------------
const RECENCY_HALF_LIFE_DAYS = 21;   // a 3-week-old course reads as half as "fresh"
const RATING_PRIOR = 3.8;            // assumed mean before evidence (shrinkage target)
const RATING_PRIOR_WEIGHT = 3;       // how many "phantom" prior reviews to blend in
const MIN_CATALOGUE_FOR_SECTIONS = 4;// below this, collapse to one "Fresh" row
const MIN_CATALOGUE_FOR_TRENDING = 8;// Trending needs enough courses to differ from Top
const MIN_ROW_ITEMS = 2;             // a curated row with <2 items looks broken
const MIN_CATEGORY_ROW_ITEMS = 1;    // a sector row is worth showing with 1
const MAX_ROW_ITEMS = 12;
const RECS_PURE_THRESHOLD = 3;       // fewer regs than this → blend in popularity
const RECS_MAX_PER_CATEGORY = 3;     // diversity caps so one sector/partner can't own Recs
const RECS_MAX_PER_PROVIDER = 3;
const DAY_MS = 86_400_000;

// ---- Small numeric helpers ------------------------------------------------
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

// Whole/fractional days elapsed since `iso` (negative if in the future).
function daysSince(iso: string | null | undefined, now: Date): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (now.getTime() - t) / DAY_MS;
}

// 1 while a course starts within 45 days, tapering to 0 by 120 days; 0 once the
// start date has passed or is unknown. Surfaces courses a learner can still join.
function upcomingScore(startIso: string | null | undefined, now: Date): number {
  if (!startIso) return 0;
  const t = Date.parse(startIso);
  if (Number.isNaN(t)) return 0;
  const days = (t - now.getTime()) / DAY_MS;
  if (days < 0) return 0;
  if (days <= 45) return 1;
  if (days >= 120) return 0;
  return 1 - (days - 45) / (120 - 45);
}

function isDeadlinePassed(iso: string | null | undefined, now: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t < now.getTime();
}

// Bayesian/shrinkage mean: a lone 5★ is pulled toward RATING_PRIOR so it can't
// outrank a course with many good reviews. Returns 0-5.
export function bayesianRating(avg: number, count: number): number {
  return (count * avg + RATING_PRIOR_WEIGHT * RATING_PRIOR) / (count + RATING_PRIOR_WEIGHT);
}

// Per-course signals, all normalised to 0-1 (except the raw velocity, which is
// renormalised against its row max inside rankTrending).
interface Signals {
  fillRatio: number;
  demand: number;
  freshness: number;
  upcoming: number;
  ratingScore: number;   // bayesian / 5
  ratingCount: number;
  deadlinePassed: boolean;
  ageDays: number;
  velocityRaw: number;   // demand / sqrt(ageDays)
}

function computeSignals(
  c: CourseWithProvider,
  rating: { avg: number; count: number } | undefined,
  now: Date,
): Signals {
  const fillRatio = c.seats_total > 0 ? clamp01(c.seats_filled / c.seats_total) : 0;
  const demand = clamp01(Math.log1p(Math.max(0, c.seats_filled)) / Math.log1p(20));
  const ageDays = Math.max(0, daysSince(c.created_at, now));
  const freshness = clamp01(0.5 ** (ageDays / RECENCY_HALF_LIFE_DAYS));
  const upcoming = clamp01(upcomingScore(c.start_date, now));
  const count = rating?.count ?? 0;
  const ratingScore = count > 0 ? clamp01(bayesianRating(rating!.avg, count) / 5) : 0;
  const velocityRaw = demand / Math.sqrt(Math.max(ageDays, 1));
  return {
    fillRatio, demand, freshness, upcoming,
    ratingScore, ratingCount: count,
    deadlinePassed: isDeadlinePassed(c.registration_deadline, now),
    ageDays, velocityRaw,
  };
}

// ---------------------------------------------------------------------------
// Shared free-text filter for both Home search and the Courses tab. Matches
// title, city, state, partner name, and the HUMAN sector label (so "Organic
// Farming" and a partner's name both work, not just the raw enum key).
// ---------------------------------------------------------------------------
export function filterCourses(list: CourseWithProvider[], query: string): CourseWithProvider[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) =>
    c.title.toLowerCase().includes(q) ||
    (c.city ?? '').toLowerCase().includes(q) ||
    (c.state ?? '').toLowerCase().includes(q) ||
    (c.provider_name ?? '').toLowerCase().includes(q) ||
    (CATEGORY_LABELS[c.category] ?? '').toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Frequency of sectors + cities across the learner's own registrations (any
// status — a cancelled seat still signals interest). registeredCourseIds is used
// to keep already-booked courses out of Recommendations.
// ---------------------------------------------------------------------------
export function buildTasteProfile(regs: RegistrationWithCourse[]): TasteProfile {
  const categories = new Map<CourseCategory, number>();
  const cities = new Map<string, number>();
  const registeredCourseIds = new Set<string>();
  let count = 0;
  for (const r of regs) {
    registeredCourseIds.add(r.course_id);
    const cat = r.course?.category as CourseCategory | undefined;
    if (cat) categories.set(cat, (categories.get(cat) ?? 0) + 1);
    const city = (r.course?.city ?? '').toLowerCase();
    if (city) cities.set(city, (cities.get(city) ?? 0) + 1);
    count += 1;
  }
  return { categories, cities, registeredCourseIds, count };
}

// Sort newest-first (created_at desc == freshness desc == ageDays asc). Used for
// the sparse "Fresh" row and every sector row.
function byNewest(sig: Map<string, Signals>) {
  return (a: CourseWithProvider, b: CourseWithProvider) =>
    sig.get(a.id)!.ageDays - sig.get(b.id)!.ageDays;
}

// Top: rating-led when reviews exist, else a demand/fill/upcoming blend so the
// row is still meaningful in today's zero-review catalogue.
function rankTop(courses: CourseWithProvider[], sig: Map<string, Signals>, hasReviews: boolean) {
  const scored = courses.map((c) => {
    const s = sig.get(c.id)!;
    let score = hasReviews
      ? 0.55 * s.ratingScore + 0.25 * s.demand + 0.12 * s.fillRatio + 0.08 * s.upcoming
      : 0.45 * s.demand + 0.35 * s.fillRatio + 0.20 * s.upcoming;
    if (s.deadlinePassed) score *= 0.25;
    return { c, s, score };
  });
  scored.sort((a, b) => b.score - a.score || a.s.ageDays - b.s.ageDays);
  return scored.slice(0, MAX_ROW_ITEMS).map((x) => x.c);
}

// Trending: seat-fill velocity (renormalised against the row's own max) when
// there is real demand, else an upcoming/freshness blend. Tie-breaks on
// start_date ASC (soonest first) — deliberately inverted vs Top's created_at
// tie-break so the two rows don't collapse to the same order in a small
// catalogue. `excludeId` drops Top's #1 so Trending doesn't just echo it.
function rankTrending(
  courses: CourseWithProvider[],
  sig: Map<string, Signals>,
  hasDemand: boolean,
  excludeId?: string,
) {
  const pool = excludeId ? courses.filter((c) => c.id !== excludeId) : courses;
  const maxVel = Math.max(1e-9, ...pool.map((c) => sig.get(c.id)!.velocityRaw));
  const startMs = (c: CourseWithProvider) => {
    const t = c.start_date ? Date.parse(c.start_date) : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const scored = pool.map((c) => {
    const s = sig.get(c.id)!;
    const velocity = s.velocityRaw / maxVel;
    let score = hasDemand
      ? 0.50 * velocity + 0.30 * s.freshness + 0.20 * s.upcoming
      : 0.60 * s.upcoming + 0.40 * s.freshness;
    if (s.deadlinePassed) score *= 0.25;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score || startMs(a.c) - startMs(b.c));
  return scored.slice(0, MAX_ROW_ITEMS).map((x) => x.c);
}

// Cap how many courses one sector or one partner can contribute to a row, then
// top up from the overflow (in score order) if the caps left us short.
function pickDiverse(ordered: CourseWithProvider[], max: number): CourseWithProvider[] {
  const catCount = new Map<CourseCategory, number>();
  const provCount = new Map<string, number>();
  const out: CourseWithProvider[] = [];
  const overflow: CourseWithProvider[] = [];
  for (const c of ordered) {
    const cc = catCount.get(c.category) ?? 0;
    const pc = provCount.get(c.provider_id) ?? 0;
    if (cc < RECS_MAX_PER_CATEGORY && pc < RECS_MAX_PER_PROVIDER) {
      out.push(c);
      catCount.set(c.category, cc + 1);
      provCount.set(c.provider_id, pc + 1);
      if (out.length >= max) return out;
    } else {
      overflow.push(c);
    }
  }
  for (const c of overflow) {
    if (out.length >= max) break;
    out.push(c);
  }
  return out;
}

// Recommendations: personalised from the learner's own taste, excluding courses
// they've already booked. With no history it becomes "New for you" (freshness
// led); with thin history (< RECS_PURE_THRESHOLD regs) it blends in Top's
// popularity so a learner with one booking still sees a full, sensible row.
function rankRecommended(
  courses: CourseWithProvider[],
  sig: Map<string, Signals>,
  taste: TasteProfile,
  hasReviews: boolean,
) {
  const unseen = courses.filter((c) => !taste.registeredCourseIds.has(c.id));
  const pool = unseen.length >= MIN_ROW_ITEMS ? unseen : courses; // booked everything? fall back

  if (taste.count === 0) {
    const scored = pool.map((c) => {
      const s = sig.get(c.id)!;
      let score = 0.7 * s.freshness + 0.3 * (hasReviews ? s.ratingScore : s.fillRatio);
      if (s.deadlinePassed) score *= 0.25;
      return { c, s, score };
    });
    scored.sort((a, b) => b.score - a.score || a.s.ageDays - b.s.ageDays);
    return pickDiverse(scored.map((x) => x.c), MAX_ROW_ITEMS);
  }

  const maxCat = Math.max(1, ...taste.categories.values());
  const maxCity = Math.max(1, ...taste.cities.values());
  const scored = pool.map((c) => {
    const s = sig.get(c.id)!;
    const catMatch = (taste.categories.get(c.category) ?? 0) / maxCat;
    const cityMatch = (c.city ? taste.cities.get(c.city.toLowerCase()) ?? 0 : 0) / maxCity;
    let score = 3 * catMatch + 2 * cityMatch + 1 * s.ratingScore + 1 * s.upcoming + 0.5 * s.fillRatio;
    if (taste.count < RECS_PURE_THRESHOLD) {
      // Thin taste → nudge with popularity; its relative weight shrinks as the
      // category/city match terms grow, so it never dominates a strong match.
      const topScore = hasReviews
        ? 0.55 * s.ratingScore + 0.25 * s.demand + 0.12 * s.fillRatio + 0.08 * s.upcoming
        : 0.45 * s.demand + 0.35 * s.fillRatio + 0.20 * s.upcoming;
      score += 2 * topScore;
    }
    if (s.deadlinePassed) score *= 0.25;
    return { c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return pickDiverse(scored.map((x) => x.c), MAX_ROW_ITEMS);
}

// ---------------------------------------------------------------------------
// The one entry point the Home screen calls. Returns the ordered rows to render:
// Recommendations → Top → Trending → one row per populated sector. Rows that
// can't meet their minimum item count are dropped, and below
// MIN_CATALOGUE_FOR_SECTIONS the whole thing collapses to a single "Fresh" row
// so a tiny catalogue doesn't render three near-identical 2-item strips.
// ---------------------------------------------------------------------------
export function buildDiscoverySections(input: {
  courses: CourseWithProvider[];
  ratings: CourseRatingMap;
  regs: RegistrationWithCourse[];
  now?: Date;
}): DiscoverySection[] {
  const { courses, ratings, regs, now = new Date() } = input;
  if (courses.length === 0) return [];

  const sig = new Map<string, Signals>();
  for (const c of courses) sig.set(c.id, computeSignals(c, ratings[c.id], now));

  const hasReviews = courses.some((c) => (ratings[c.id]?.count ?? 0) > 0);
  const hasDemand = courses.some((c) => c.seats_filled > 0);

  // Sparse catalogue: one honest "Fresh" row beats three degenerate ones.
  if (courses.length < MIN_CATALOGUE_FOR_SECTIONS) {
    const fresh = [...courses].sort(byNewest(sig)).slice(0, MAX_ROW_ITEMS);
    return [{
      key: 'fresh',
      title: 'Fresh on SkillFarm',
      subtitle: 'The newest offline courses added by Learning Partners',
      courses: fresh,
    }];
  }

  const sections: DiscoverySection[] = [];

  const taste = buildTasteProfile(regs);
  const recs = rankRecommended(courses, sig, taste, hasReviews);
  if (recs.length >= MIN_ROW_ITEMS) {
    sections.push({
      key: 'recs',
      title: taste.count > 0 ? 'Recommended for you' : 'New for you',
      subtitle: taste.count > 0
        ? 'Based on the courses you’ve booked'
        : 'Popular picks to get you started',
      courses: recs,
    });
  }

  const top = rankTop(courses, sig, hasReviews);
  if (top.length >= MIN_ROW_ITEMS) {
    sections.push({ key: 'top', title: 'Top Courses', subtitle: 'Highly rated and in demand', courses: top });
  }

  if (courses.length >= MIN_CATALOGUE_FOR_TRENDING) {
    const trending = rankTrending(courses, sig, hasDemand, top[0]?.id);
    if (trending.length >= MIN_ROW_ITEMS) {
      sections.push({ key: 'trending', title: 'Trending Courses', subtitle: 'Filling up fast right now', courses: trending });
    }
  }

  // Sector rows: one per category with courses, most-populated first then A-Z.
  const byCat = new Map<CourseCategory, CourseWithProvider[]>();
  for (const c of courses) {
    const list = byCat.get(c.category) ?? [];
    list.push(c);
    byCat.set(c.category, list);
  }
  const sectorRows = [...byCat.entries()]
    .filter(([, list]) => list.length >= MIN_CATEGORY_ROW_ITEMS)
    .sort((a, b) => b[1].length - a[1].length || CATEGORY_LABELS[a[0]].localeCompare(CATEGORY_LABELS[b[0]]));
  for (const [cat, list] of sectorRows) {
    sections.push({
      key: `cat:${cat}`,
      title: CATEGORY_LABELS[cat],
      courses: [...list].sort(byNewest(sig)).slice(0, MAX_ROW_ITEMS),
      seeAllCategory: cat,
    });
  }

  return sections;
}
