// SkillFarm database state vocabulary.
// Keep these in sync with supabase/SKILLFARM_PERFORMANCE_ENUMS_INDEXES_1.3.1.sql.

export const USER_ROLES = ['student', 'provider'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const REGISTRATION_STATUSES = [
  'pending', 'registered', 'waitlist', 'cancelled', 'completed', 'rejected',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const ATTENDANCE_STATUSES = ['pending', 'present', 'absent'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const COURSE_STATUSES = ['draft', 'published', 'paused', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export const BATCH_STATUSES = ['draft', 'open', 'full', 'closed', 'cancelled', 'completed'] as const;
export type MaterialType = 'pdf' | 'note' | 'video' | 'poll';
export const MATERIAL_REVIEW_STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'archived'] as const;
export type MaterialReviewStatus = (typeof MATERIAL_REVIEW_STATUSES)[number];
export const PAYMENT_METHODS = ['razorpay', 'manual', 'not_required'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const VENUE_STATUSES = ['tbd', 'tentative', 'confirmed', 'cancelled'] as const;
export type VenueStatus = (typeof VENUE_STATUSES)[number];
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export function isRegistrationStatus(value: unknown): value is RegistrationStatus {
  return typeof value === 'string' && (REGISTRATION_STATUSES as readonly string[]).includes(value);
}

export function isAttendanceStatus(value: unknown): value is AttendanceStatus {
  return typeof value === 'string' && (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}
