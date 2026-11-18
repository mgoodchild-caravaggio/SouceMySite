# Hub

Caravaggio Real Estate's internal app, at https://hub.caravaggiorealestate.ca. Its first tool is a map-first prospect CRM laid out like realtor.ca: map on the left, results on the right.

- **Near a place**: search a town, address or postal code, or click the map. Prospects with a property inside the radius are listed, closest first.
- **Along a route**: set a start (or use your location) and a destination. Prospects with a property within the corridor are listed in the order you'd reach them.
- Filters cover status, customer type, category, region, campaign, follow-up and name/company/phone (all multi-select, matching the Salesforce fields).
- **Export call list** downloads the current results as a CSV (name, company, phone, email, status, distance, property).
- Status, follow-up and notes can be edited. Edits are saved to the database and shared by everyone signed in.
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
  - `supabase/migrations/` holds the schema. Signed-in users can read everything and change only status, follow-up and notes; anonymous requests are refused. Apply changes with `supabase db push`.
  - `supabase/seed.sql` is the fictional sample data, generated from `src/data/seed.ts` with `npm run seed:generate`.
  - Auth settings (site URL, redirect URLs, sign-up disabled, email) live in `supabase/config.toml` and are applied with `supabase config push`. Run it with `.env.local` loaded (`set -a; . ./.env.local; set +a`) so the email password is included.
- **Email:** invite and sign-in emails go through Resend from "Hub" <noreply@caravaggiorealestate.ca> (domain verified with DNS records at Squarespace). The Resend API key is `SUPABASE_AUTH_SMTP_PASS` in `.env.local`. Limit: 30 emails an hour.
- **Microsoft sign-in:** Entra app registration "Prospect Map" (shown to users on Microsoft's consent screen; rename it to "Hub" in Entra if wanted) in the Caravaggio tenant. Its client ID, secret and tenant URL (`https://login.microsoftonline.com/<tenant-id>`, no `/v2.0`) are `SUPABASE_AUTH_EXTERNAL_AZURE_*` in `.env.local`. The client secret expires after 24 months and must be renewed in Entra, then pushed with `supabase config push`.

### Adding a user

Supabase dashboard → Authentication → Users → **Invite user**. They then sign in on the app with that email.

## Notes

- **Data is fictional.** `src/data/seed.ts` generates 110 sample prospects around real Southern Ontario towns. Phone numbers are 555-01xx and emails are @example.com. Each property is one pin, and a prospect can have several.
- **Real data needs a location per prospect.** The Salesforce Leads described in the setup brief have no address or coordinates, so each prospect's property address will need to be captured and geocoded.
- **Map services** are the public OpenStreetMap tiles, Nominatim search and OSRM routing (`src/lib/services.ts`). They're free but rate-limited. Production use needs a paid or self-hosted provider (e.g. MapTiler, Stadia, or Mapbox).
