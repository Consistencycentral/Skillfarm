import { SITE_URL } from './deeplink';

// Ticket share URL — points at the same deployed web origin as course/org
// shares (see lib/deeplink.ts for the env-first + inlined-fallback pattern).
// The ticket page reads the registration server-side; anyone opening the link
// signs in with the same Supabase account and sees the ticket.
export function ticketShareUrl(registrationId: string): string {
  return `${SITE_URL.replace(/\/+$/, '')}/ticket/${registrationId}`;
}
