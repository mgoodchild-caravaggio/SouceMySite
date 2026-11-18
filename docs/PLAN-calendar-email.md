# Plan: calendar booking and email marketing

Decisions (2026-11-17):

- **Calendar:** schedule calls, meetings and site visits from Hub into Outlook, and show each person's Outlook calendar in Hub. No public booking page for now.
- **Built on Microsoft 365:** Hub reads and writes Outlook calendars through Microsoft's API (Microsoft Graph), rather than using Microsoft Bookings.
- **Email:** campaign blasts, drip sequences, and templates for one-off emails.
- **Sender:** each agent's own name and address (e.g. Eric Caravaggio &lt;eric@caravaggiorealestate.ca&gt;), so replies land in their own Outlook inbox.

## How it fits together

| Piece | Used for | Why |
| --- | --- | --- |
| **Microsoft Graph** (each person's Outlook) | Calendar: read events, check free/busy, create invites. One-off emails sent from the agent's own mailbox. | Meetings and one-off emails appear in Outlook exactly as if sent there, and stay in Sent Items and the calendar. |
| **Resend** (already set up for sign-in emails) | Campaigns and drip sequences, sent as the agent with replies going to their inbox. | Built for bulk sending: open/click tracking, bounces, one-click unsubscribe. Bulk mail from Outlook mailboxes hits Microsoft's sending limits and can hurt the domain's reputation. |
| **Supabase Edge Functions** (new) | Server code that holds each person's Outlook connection, talks to Microsoft and Resend, and receives Resend's delivery and click events. | Outlook tokens and the Resend key must never reach the browser. Hub has no server today, only the static site on Railway. |
| **Supabase scheduled jobs** (pg_cron, new) | Sends scheduled campaigns and each drip step when due, every 15 minutes. | Nothing needs to run on anyone's computer. |

## Compliance: Canada's anti-spam law (CASL)

Commercial email to Canadians is regulated by CASL, and fines reach $10M per violation for a business. **This shapes the whole email design.** It's general guidance, not legal advice: confirm the approach with Caravaggio's lawyer or brokerage compliance before the first campaign.

- **Consent is required before sending** a commercial email.
  - **Express consent:** the person agreed. Record when and how.
  - **Implied consent:** for example, an existing business relationship within the last 2 years, an inquiry within the last 6 months, or a business address the person published themselves without saying "no marketing". Implied consent expires.
  - **Cold land-owner lists don't qualify.** Contacts reached through mailed intro letters can't be emailed marketing until they give consent, for example by replying or calling.
- **Every message** must identify the sender (name, brokerage, mailing address, and phone, email or website), and include an unsubscribe link that works for at least 60 days.
- **Unsubscribes** must be honoured within 10 business days. Hub will apply them instantly.

What Hub will do about it:
- Store consent on each contact: type, date, source, and an expiry for implied consent.
- Refuse to include anyone without valid consent in a campaign or sequence, and show why they were left out.
- Add the required footer and unsubscribe link automatically.
- Keep a permanent suppression list.

One-off emails an agent writes to a single person about a specific deal are generally fine, but they're still logged.

## Data model additions

| Table | Holds |
| --- | --- |
| `contacts` (new columns) | `email_consent` (express / implied / none), `consent_date`, `consent_source`, `consent_expires_on`, `unsubscribed_at` |
| `outlook_connections` | Each person's Microsoft connection (encrypted refresh token, mailbox address). Readable only by the server functions. |
| `meetings` | Hub-scheduled events: contact, organiser, Outlook event id, type (call / meeting / site visit), start, end, location or property, Teams link |
| `email_templates` | Name, subject, body with merge fields ({{first_name}}, {{property_address}}…), owner, shared or personal |
| `campaigns` | Template or body, sender, audience (saved filters), schedule, status, counts |
| `campaign_sends` | One row per recipient: status, Resend id, delivered / opened / clicked / bounced / unsubscribed times |
| `sequences`, `sequence_steps` | A drip: steps with a delay (e.g. day 0, 7, 21) and a template each |
| `sequence_enrollments` | Contact, sequence, current step, next send time, and why it stopped (replied, booked, unsubscribed, status changed, finished) |
| `email_suppressions` | Addresses that must never be emailed again (unsubscribed, hard-bounced, complained) |

Sends, opens, clicks, replies and meetings also appear in each contact's activity timeline and the dashboard feed.

## Features

**Calendar**
- **Connect Outlook** (one time per person, from a Settings page). It works whether the person signs in by email link or Microsoft.
- **Dashboard "Today" panel:** today's and the next few days' Outlook meetings. Any meeting with a Hub contact links to that contact.
- **Contact page:** upcoming and past meetings with that contact.
- **Schedule from Hub:** a "Schedule" button on contact pages and follow-up rows.
  - Pick call, meeting or site visit, and a date and time (showing when you're free), length and location. The location can default to the contact's property address.
  - Optionally add a Teams link, and choose who attends (for example, add Eric).
  - Outlook sends the invitation. Hub logs it and can set the follow-up date after the meeting.

**One-off emails**
- An "Email" button on a contact opens a composer with templates and merge fields. It sends from your Outlook, so it lands in your Sent Items, and it's logged in Activity.

**Campaigns**
- Pick an audience with the same filters as the Prospects list, for example Durham sellers with consent. Hub shows who's included and who's excluded and why.
- Write the email or start from a template, preview it with a real contact's details, and send yourself a test.
- Send now or schedule. Results show delivered, opens, clicks, bounces, unsubscribes and replies, with links to each contact.

**Drip sequences**
- Build a sequence of templated emails with delays between them.
- Add contacts from a list's bulk actions or a contact page.
- A sequence stops automatically when the contact replies, books a meeting, unsubscribes or changes status.
- Reply detection reads the agent's inbox through Microsoft Graph and only looks for messages from enrolled contacts.

## Build order

1. ✅ **Foundations** (built 2026-11-17; Connect Outlook goes live once the Entra permissions are approved)
   - Edge Functions set up.
   - Microsoft permissions added to the existing "Prospect Map" app registration in Entra. An admin approves them once.
   - Connect Outlook.
   - Consent fields and a consent editor on contacts.
   - Suppression list.
2. **Calendar:** the Today panel, meetings on contact pages, and Schedule from Hub with free/busy.
3. **Templates and one-off emails** from Outlook.
4. **Campaigns** through Resend: composer, consent-gated audience, test send, schedule, tracking, unsubscribe page and results.
5. **Drip sequences:** builder, enrolment, scheduled sending, and automatic stops (reply, booking, unsubscribe, status).

Steps 2 and 3 only need step 1. Step 5 builds on step 4.

## Costs and setup

- **Resend:** the free plan sends 100 emails a day and 3,000 a month, which a single campaign to the full list would exceed. **Resend Pro is about US$20/month** for 50,000 emails.
- **Supabase:** Edge Functions and scheduled jobs work on the free plan. Pro (about US$25/month) is still recommended once real client data is in, for backups and so the project isn't paused for inactivity.
- **Microsoft:** no extra licence. An Entra admin approves the new permissions:
  - `Calendars.ReadWrite`
  - `Mail.Send`
  - `Mail.Read` (for reply detection)
  - `offline_access`
- **Email authentication:** the domain already has SPF, DKIM through Resend, and DMARC (`p=none`). Once campaigns are running cleanly, tighten DMARC to `quarantine`.

## Decisions on the open questions (2026-11-17)

1. **Consent for existing leads:** they are past clients, or inquiries and referrals.
   - At import, each lead gets **implied consent**, dated from its last deal (past clients, valid 2 years) or its inquiry (valid 6 months).
   - Leads whose implied consent has already expired are imported as **no consent**, and Hub won't email them marketing.
   - The import needs each lead's last-deal or inquiry date to work this out. If a lead has no date, it's treated as no consent.
2. **Footer details:** still needed. The brokerage's legal name, mailing address and phone.
3. **Sending:** admins only (Matt and Eric) can send campaigns and start sequences. Members can draft them.
4. **Teams links:** a tick box when scheduling, off by default.
5. **Free/busy:** when scheduling, Hub shows chosen teammates' busy times alongside yours. This uses Outlook's normal free/busy sharing, so no meeting details are shown.
