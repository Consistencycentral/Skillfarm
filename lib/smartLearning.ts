import type { CourseWithProvider } from '../api/courses';

/** Deterministic, offline-safe recommendation engine. It is intentionally not marketed as AI. */
export function recommendCourses(courses: CourseWithProvider[], preferences: { category?: string; city?: string } = {}) {
  return [...courses].sort((a, b) => {
    const score = (c: CourseWithProvider) =>
      (preferences.category && c.category === preferences.category ? 4 : 0) +
      (preferences.city && c.city?.toLowerCase() === preferences.city.toLowerCase() ? 3 : 0) +
      (c.provider_active !== false ? 1 : 0) + (c.certificate_available ? 1 : 0);
    return score(b) - score(a);
  });
}
