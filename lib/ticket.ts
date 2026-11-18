import { PROD_SITE_URL } from './deeplink';

// Ticket helpers — share URL, attendance QR payload and the mailto: link.
//
// Every URL here comes from PROD_SITE_URL (lib/deeplink.ts), so a dead
// *.netlify.app host can never be produced. This module was accidentally
// reduced to only ticketShareUrl during a repo repair, which left
// ticketQrValue/ticketEmailUrl undefined at runtime on the ticket screen —
// restored here with their original behaviour.

/** Public link to the ticket page. */
export function ticketShareUrl(registrationId: string): string {
  return `${PROD_SITE_URL}/ticket/${registrationId}`;
}

/**
 * QR payload used for attendance. Plain text so the QR renders entirely
 * on-device (no QuickChart / network dependency). Scanning it opens the
 * partner-side attendance screen for this registration.
 */
export function ticketQrValue(registrationId: string): string {
  return `${PROD_SITE_URL}/attendance/${registrationId}`;
}

/** mailto: link that puts the whole ticket in the mail body. */
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