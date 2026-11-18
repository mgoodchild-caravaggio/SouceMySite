# Hub

Caravaggio Real Estate's internal app, at https://hub.caravaggiorealestate.ca. A sidebar switches between the Real Estate and Staging businesses and leads to the Dashboard, Map, Prospects, Contacts and Archive pages. Plans for the pages still being built are in [docs/ROADMAP.md](docs/ROADMAP.md).

- **Dashboard:** follow-ups due (overdue, today, next 7 days; mine or everyone) with Call, Done and Snooze; pipeline count and deal value by status; recent team activity; and a map of Lead and Active Lead properties.
- **Prospects / Contacts:** sortable tables with search, filters (kept in the page address), and bulk status, assign, campaign, make-prospect, export and archive. Contacts has All / Prospects / Other contacts tabs.
- **Contact page:** details, follow-up date and assignment (Done / Tomorrow / Next week), status, summary, properties with a map (address search and draggable pin), and an activity timeline for calls, notes, emails and meetings.
- **Theme:** Light, Dark or System (follows the device), from the button at the bottom of the sidebar; remembered per device. Colours are CSS variables at the top of `src/styles.css`, with separate dark values.
- **Calendar (Outlook):** the Dashboard shows your upcoming Outlook meetings, linked to contacts by email. Contact pages and follow-up rows have **Schedule**: a call, meeting or site visit booked into your Outlook (with your and teammates' free/busy, an optional Teams link, and invites to the contact and teammates), recorded on the contact. Cancelling from Hub cancels it in Outlook.
- **Email (Outlook):** the Email button on a contact opens a composer that sends from your own Outlook (it lands in your Sent Items; replies come to you) and logs it in Activity. Start from a template; fields like `{{first_name}}` and `{{property_address}}` are filled in, and mistyped fields are caught before sending. Your signature (Settings) is added automatically. People on the do-not-email list need a deliberate "personal message about a specific deal" confirmation.
- **Campaigns:** marketing email through Resend. Pick an audience with list-style filters (only contacts with valid consent are included, and Hub shows who's left out and why), write or start from a template with merge fields, preview as a real recipient, send yourself a test, then (admins only) send now or schedule. Each email carries the sender's signature, the brokerage details CASL requires (Settings) and an unsubscribe link (public page at `/unsubscribe`, plus one-click unsubscribe in mail apps). Results show delivered, opened, clicked, bounced and unsubscribed per recipient; hard bounces and spam complaints go on the do-not-email list.
- **Settings:** your display name, email signature, email templates (shared or personal), **Connect Outlook** (Microsoft 365 calendar and mail access for upcoming features), and the team list.
- **Email consent:** each contact records CASL consent (express, or implied with an end date) and can be marked unsubscribed, which adds them to a permanent do-not-email list. Lists can filter to "Can email".
- **Archive:** archived contacts can be restored by anyone and permanently deleted by admins.

The Map page is a map-first prospect search laid out like realtor.ca: map on the left, results on the right.

- **Near a place**: search a town, address or postal code, or click the map. Prospects with a property inside the radius are listed, closest first.
- **Along a route**: set a start (or use your location) and a destination. Prospects with a property within the corridor are listed in the order you'd reach them.
- Filters cover status, customer type, category, region, campaign, follow-up and name/company/phone (all multi-select, matching the Salesforce fields).
- **Export call list** downloads the current results as a CSV (name, company, phone, email, status, distance, property).
- Status, follow-up and notes can be edited. Edits are saved to the database and shared by everyone signed in. Status changes, new contacts and archiving are logged automatically in the activity history.
- Sign-in is invite-only: only people added in Supabase can get in. They can use an emailed link or "Continue with Microsoft" (Caravaggio's Microsoft 365 accounts only). "Continue with Google" appears once the Google provider is turned on in `supabase/config.toml`.

## Run

Create `.env.local` with the Supabase project URL and publishable key (Supabase dashboard → Project Settings → API Keys):

```
VITE_SUPABASE_URL=https://whtbouubrvqanmxtyabz.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Then:

```bash
npm install
npm run dev
```

Open http://localhost:5173 and sign in with an invited email.

## Hosting

- **App:** Railway project `prospect-map`, service `web`, at https://hub.caravaggiorealestate.ca (custom domain; the Railway address https://web-production-2ef32975.up.railway.app also works). Pushing to `main` deploys automatically. Railway runs `npm run build` and serves `dist/` with `npm start`. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are set as service variables. `railway up --service web` deploys local changes without pushing.
- **Database and sign-in:** Supabase project `prospect-map` in ca-central-1 (Canada).
  - `supabase/migrations/` holds the schema: `contacts` (prospects are contacts with `is_prospect`), their `properties`, an `activities` log and user `profiles` with roles. Signed-in users can read, add, edit and archive; only admins can permanently delete, and only archived contacts. Anonymous requests are refused. Apply changes with `supabase db push`.
  - Admins: set `role = 'admin'` on the person's row in `profiles` (Supabase dashboard → Table Editor). A profile is created automatically the first time someone is invited.
  - `supabase/seed.sql` is the fictional sample data, generated from `src/data/seed.ts` with `npm run seed:generate`.
  - Auth settings (site URL, redirect URLs, sign-up disabled, email) live in `supabase/config.toml` and are applied with `supabase config push`. Run it with `.env.local` loaded (`set -a; . ./.env.local; set +a`) so the email password is included.
- **Email:** invite and sign-in emails go through Resend from "Hub" <noreply@caravaggiorealestate.ca> (domain verified with DNS records at Squarespace). The Resend API key is `SUPABASE_AUTH_SMTP_PASS` in `.env.local`. Limit: 30 emails an hour.
- **Server functions:** `supabase/functions/` holds Supabase Edge Functions (`outlook-connect`, `outlook-callback`, `outlook-disconnect`, `outlook-check`, `calendar-events`, `calendar-freebusy`, `calendar-schedule`, `calendar-cancel`, `mail-send`, `campaign-send`, `campaign-worker`, `resend-webhook`, `unsubscribe`). A scheduled job (`pg_cron`, every 5 minutes) calls `campaign-worker` to start scheduled campaigns and keep sending within Resend's limits; its secret is in Supabase Vault as `campaign_worker_secret` and in `.env.local` as `CAMPAIGN_WORKER_SECRET`. `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET` are function secrets. Deploy with `supabase functions deploy <name> --use-api`. Their secrets (`MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, `TOKEN_KEY`, `APP_ORIGINS`) are set with `supabase secrets set`; `TOKEN_KEY` (which encrypts stored Outlook tokens) is also kept as `OUTLOOK_TOKEN_KEY` in `.env.local`. Changing it disconnects everyone's Outlook.
- **Microsoft sign-in:** Entra app registration "Prospect Map" (shown to users on Microsoft's consent screen; rename it to "Hub" in Entra if wanted) in the Caravaggio tenant. Its client ID, secret and tenant URL (`https://login.microsoftonline.com/<tenant-id>`, no `/v2.0`) are `SUPABASE_AUTH_EXTERNAL_AZURE_*` in `.env.local`. The client secret expires after 24 months and must be renewed in Entra, then pushed with `supabase config push`.

### Adding a user

Supabase dashboard → Authentication → Users → **Invite user**. They then sign in on the app with that email.

## Notes

- **Data is fictional.** `src/data/seed.ts` generates 110 sample prospects around real Southern Ontario towns, plus 16 other contacts (lawyers, lenders, planners; some in Staging). Phone numbers are 555-01xx/02xx and emails are @example.com. Each property is one pin, and a prospect can have several.
- **Real data needs a location per prospect.** The Salesforce Leads described in the setup brief have no address or coordinates, so each prospect's property address will need to be captured and geocoded.
- **Map services** are the public OpenStreetMap tiles, Nominatim search and OSRM routing (`src/lib/services.ts`). They're free but rate-limited. Production use needs a paid or self-hosted provider (e.g. MapTiler, Stadia, or Mapbox).
