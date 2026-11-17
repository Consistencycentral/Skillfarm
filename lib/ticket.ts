import { createURL } from 'expo-linking';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

export function ticketShareUrl(registrationId: string): string {
  if (SITE_URL) return `${SITE_URL.replace(/\/+$/, '')}/ticket/${registrationId}`;
  return createURL(`/ticket/${registrationId}`);
}

/**
 * QR payload used for attendance. Kept as plain text so the QR can be rendered
 * entirely on-device (no QuickChart/network dependency).
 */
export function ticketQrValue(registrationId: string): string {
  return SITE_URL
    ? `${SITE_URL.replace(/\/+$/, '')}/attendance/${registrationId}`
    : createURL(`/attendance/${registrationId}`);
}

export function ticketEmailUrl(args: {
  email: string;
  courseTitle: string;
  batch: string;
  seat: string;
  location: string;
  ticketUrl: string;
  qrValue: string;
}) {
  const subject = encodeURIComponent(`SkillFarm ticket — ${args.courseTitle}`);
  const body = encodeURIComponent(
    `Your SkillFarm training ticket\n\nCourse: ${args.courseTitle}\nBatch: ${args.batch}\nSeat: ${args.seat}\nLocation: ${args.location}\n\nTicket: ${args.ticketUrl}\nAttendance QR value: ${args.qrValue}\n\nPlease keep this ticket ready on training day.`
  );
  return `mailto:${encodeURIComponent(args.email)}?subject=${subject}&body=${body}`;
}
