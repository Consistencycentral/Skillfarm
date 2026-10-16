import type { CourseWithProvider } from '../api/courses';
import type { Batch } from '../api/batches';

export type CourseFilterState = {
  city: string;
  minFee: string;
  maxFee: string;
  upcomingOnly: boolean;
  seatsAvailable: boolean;
};

export const EMPTY_COURSE_FILTERS: CourseFilterState = {
  city: '', minFee: '', maxFee: '', upcomingOnly: false, seatsAvailable: false,
};

export function hasCourseFilters(f: CourseFilterState) {
  return !!(f.city.trim() || f.minFee.trim() || f.maxFee.trim() || f.upcomingOnly || f.seatsAvailable);
}

export function filterCoursesAdvanced(
  courses: CourseWithProvider[],
  search: string,
  filters: CourseFilterState,
  nextBatches: Record<string, Batch | null>,
) {
  const q = search.trim().toLowerCase();
  const min = filters.minFee.trim() ? Number(filters.minFee) : null;
  const max = filters.maxFee.trim() ? Number(filters.maxFee) : null;
  const now = Date.now();
  return courses.filter((c) => {
    if (q && ![c.title, c.description, c.city, c.state, c.provider_name, c.address].some((v) => String(v ?? '').toLowerCase().includes(q))) return false;
    if (filters.city.trim() && ![c.city, c.state, c.address].some((v) => String(v ?? '').toLowerCase().includes(filters.city.trim().toLowerCase()))) return false;
    if (min != null && Number.isFinite(min) && (c.fee ?? 0) < min) return false;
    if (max != null && Number.isFinite(max) && (c.fee ?? 0) > max) return false;
    const b = nextBatches[c.id];
    if (filters.upcomingOnly && !(b?.start_date && new Date(b.start_date).getTime() >= now)) return false;
    if (filters.seatsAvailable && (!b || b.seats_filled >= b.seats_total)) return false;
    return true;
  });
}
