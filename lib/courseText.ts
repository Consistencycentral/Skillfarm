import type { Lang } from './i18n';
import type { TranslatableField } from '../api/courses';

// Returns the course with its partner-written text swapped for the Tamil /
// Hindi version when the partner provided one. Anything missing falls back to
// the original (English) text, so a half-translated course never shows blanks.
const FIELDS: TranslatableField[] = ['title', 'description', 'agenda', 'learning_outcomes', 'eligibility', 'batch_timings', 'trainer_name', 'trainer_bio'];

export function localizeCourse<T extends { translations?: any }>(course: T, lang: Lang): T {
  if (lang === 'en' || !course) return course;
  const tr = (course.translations ?? {})[lang];
  if (!tr || typeof tr !== 'object') return course;
  const out: any = { ...course };
  for (const f of FIELDS) {
    const v = tr[f];
    if (typeof v === 'string' && v.trim()) out[f] = v.trim();
  }
  return out as T;
}
