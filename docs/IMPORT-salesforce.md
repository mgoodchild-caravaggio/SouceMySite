# Salesforce import (export of 2026-11-16)

Source: `~/Downloads/salesforce-export-2026-11-16/` (not committed; it holds client personal information).
Script: `scripts/import-salesforce.py` builds the import as SQL plus a report. A dry run writes nothing to Hub.

## What comes in

| Export | Rows | Becomes in Hub |
| --- | --- | --- |
| `leads-caravaggio.csv` | 411 | **Real Estate prospects** |
| `leads-staging.csv` | 602 | **Staging prospects** (contractors from municipal tenders, "Infrastructure Staging Solutions") |
| `contacts.csv` | 173 | **Other contacts** (Real Estate), except ones that are the same person as a lead (converted, or same email), whose extra phone numbers are merged into that lead |
| `accounts.csv` | 136 | Company name on the contacts above |
| `campaign_members.csv` | 1097 | Each contact's **campaign tags** (e.g. "Intro Letter Sellers") |
| `tasks.csv` | 125 | **Activity notes**. The earliest open task's due date becomes the **follow-up date** |
| `opportunities.csv` | 14 | Activity notes, and the **deal value** where the lead has none |
| `campaigns.csv` | 30 | Only the names (via campaign tags) |

Every imported record keeps its Salesforce ID in Hub's ID (`SF-…`), so it can be traced back, and the import can be rerun without creating duplicates.

## Field rules

- **Assigned to:** Eric, the owner of every Salesforce record.
- **Company:** "na", "n/a" and "tbd" mean an individual, which Hub shows as "Individual".
- **Customer types:** "Builder Developer" becomes "Builder/Developer". All others match.
- **Categories:** "Urban Boundary" and "Condo Land" are added back to Hub's list, so nothing is lost.
- **Regions:**
  - "Greater Golden Horshoe" is corrected to "Greater Golden Horseshoe".
  - "London" becomes "Middlesex".
  - "Niagara", "Wellington" and "Grey Bruce" are added to Hub's list.
- **Real Estate mailing address:** the lead's own street address.
- **Properties:** taken from the opportunity address fields (Address 1–4), with duplicates removed. Each property gets the lead's first category; leads with no category get "Investment Property". The relationship is *Owns* for sellers and *Interested in* for buyers. **Location** (for example "Barrie - Hewitts Creek") goes into the summary notes.
- **Map positions:** looked up once through OpenStreetMap, at most one per second. Addresses it can't find are listed in the report, so they can be placed by hand in Hub's property editor.
- **Staging notes:** the lead's description, including its contract links. The tender name becomes the lead source.

## Email consent (CASL)

- **Real Estate:** *None* for everyone. The export has no dated deals or inquiries to support implied consent. Add consent per person as they opt in or a past deal is confirmed.
- **Staging:** *Implied*. Source: "Published business contact (municipal tender)", dated from when Salesforce created the lead, with no end date ("conspicuous publication").
- **Other contacts:** *None*.

## Before the import

- All sample data (the 126 fictional contacts and their properties and activity) is deleted.
- The new categories and regions are added to the database rules and the app.
