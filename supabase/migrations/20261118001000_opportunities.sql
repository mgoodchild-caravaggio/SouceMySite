-- Matching step 1 (docs/PLAN-matching.md): opportunities.
--   listing     = a property being shopped (Listed under a Caravaggio agreement, or Off-market)
--   requirement = what a buyer, investor or builder/developer is looking for

create table public.opportunities (
  id                 uuid primary key default gen_random_uuid(),
  contact_id         text not null references public.contacts (id) on delete cascade,
  kind               text not null check (kind in ('listing', 'requirement')),
  listing_type       text check (listing_type in ('listed', 'off_market')),
  property_id        text references public.properties (id) on delete set null,
  title              text not null default '',
  status             text not null default 'open'
                     check (status in ('open', 'under_offer', 'sold', 'withdrawn', 'matched', 'closed', 'dropped')),
  categories         text[] not null default '{}',
  acres_min          numeric check (acres_min is null or acres_min >= 0),
  acres_max          numeric check (acres_max is null or acres_max >= 0),
  -- Listing: asking price in price_min (price_max unused). Requirement: budget range.
  price_min          numeric check (price_min is null or price_min >= 0),
  price_max          numeric check (price_max is null or price_max >= 0),
  -- Zoning / Official Plan designations: what a listing has, or what a requirement wants.
  zoning             text[] not null default '{}',
  -- Listing: water/sewer servicing. Requirement: 'available' means "needs servicing".
  servicing          text not null default 'unknown' check (servicing in ('available', 'planned', 'none', 'unknown')),
  -- Listing: when the seller wants to sell. Requirement: when the buyer wants to close.
  target_date        date,
  assembly_wanted    boolean not null default false,
  assembly_min_acres numeric check (assembly_min_acres is null or assembly_min_acres >= 0),
  -- Where a requirement is looking: a centre and radius, and/or regions. Listings use their property's pin.
  area_lat           double precision,
  area_lng           double precision,
  area_radius_km     numeric check (area_radius_km is null or area_radius_km > 0),
  regions            text[] not null default '{}',
  -- Drafts created from old category/region tags until someone fills in the details.
  needs_detail       boolean not null default false,
  notes              text not null default '',
  created_by         uuid references auth.users (id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (kind = 'listing' or listing_type is null),
  check (acres_min is null or acres_max is null or acres_min <= acres_max),
  check (price_min is null or price_max is null or price_min <= price_max),
  check ((kind = 'listing' and status in ('open', 'under_offer', 'sold', 'withdrawn'))
      or (kind = 'requirement' and status in ('open', 'matched', 'closed', 'dropped'))),
  check (categories <@ array[
    'Industrial Land', 'Residential Land', 'Industrial Building', 'Residential', 'Agricultural',
    'White Belt', 'Expansion Boundary', 'Investment Property', 'Urban Boundary', 'Condo Land'
  ]::text[])
);

create index opportunities_contact_idx on public.opportunities (contact_id);
create index opportunities_open_idx on public.opportunities (kind) where status = 'open';

create trigger opportunities_touch before update on public.opportunities
  for each row execute function public.touch_template();

alter table public.opportunities enable row level security;
revoke all on public.opportunities from anon, authenticated;
grant select, insert, update, delete on public.opportunities to authenticated;
create policy "Signed-in users manage opportunities" on public.opportunities
  for all to authenticated using (true) with check (true);

-- Draft requirements for today's buyers, from their category and region tags, flagged "needs detail".
insert into public.opportunities (contact_id, kind, title, categories, regions, needs_detail, notes, created_by)
select c.id, 'requirement',
       'Looking for ' || coalesce(nullif(array_to_string(c.categories, ' / '), ''), 'land'),
       c.categories, c.regions, true,
       'Drafted from Salesforce tags. Add acres, budget, area and timing.', null
from public.contacts c
where c.business = 'Real Estate' and c.is_prospect and c.archived_at is null
  and 'Buyer' = any(c.customer_types)
  and not exists (select 1 from public.opportunities o where o.contact_id = c.id and o.kind = 'requirement');
