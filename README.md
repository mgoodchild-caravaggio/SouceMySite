# Prospect Map

A map-first CRM prototype for Caravaggio Real Estate prospects, laid out like realtor.ca: map on the left, results on the right.

- **Near a place**: search a town, address or postal code, or click the map. Prospects with a property inside the radius are listed, closest first.
- **Along a route**: set a start (or use your location) and a destination. Prospects with a property within the corridor are listed in the order you'd reach them.
- Filters cover status, customer type, category, region, campaign, follow-up and name/company/phone (all multi-select, matching the Salesforce fields).
- **Export call list** downloads the current results as a CSV (name, company, phone, email, status, distance, property).
- Status, follow-up and notes can be edited. Edits are saved in this browser only.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

## Deploy

Pushing to `main` builds the site and publishes it to GitHub Pages (`.github/workflows/deploy.yml`) at https://cgtechnologies.github.io/prospect-map/. The repository is private, but the published site is public to anyone with the link.

## Notes

- **Data is fictional.** `src/data/seed.ts` generates 110 sample prospects around real Southern Ontario towns. Phone numbers are 555-01xx and emails are @example.com. Each property is one pin, and a prospect can have several.
- **Real data needs a location per prospect.** The Salesforce Leads described in the setup brief have no address or coordinates, so each prospect's property address will need to be captured and geocoded.
- **Map services** are the public OpenStreetMap tiles, Nominatim search and OSRM routing (`src/lib/services.ts`). They're free but rate-limited. Production use needs a paid or self-hosted provider (e.g. MapTiler, Stadia, or Mapbox).
