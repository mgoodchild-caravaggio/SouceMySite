# Plan: campaigns built around matching buyers and sellers

Requested 2026-11-18. Today a Hub "campaign" is an email blast. For a real estate brokerage the core job is different: **take an opportunity (a property for sale, or a buyer's requirement) and find, work and track the people in the database who match it.** Email becomes one of several ways to work that list.

## What the data looks like today (after the Salesforce import)

- 411 Real Estate prospects: 293 sellers, 159 buyers, 77 builder/developers, 43 investors (many have more than one type).
- 207 properties on the map, almost all marked *Owns* (sellers' land).
- **Buyers' needs are barely recorded.** For 159 buyers there is only the category and region tags, and just one property marked *Interested in*. There is nothing on size, price or exact area. Matching a property to buyers needs this captured properly. That's the first thing to build.

## The new model in one picture

```
Opportunity ──► Campaign ──► Members (matched prospects, each with a stage)
  (a listing,      (criteria + map area,      Suggested → Shortlisted → Contacted →
   or a buyer's     find matches, work         Interested / Not interested → Offer
   requirement)     the list)                  ...plus email, call list, notes, meetings
```

### 1. Opportunities: what we're trying to match

Two kinds, both linked to a contact:

| | **Listing** (we have a property) | **Requirement** (a buyer wants something) |
| --- | --- | --- |
| Belongs to | A seller and one of their properties | A buyer, investor or builder/developer |
| Where | The property's location | An area: a radius around a point, or an area drawn on the map; or regions |
| What | Category, acres, asking price, zoning or status notes | Wanted categories, acre range, budget range, timing (e.g. "within 6 months") |
| Status | Open → Under offer → Sold / Withdrawn | Open → Matched → Closed / Dropped |

Requirements replace today's loose "Buyer + categories + regions" tags. Existing buyers get a **draft requirement** created from their current categories and regions, marked "needs detail", so nothing starts empty.

### 2. Matching: who fits

One matching engine, used everywhere (campaigns, contact pages, the AI assistant):

- **Listing → people:**
  - **Buyer requirements** whose area covers the property and whose categories, acreage and budget fit.
  - **Builder/developers and investors** active in that area. This is based on their properties and regions.
- **Requirement → properties and people:** properties and open listings inside the area that fit category and size, with their owners. This includes owners not yet marked as selling (useful "would you sell?" calls).
- **Nearby:** anything within *X* km of a point, using the same distance logic as today's map.
- **Same filters as the Prospects list:** customer type, category, region, status, campaign tag, assigned to, follow-up, can-email.
- **Score and reasons:** each match gets a score and plain reasons, so the list is ranked and explainable, for example:
  - "Wants Expansion Boundary · 4.2 km away · 40–80 ac fits 61 ac · budget fits".
  - Missing data shows as "unknown", not a mismatch, so incomplete records still surface.

### 3. Campaigns: work a matched list

A campaign is now **an opportunity plus a working list**:

- **Start from:** a listing ("Find buyers for 2368 6th Line"), a requirement ("Find land for the Defrancesco buyers"), or a blank area/criteria search (e.g. "Hewitts Creek land owners").
- **Criteria panel:** the Prospects-list filters plus **a map you can work directly**:
  - a radius slider around the property, or drawing an area;
  - pins for every candidate, coloured by stage, and click a pin to add or remove someone;
  - an "along a route" option, as on today's Map.
- **Find matches:** fills a **Suggested** list ranked by score. Nothing is added to the campaign until you accept it, singly or in bulk.
- **Add and remove members:** from the suggestions, by searching anyone, from a map pin, from a prospect page ("Add to campaign…"), or from the Prospects list's bulk actions.
- **A stage for each member:** Suggested → Shortlisted → Contacted → Interested → Not interested → Offer/Deal, with a note, last contact date and assignee. The list shows the stage counts like a small pipeline.
- **Work the list:**
  - a **call list** in score order, with phone, reason and last note;
  - **Schedule** a meeting from each row (already built);
  - one-off email from Outlook (already built);
  - an optional **email blast** to the consenting members, which is today's email campaign now living inside the matching campaign;
  - export.
- **Results:** members by stage, contacts made, interested count, meetings booked, and email stats where used.
- **Today's email-only campaigns** keep working. They show as campaigns with no opportunity.

### 4. Opportunities on every prospect page (for live calls)

A **"Matches & nearby"** panel on each contact page, built for when you're on the phone:

- **For a seller:** open buyer requirements and builder/developers that fit their property, plus other opportunities within 5 / 10 / 25 km.
- **For a buyer or developer:** listings and properties that fit their requirement, and owners in their target area.
- **One-click actions:** "Add to campaign…", "Start a campaign from this", and "Create a requirement / listing".
- **On the map:** the same view appears as a "Match mode" on the Map page. Pick a contact or opportunity, and the map shows its matches with their reasons.

### 5. Ask Hub: the AI assistant

A chat box in the sidebar, on campaigns and on contact pages, that understands plain requests and works through Hub's own data first:

- "Who are the builder/developers we know within 20 km of Bradford?"
- "We just listed 61 acres of Expansion Boundary land in Innisfil. Which buyers match?"
- "Find land for the Simcoe industrial buyer, 20–50 acres, under $8M."
- "Who should I call this week about the Elfrida campaign?"

**How it works:** Claude (Opus 5.5) is given Hub search tools, such as search contacts, find matches, nearby, campaign members and open requirements. It runs them and answers with linked contacts and the reasons. It can add people to a campaign as **Suggested**, and **it never changes data without a click from you**.

**Outside research (phase 2 of the assistant):** live web search to find:

- **Local builder/developers** in an area who aren't in Hub yet, with company, website, phone and a source link.
- **Municipal development activity:** development applications, site plans, rezonings and Official Plan amendments. Many Ontario municipalities publish these, for example York Region, Barrie, Vaughan and Toronto's application centre.
- Hub links each finding to nearby properties or prospects ("2 owners within 1 km of this rezoning").

Research results arrive as **leads to review**, with their source. Adding one creates a prospect with lead source "AI research: <source>" and **no email consent**, so CASL rules still apply.

**Privacy:** Ask Hub sends the relevant Hub records to Anthropic's API to answer. Anthropic doesn't train on API data by default. This should be mentioned in Caravaggio's privacy notice.

**Cost (estimates at Opus 5.5's $4 / $20 per million tokens):**
- **A Hub-only question:** roughly 10–20k input and 1–3k output tokens, about **$0.05–0.15**.
- **A web research request:** more tokens from search results, about **$0.25–0.75**, plus Anthropic's per-search fee.
- **Monthly:** a few hundred questions a month is likely **$20–60**.
- **Keeping it in check:** a monthly spend cap in Hub, and usage shown in Settings.

## Data model additions

| Table | Holds |
| --- | --- |
| `opportunities` | Kind (listing / requirement), listing type (Listed / Off-market), contact, property (listings), title, categories, acres min–max, price/budget min–max, zoning/OP designations, servicing (available / planned / none, or "needs"), timeline (target date), assembly wanted + minimum total acres, area (centre + radius km, or a drawn polygon), regions, status, notes |
| `campaigns` (extended) | Opportunity (optional), kind (match / email), criteria (filters + area), owner, status |
| `campaign_members` | Campaign, contact, stage, score, match reasons, added by / how (suggested, manual, AI, map), note, last contacted, assigned to |
| `ai_requests` | Who asked, question, tools used, tokens and cost, for the spend cap and audit |
| `ai_settings` | Whether Ask Hub is on, monthly cap, model. The Anthropic API key itself is a server secret, set from Settings by an admin and never sent back to the browser |

Matching runs in the browser for lists and maps, since all contacts are already loaded. The same rules also run as database functions, for the AI assistant and for larger data later. PostGIS can be added if drawn areas and big radius searches get slow.

## Build order

1. ✅ **Opportunities** (built 2026-11-18):
   - listings and requirements on contact pages;
   - a requirement editor with a map area picker;
   - draft requirements for the 159 existing buyers.
2. ✅ **Matching engine** (built 2026-11-18):
   - scores 0–100 with reasons (green fits, amber close, red misses); missing data counts as unknown, not a miss;
   - a "Matches & nearby" panel on Real Estate contact pages: matches per open listing or requirement, and what's within 5/10/25 km of their land;
   - Match mode on the Map (`/map?match=<id>`, from "Show on map →"): centred on the land or search area, with the ranked list beside it.
3. ✅ **Matching campaigns** (built 2026-11-18):
   - create from an opportunity ("Start a campaign" on a contact's matches) or from an area and filters;
   - Find matches with filters and a clickable map; add singly, in bulk, from a pin, by name, from a contact page or the lists' bulk bar; remove;
   - stages, notes, assignee and last-contacted per member, logged on the contact's timeline; stage counts, meetings booked, export;
   - "Email members" creates an email blast to the list (consent rules unchanged); email-only campaigns live under the Email blasts tab.
   - Not yet: searching along a route, and drawing an area (a radius around a point for now).
4. ✅ **Ask Hub, internal data** (built 2026-11-18, off until a key is added):
   - an **Ask Hub** button in the sidebar opens a chat panel on any page; it knows which contact, campaign or match the user is looking at;
   - Claude (Opus 5.5) works through Hub's own tools: search contacts (filters, near a place, follow-ups), get a contact, locate a place, list listings/requirements, find matches, nearby, list campaigns and their members;
   - the tools run in the browser over the data Hub already has, with the user's own permissions; the `ask-hub` function holds the key, checks the monthly cap, calls Claude and logs tokens and cost in `ai_requests`;
   - it can only *propose* adding people to a campaign (as Suggested); the user clicks to accept;
   - Settings → Ask Hub (admins): add, replace or remove the key (checked with Anthropic, stored encrypted, never shown again), switch on/off, monthly cap (default $50), usage meter and recent questions.
5. ✅ **Ask Hub, outside research** (built 2026-11-26):
   - a **Research** page: pick *Builders & developers* or *Development applications*, one of the four areas (or another town) and an optional focus;
   - the `ai-research` function runs it in short steps (a few web searches each, at most 14 per run), starting from each area's official municipal sites and skipping builders already in Hub; it counts toward Ask Hub's monthly cap;
   - findings are **leads to review** with their source link; Hub flags ones that look like an existing contact, places applications on the map and lists Hub contacts with land within 1 km;
   - **Add as prospect** opens the new-contact form filled in (lead source "AI research: <site>", **no email consent**) and, for an application, pins its land; **Dismiss** hides it.

Steps 1–3 deliver the core buyer/seller matching without any AI cost. Steps 4–5 add the assistant on top, using the same matching tools.

## Decisions (2026-11-18)

1. **Naming:** they stay **Campaigns**. A campaign is an opportunity plus its matched list. Email blasts become an action inside it, and existing email-only campaigns keep working.
2. **Listings:** any land being actively shopped counts, not only Caravaggio listings. A listing is marked **Listed** (under a Caravaggio agreement) or **Off-market** (an owner's land being marketed informally).
3. **Matching criteria:** besides category, acres, budget/price and area, matching also considers:
   - **Zoning / Official Plan designation** on listings, and the designations wanted on requirements.
   - **Servicing:** water and sewer *available*, *planned* or *none*. Requirements can say "needs servicing".
   - **Timeline:** when the seller wants to sell, and when the buyer wants to close. Close dates score higher.
   - **Land assembly:** requirements can say "assembly wanted" (minimum total acres across neighbouring parcels). Listings then also surface **neighbouring owners** within a short distance, as candidates for an assembly.
4. **AI:** build Ask Hub in full, but **switched off until an admin adds an Anthropic API key in Settings**. The key is stored as a server secret and is never readable in the browser. Until then, the Ask Hub box explains how to turn it on. A monthly spend cap is set in Settings when it's enabled, with $50 as the suggested default.
5. **Municipal research covers four areas first:**
   - **Simcoe:** Barrie, Innisfil, Bradford West Gwillimbury.
   - **Durham.**
   - **York Region.**
   - **Hamilton / Halton / Peel.**

   Each area gets a list of its official development-application pages, so web research starts from authoritative sources.
