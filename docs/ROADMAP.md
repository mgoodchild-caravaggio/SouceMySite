# Hub roadmap: dashboard, lists, contacts and editing

Decisions so far (2026-11-17):

- **One contact list.** Everyone (prospects, lawyers, lenders, planners, referral sources) is a contact. Marking a contact as a prospect adds pipeline status, properties and map pins. Tabs filter the same list, so nobody is retyped when they become a prospect.
- **Dashboard is the home page** after sign-in, with follow-ups due, pipeline counts, recent activity and a map snapshot.
- **Delete means archive.** Anyone can archive and restore; only admins can permanently delete.
- **Everyone edits.** All invited users can add and edit. Admins (Matt and Eric) also invite users and purge the archive.
- **Two businesses, one switch.** Each contact belongs to Real Estate or Staging. A switch in the sidebar shows one business at a time; everyone can see both.
- **Prospects are assigned** to a person, so the dashboard shows "my follow-ups" by default.

## Navigation

A left sidebar (bottom tab bar on phones), with a real URL for every page so links, bookmarks and the back button work:

| Page | URL | What it is |
| --- | --- | --- |
| Dashboard | `/` | Start page after sign-in |
| *Business switch* | — | Real Estate / Staging, top of the sidebar; filters every page below and is remembered per user |
| Map | `/map` | Today's map search (near a place / along a route), prospects only |
| Prospects | `/prospects` | Table of contacts marked as prospects |
| Contacts | `/contacts` | Table of everyone, with tabs: All · Prospects · Other contacts |
| Contact | `/contacts/:id` | One contact: details, properties, activity, follow-up |
| Archive | `/archive` | Archived contacts; restore, or purge (admins) |

## Data model changes

| Table | Change |
| --- | --- |
| `prospects` → **`contacts`** | Renamed. Adds `business` (Real Estate or Staging), `is_prospect`, `title` (role, e.g. Planner, Lawyer, Owner), `phone_2` (second phone), `mailing_address`, `website` (website or LinkedIn), `follow_up_on` (date, replaces the yes/no flag), `assigned_to` (user), `archived_at/by`, `created_by`. Status, properties and deal value only apply when `is_prospect` is true. |
| `properties` | Unchanged apart from pointing at `contacts`. Address search fills in the map position; the pin can be dragged to correct it. |
| **`activities`** (new) | One row per note, call, email, meeting, status change or follow-up done: `contact_id`, `kind`, `body`, `occurred_at`, `created_by`. Feeds the contact timeline and the dashboard's recent activity. The current single notes field becomes a short "summary". |
| **`profiles`** (new) | One row per user: display name and role (`admin` or `member`). Used for "assigned to", "by whom" and admin-only actions. |

Access rules: signed-in users can read and edit all live contacts, properties and activities, and archive/restore. Only admins can permanently delete. Archived contacts are hidden everywhere except the Archive page.

## Pages in detail

**Dashboard**
- *Follow-ups due:* overdue, today and this week, grouped. Each row has call/email links and Done (logs an activity) and Snooze (moves the date). Defaults to "assigned to me", with a toggle for everyone.
- *Pipeline:* count and total deal value per status (Prospect, Contacted, Lead, Active Lead). Clicking a status opens the Prospects list filtered to it.
- *Recent activity:* the latest 20 notes, calls and changes across the team, linking to each contact.
- *Map snapshot:* small map of Lead and Active Lead properties; click through to the full map.

**Prospects and Contacts lists**
- Columns: name, company, phone, status, customer types, region, follow-up date, deal value, last activity. Sortable, with column choice remembered per user.
- The same search and filters as the map, kept in the URL so a filtered list can be shared.
- Select several rows to change status, add to a campaign, assign, archive or export CSV.
- Contacts tab adds "Make prospect" for non-prospects.

**Contact page and add/edit**
- Details form with validation (phone format, email) and a duplicate warning when the phone or email already exists.
- Properties section: add, edit or remove properties, each with address search and a draggable pin on a small map.
- Activity timeline with quick "Log a call" and "Add note".
- "New contact" button on the lists, plus "Add prospect here" from a map click.

## Build order

1. ✅ **Foundation** (done 2026-11-17): routing, sidebar and business switch; database migration (contacts with the new fields, activities, profiles with Matt and Eric as admins, archive, follow-up date, assignment); updated access rules; current map moves to `/map` unchanged.
2. ✅ **Lists and editing** (done 2026-11-17; still to do: remembering column choices per user, and "Add prospect here" from a map click): Prospects and Contacts tables, contact page, add/edit/archive/restore, property editor with address search.
3. ✅ **Dashboard** (done 2026-11-17): the four panels, built on the activities and follow-up dates from step 1.
4. **Salesforce import:** the 413 leads mapped into contacts (with Seller and the other agreed customer types), properties geocoded, sample data removed. Switch to a paid map/geocoding provider before this step.

Each step is deployable on its own, so Hub stays usable throughout.

## Still needed

- **Eric's email address**, to invite him and make him an admin.
- **Which Salesforce records are staging**, when we get to the import (step 4).
