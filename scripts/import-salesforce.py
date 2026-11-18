#!/usr/bin/env python3
"""Builds Hub's Salesforce import (docs/IMPORT-salesforce.md) as SQL plus a report, without touching Hub.

    python3 -I scripts/import-salesforce.py <export-dir> <out-dir> --assign-to <profile-uuid> [--no-geocode]

Writes <out-dir>/import.sql, <out-dir>/report.md and <out-dir>/geocode-cache.json (reused on reruns so each
address is looked up once). Standard library only.
"""
import csv, json, re, sys, time, urllib.parse, urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

args = sys.argv[1:]
if len(args) < 4 or '--assign-to' not in args:
    sys.exit(__doc__)
EXPORT, OUT = Path(args[0]), Path(args[1])
ASSIGN_TO = args[args.index('--assign-to') + 1]
GEOCODE = '--no-geocode' not in args
OUT.mkdir(parents=True, exist_ok=True)

def load(name):
    with open(EXPORT / name, newline='', encoding='utf-8-sig') as fh:
        return list(csv.DictReader(fh))

v = lambda r, k: (r.get(k) or '').strip()

# ---------------------------------------------------------------- value mapping
CATEGORIES = ['Industrial Land', 'Residential Land', 'Industrial Building', 'Residential', 'Agricultural', 'White Belt',
              'Expansion Boundary', 'Investment Property', 'Urban Boundary', 'Condo Land']
REGIONS = ['Simcoe', 'York', 'Toronto', 'Halton', 'Peel', 'Durham', 'Hamilton-Wentworth', 'Greater Golden Horseshoe',
           'Middlesex', 'Peterborough', 'Niagara', 'Wellington', 'Grey Bruce']
REGION_FIX = {'Greater Golden Horshoe': 'Greater Golden Horseshoe', 'London': 'Middlesex'}
TYPES = ['Buyer', 'Seller', 'Builder/Developer', 'Investor', 'Past Client', 'Agricultural', 'Finance/Lender',
         'Referral Source', 'Infrastructure']
TYPE_FIX = {'Builder Developer': 'Builder/Developer'}
STATUSES = ['Prospect', 'Contacted', 'Lead', 'Active Lead', 'Unqualified']
unknown = defaultdict(Counter)  # values we couldn't map, for the report

def multi(raw, allowed, fix, field):
    out = []
    for part in [p.strip() for p in raw.split(';') if p.strip()]:
        part = fix.get(part, part)
        if part in allowed:
            if part not in out:
                out.append(part)
        else:
            unknown[field][part] += 1
    return out

def company(raw):
    return 'tbd' if raw.strip().lower() in ('', 'na', 'n/a', 'tbd', 'none', '-', '.') else raw.strip()

def money(raw):
    try:
        n = float(re.sub(r'[^\d.]', '', raw))
        return n if n > 0 else None
    except ValueError:
        return None

def join(*parts):
    return ', '.join(p for p in (x.strip() for x in parts) if p)

# ---------------------------------------------------------------- geocoding (OpenStreetMap Nominatim, 1/sec)
ROAD_TYPES = {'road', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'service', 'track'}
cache_file = OUT / 'geocode-cache.json'
cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
last_call = [0.0]

def geocode(query):
    if query in cache:
        return cache[query]
    if not GEOCODE:
        return None
    wait = 1.1 - (time.time() - last_call[0])
    if wait > 0:
        time.sleep(wait)
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode(
        {'q': query, 'format': 'jsonv2', 'countrycodes': 'ca', 'limit': 1})
    req = urllib.request.Request(url, headers={'User-Agent': 'Hub-CRM-import/1.0 (one-off address lookup)'})
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            rows = json.load(res)
    except Exception as e:  # network trouble: leave uncached so a rerun retries
        print(f'  geocode error: {e}', file=sys.stderr)
        last_call[0] = time.time()
        return None
    last_call[0] = time.time()
    hit = {'lat': float(rows[0]['lat']), 'lng': float(rows[0]['lon']), 'type': rows[0].get('addresstype', '')} if rows else None
    cache[query] = hit
    cache_file.write_text(json.dumps(cache, indent=1))
    return hit

def locate(street, city, postal, state):
    """Tries the full address, then street + city. Returns (hit, how)."""
    if not street:
        return None, ''
    state = state or 'ON'
    for q, how in ((join(street, city, f'{state} {postal}'.strip(), 'Canada'), 'full'), (join(street, city, state, 'Canada'), 'street+city')):
        hit = geocode(q)
        if hit:
            return hit, how
    return None, ''

# ---------------------------------------------------------------- load export
leads_re = load('leads-caravaggio.csv')
leads_st = load('leads-staging.csv')
contacts_sf = load('contacts.csv')
accounts = {r['Id']: r for r in load('accounts.csv')}
campaign_names = {r['Id']: r['Name'].strip() for r in load('campaigns.csv')}
members = load('campaign_members.csv')
tasks = load('tasks.csv')
opps = load('opportunities.csv')

tags = defaultdict(list)  # Salesforce lead/contact id -> campaign names
for m in members:
    who = v(m, 'LeadId') or v(m, 'ContactId')
    name = campaign_names.get(m['CampaignId'])
    if who and name and name not in tags[who]:
        tags[who].append(name)

hub = {}      # Salesforce id -> Hub contact dict
alias = {}    # Salesforce id of a merged contact -> Hub contact's Salesforce id
props = []
report = defaultdict(list)

def base(r, sid, business, is_prospect):
    return {
        'id': f'SF-{sid}', 'business': business, 'is_prospect': is_prospect,
        'first_name': v(r, 'FirstName'), 'last_name': v(r, 'LastName'), 'title': v(r, 'Title'),
        'phone': v(r, 'Phone'), 'phone_2': v(r, 'MobilePhone'), 'email': v(r, 'Email').lower() or None,
        'website': v(r, 'Website'), 'status': 'Prospect', 'lead_source': v(r, 'LeadSource'),
        'regions': [], 'categories': [], 'customer_types': [], 'deal_value': None, 'follow_up_on': None,
        'assigned_to': ASSIGN_TO, 'campaigns': tags.get(sid, []), 'notes': '',
        'email_consent': 'none', 'consent_date': None, 'consent_source': '', 'consent_expires_on': None,
        'created_at': v(r, 'CreatedDate') or None,
    }

# Real Estate leads -> prospects with properties
for r in leads_re:
    c = base(r, r['Id'], 'Real Estate', True)
    c['company'] = company(v(r, 'Company'))
    c['status'] = v(r, 'Status') if v(r, 'Status') in STATUSES else 'Prospect'
    c['regions'] = multi(v(r, 'Regions__c'), REGIONS, REGION_FIX, 'region')
    c['categories'] = multi(v(r, 'Categories_new__c'), CATEGORIES, {}, 'category')
    c['customer_types'] = multi(v(r, 'Customer_Type_New__c'), TYPES, TYPE_FIX, 'customer type')
    c['deal_value'] = money(v(r, 'Estimated_Gross_Deal_Value__c'))
    c['mailing_address'] = join(v(r, 'Street'), v(r, 'City'), f"{v(r, 'State')} {v(r, 'PostalCode')}".strip())
    notes = []
    if v(r, 'Location__c'):
        notes.append(f"Location: {v(r, 'Location__c')}")
    if v(r, 'City__c'):
        notes.append(f"Area: {v(r, 'City__c')}")
    if v(r, 'Description'):
        notes.append(v(r, 'Description'))
    c['notes'] = '\n'.join(notes)
    if v(r, 'Follow_Up__c') == 'True':
        c['follow_up_on'] = date.today().isoformat()
    hub[r['Id']] = c
    if v(r, 'ConvertedContactId'):
        alias[v(r, 'ConvertedContactId')] = r['Id']

    # Properties: the opportunity address fields, without repeats.
    owns = 'Seller' in c['customer_types'] or 'Buyer' not in c['customer_types']
    seen = set()
    for street, city, postal, state in [
        (v(r, 'Opportunity_Adress__Street__s'), v(r, 'Opportunity_Adress__City__s'), v(r, 'Opportunity_Adress__PostalCode__s'), v(r, 'Opportunity_Adress__StateCode__s')),
        (v(r, 'Opportunity_Address_Street__c'), v(r, 'Opportunity_Address_City__c'), v(r, 'Opportunity_Address_Zip_Postal_Code__c'), v(r, 'Opportunity_Address_State_Province__c')),
        (v(r, 'Opportunity_Address_2__Street__s'), v(r, 'Opportunity_Address_2__City__s'), v(r, 'Opportunity_Address_2__PostalCode__s'), v(r, 'Opportunity_Address_2__StateCode__s')),
        (v(r, 'Opportunity_Address_3__Street__s'), v(r, 'Opportunity_Address_3__City__s'), v(r, 'Opportunity_Address_3__PostalCode__s'), v(r, 'Opportunity_Address_3__StateCode__s')),
        (v(r, 'Opportunity_Address_4__Street__s'), v(r, 'Opportunity_Address_4__City__s'), v(r, 'Opportunity_Address_4__PostalCode__s'), v(r, 'Opportunity_Address_4__StateCode__s')),
    ]:
        key = re.sub(r'\W+', ' ', f'{street} {city}').strip().lower()
        if not street or key in seen:
            continue
        seen.add(key)
        hit, how = locate(street, city, postal, state)
        label = join(street, city)
        if hit and not (41.5 < hit['lat'] < 46.5 and -83.5 < hit['lng'] < -76):
            # Same street name elsewhere in Canada: a wrong pin is worse than none.
            report['matched outside southern Ontario (place by hand)'].append(f"{c['id']}: {label}")
            continue
        if not hit:
            report['not found on the map'].append(f"{c['id']}: {label}")
            continue
        if hit.get('type') in ROAD_TYPES:
            # OpenStreetMap knew the road but not the house number: the pin is somewhere along the road.
            report['placed on the road, not the exact address (check the pin)'].append(f"{c['id']}: {label}")
        elif how != 'full':
            report['placed from street and town only (check the pin)'].append(f"{c['id']}: {label}")
        props.append({'id': f"{c['id']}-{len(seen)}", 'contact_id': c['id'], 'address': label, 'lat': hit['lat'], 'lng': hit['lng'],
                      'category': (c['categories'] or ['Investment Property'])[0], 'relation': 'Owns' if owns else 'Interested in'})

# Staging leads -> prospects with implied (published) consent
for r in leads_st:
    c = base(r, r['Id'], 'Staging', True)
    c['company'] = company(v(r, 'Company'))
    c['status'] = v(r, 'Status') if v(r, 'Status') in STATUSES else 'Prospect'
    c['mailing_address'] = join(v(r, 'Street'), v(r, 'City'), f"{v(r, 'State')} {v(r, 'PostalCode')}".strip())
    c['notes'] = v(r, 'Description')
    if c['email']:
        c['email_consent'] = 'implied'
        c['consent_date'] = (v(r, 'CreatedDate') or date.today().isoformat())[:10]
        c['consent_source'] = 'Published business contact (municipal tender)'
    hub[r['Id']] = c

# Contacts -> other contacts, unless they are the same person as a lead
lead_by_email = {c['email']: sid for sid, c in hub.items() if c['email']}
for r in contacts_sf:
    same = alias.get(r['Id']) or lead_by_email.get(v(r, 'Email').lower())
    if same:
        alias[r['Id']] = same
        lead = hub[same]
        extra = [p for p in (v(r, 'Phone'), v(r, 'MobilePhone'), v(r, 'HomePhone')) if p and re.sub(r'\D', '', p)[-10:] not in
                 {re.sub(r'\D', '', lead['phone'])[-10:], re.sub(r'\D', '', lead['phone_2'])[-10:]}]
        if extra and not lead['phone_2']:
            lead['phone_2'] = extra[0]
        for t in tags.get(r['Id'], []):
            if t not in lead['campaigns']:
                lead['campaigns'].append(t)
        report['contacts merged into their lead'].append(f"SF-{r['Id']} → {lead['id']}")
        continue
    c = base(r, r['Id'], 'Real Estate', False)
    acct = accounts.get(v(r, 'AccountId'))
    c['company'] = company(acct['Name']) if acct else 'tbd'
    c['phone_2'] = v(r, 'MobilePhone') or v(r, 'HomePhone')
    c['mailing_address'] = join(v(r, 'MailingStreet'), v(r, 'MailingCity'), f"{v(r, 'MailingState')} {v(r, 'MailingPostalCode')}".strip())
    c['notes'] = v(r, 'Description')
    hub[r['Id']] = c

def target(sid):
    sid = alias.get(sid, sid)
    return hub.get(sid)

# Tasks -> activity notes; earliest open due date -> follow-up
activities = []
for t in tasks:
    c = target(v(t, 'WhoId'))
    if not c:
        report['tasks not linked to a lead or contact (skipped)'].append(f"{t['Id']}: {v(t, 'Subject')[:60]}")
        continue
    due = v(t, 'ActivityDate')
    body = f"Salesforce task: {v(t, 'Subject')}" + (f" (due {due}, {v(t, 'Status')})" if due else f" ({v(t, 'Status')})")
    if v(t, 'Description'):
        body += f"\n{v(t, 'Description')}"
    activities.append({'contact_id': c['id'], 'kind': 'call' if v(t, 'TaskSubtype') == 'Call' else 'note', 'body': body,
                       'occurred_at': v(t, 'CompletedDateTime') or v(t, 'CreatedDate')})
    if v(t, 'IsClosed') == 'False' and due and (not c['follow_up_on'] or due < c['follow_up_on']):
        c['follow_up_on'] = due

# Opportunities -> notes and deal value
for o in opps:
    c = target(v(o, 'ContactId'))
    if not c:
        report['opportunities without a matching person (skipped)'].append(f"{o['Id']}: {v(o, 'Name')[:60]}")
        continue
    amount = money(v(o, 'Amount'))
    if amount and not c['deal_value']:
        c['deal_value'] = amount
    activities.append({'contact_id': c['id'], 'kind': 'note', 'occurred_at': v(o, 'CreatedDate'),
                       'body': f"Salesforce opportunity: {v(o, 'Name')} · {v(o, 'StageName')} · close {v(o, 'CloseDate')}"
                               + (f" · ${amount:,.0f}" if amount else '') + (f"\n{v(o, 'Description')}" if v(o, 'Description') else '')})

# ---------------------------------------------------------------- SQL
def q(x):
    if x is None:
        return 'null'
    if isinstance(x, bool):
        return 'true' if x else 'false'
    if isinstance(x, (int, float)):
        return repr(x)
    if isinstance(x, list):
        return 'array[' + ', '.join(q(i) for i in x) + ']::text[]' if x else "'{}'::text[]"
    return "'" + str(x).replace("'", "''") + "'"

cols = ['id', 'business', 'is_prospect', 'first_name', 'last_name', 'company', 'title', 'phone', 'phone_2', 'email', 'website',
        'mailing_address', 'status', 'lead_source', 'regions', 'categories', 'customer_types', 'deal_value', 'follow_up_on',
        'assigned_to', 'campaigns', 'notes', 'email_consent', 'consent_date', 'consent_source', 'consent_expires_on', 'created_at']
lines = ['-- Generated by scripts/import-salesforce.py. Contains client personal information: do not commit.', 'begin;',
         "-- Remove the fictional sample data.",
         "delete from public.contacts where id ~ '^[LC][0-9]{4}$';",
         "delete from public.activities where contact_id not in (select id from public.contacts);"]
for c in hub.values():
    lines.append(f"insert into public.contacts ({', '.join(cols)}) values ({', '.join(q(c.get(k)) for k in cols)}) on conflict (id) do nothing;")
for p in props:
    lines.append("insert into public.properties (id, contact_id, address, lat, lng, category, relation) values "
                 f"({q(p['id'])}, {q(p['contact_id'])}, {q(p['address'])}, {p['lat']}, {p['lng']}, {q(p['category'])}, {q(p['relation'])}) on conflict (id) do nothing;")
lines.append("-- The import itself isn't team activity: drop the automatic 'created' entries it produced.")
lines.append("delete from public.activities where kind = 'created' and created_by is null and contact_id like 'SF-%';")
for a in activities:
    lines.append("insert into public.activities (contact_id, kind, body, occurred_at) values "
                 f"({q(a['contact_id'])}, {q(a['kind'])}, {q(a['body'])}, {q(a['occurred_at'] or None)});")
lines.append('commit;')
(OUT / 'import.sql').write_text('\n'.join(lines) + '\n')

# ---------------------------------------------------------------- report (counts and IDs only)
by = Counter((c['business'], c['is_prospect']) for c in hub.values())
rep = ['# Salesforce import: dry run', '',
       f"- Real Estate prospects: **{by[('Real Estate', True)]}**",
       f"- Staging prospects: **{by[('Staging', True)]}**",
       f"- Other contacts: **{by[('Real Estate', False)]}**",
       f"- Properties placed on the map: **{len(props)}**",
       f"- Activity notes (tasks and opportunities): **{len(activities)}**",
       f"- With a follow-up date: **{sum(1 for c in hub.values() if c['follow_up_on'])}**",
       f"- Can receive marketing email (implied consent): **{sum(1 for c in hub.values() if c['email_consent'] != 'none')}**",
       f"- With an email address: **{sum(1 for c in hub.values() if c['email'])}**, with a phone: **{sum(1 for c in hub.values() if c['phone'])}**", '']
dups = [e for e, n in Counter(c['email'] for c in hub.values() if c['email']).items() if n > 1]
rep.append(f"- Email addresses shared by more than one record: **{len(dups)}** (both kept; Hub flags duplicates when editing)")
for field, counter in unknown.items():
    rep.append(f"- Unrecognised {field} values dropped: {dict(counter)}")
for title, items in report.items():
    rep += ['', f'## {title.capitalize()} ({len(items)})', ''] + [f'- {i}' for i in items[:300]]
(OUT / 'report.md').write_text('\n'.join(rep) + '\n')
print('\n'.join(rep[:14]))
print(f"\nWrote {OUT / 'import.sql'} and {OUT / 'report.md'}")
