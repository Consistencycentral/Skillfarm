import { PROD_SITE_URL } from './deeplink';

// Ticket share URL — same deployed web origin as course/org shares (see
// lib/deeplink.ts for the resolution rules; a dead Netlify host can never be
// produced). The ticket page loads the registration from Supabase, so the
// recipient signs in with the same account and sees the ticket.
export function ticketShareUrl(registrationId: string): string {
  return `${PROD_SITE_URL}/ticket/${registrationId}`;
}