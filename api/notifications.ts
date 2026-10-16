import { listMyRegistrations, type RegistrationWithCourse } from './registrations';

export type SkillFarmNotification = {
  id: string;
  title: string;
  body: string;
  tone: 'success' | 'info' | 'warning' | 'neutral';
  createdAt: string;
  registrationId: string;
};

function daysUntil(value: string | null) {
  if (!value) return null;
  const ms = new Date(value).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
}

export function buildNotifications(regs: RegistrationWithCourse[]): SkillFarmNotification[] {
  const out: SkillFarmNotification[] = [];
  for (const r of regs) {
    const courseTitle = r.course?.title ?? 'Your course';
    if (r.status === 'registered') {
      out.push({ id: `${r.id}-approved`, title: 'Seat approved — your QR ticket is ready', body: `${courseTitle} is confirmed. Tap to open your attendance QR ticket.`, tone: 'success', createdAt: r.registered_at, registrationId: r.id });
    } else if (r.status === 'pending' && r.waitlist_promoted_at) {
      out.push({ id: `${r.id}-pending`, title: 'A seat opened up for you', body: `${courseTitle}: a seat is now held for you and waits for the Learning Partner’s approval.`, tone: 'success', createdAt: r.waitlist_promoted_at, registrationId: r.id });
    } else if (r.status === 'pending') {
      out.push({ id: `${r.id}-pending`, title: 'Request under review', body: `${courseTitle} is waiting for the Learning Partner’s approval.`, tone: 'info', createdAt: r.registered_at, registrationId: r.id });
    } else if (r.status === 'waitlist') {
      out.push({ id: `${r.id}-waitlist`, title: 'You’re on the waitlist', body: `${courseTitle} is full right now. If a seat is released, it is held for you in order and you will be notified.`, tone: 'warning', createdAt: r.registered_at, registrationId: r.id });
    } else if (r.status === 'rejected') {
      out.push({ id: `${r.id}-rejected`, title: 'Request not approved', body: `Your request for ${courseTitle} was not approved.`, tone: 'warning', createdAt: r.registered_at, registrationId: r.id });
    }

    const days = daysUntil(r.batch?.start_date ?? r.course?.start_date ?? null);
    if (r.status === 'registered' && days !== null && days >= 0 && days <= 7) {
      out.push({ id: `${r.id}-upcoming`, title: days === 0 ? 'Your batch starts today' : `Your batch starts in ${days} day${days === 1 ? '' : 's'}`, body: `${courseTitle}${r.batch?.timings ? ` · ${r.batch.timings}` : ''}`, tone: 'info', createdAt: r.batch?.start_date ?? r.registered_at, registrationId: r.id });
    }
  }
  return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30);
}

export async function listMyNotifications(studentId: string) {
  const regs = await listMyRegistrations(studentId);
  return buildNotifications(regs);
}
