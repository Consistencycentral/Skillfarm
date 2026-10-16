# SkillFarm — India-level product enhancement plan

## Recommended benchmark apps
- BookMyShow — seat map, availability, clear booking confirmation, QR ticket.
- Swiggy — discovery, city/location filters, clear status and lightweight browsing.
- Urban Company — Learning Partner profile, trust signals, service details, booking lifecycle.
- Skill India / NSDC-style portals — training taxonomy, partner/institute information, certificates.
- PhonePe / Google Pay — UPI-first payment experience for paid courses.
- WhatsApp — booking/payment reminders and batch updates (with opt-in).

## Canonical learner flow
1. Discover course
2. Choose batch/date/time
3. Choose seat
4. Enter/confirm learner details
5. Book seat immediately
6. If paid: Pay via Razorpay/UPI
7. Show confirmed QR attendance ticket
8. My Seats shows batch + seat + payment + ticket status
9. Materials unlock after the required payment state is confirmed

There should be no "Request sent" or "waiting for Learning Partner approval" step in the direct-booking flow.

## Learning Partner material flow
- Material type: PDF
- Actions: `Upload PDF` or `Scan paper`
- `Scan paper` opens the device camera only; it does not open the gallery or generic file picker.
- Show a document frame and the instruction "Place one paper inside the frame".
- Capture -> review preview -> Retake or Use scan.
- Use scan converts the camera photo into a PDF and uploads only that PDF.
- The scan route intentionally does not expose arbitrary image uploads.

## Priority roadmap
### P0 — must have
- Single green brand system and neutral surfaces.
- Direct seat booking with no approval-request language.
- BookMyShow-style Batch -> Seat -> Details flow.
- Confirmed QR ticket.
- Secure paid-material access.
- Camera-only paper scanning for Learning Partner PDFs.

### P1 — India scale
- English + Tamil + Hindi across the complete booking flow.
- UPI-first payment alongside Razorpay.
- Low-bandwidth mode, image compression and retry states.
- WhatsApp booking/batch/payment reminders with opt-in.
- City/district/locality filters and nearby training discovery.
- Strong Learning Partner trust card: verified status, address, phone, course count, ratings.

### P2 — retention and trust
- Attendance history.
- Course completion and certificate flow.
- Partner analytics: seats, attendance, revenue, completion.
- Saved courses and reminders.
- Support/issue reporting.

## Current project assessment
The booking flow is structurally correct now: Batch -> Seat -> Your details -> Book Seat. The main remaining issue was legacy approval wording and inconsistent status/payment copy. Those are normalized in this version.
