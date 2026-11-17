-- Prospects and the properties (map pins) tied to them.
-- Only signed-in users can read them, and they can change just status, follow-up and notes.

create table public.prospects (
  id             text primary key,
  first_name     text not null,
  last_name      text not null,
  -- "tbd" when the prospect is an individual with no company, matching the Salesforce convention.
  company        text not null default 'tbd',
  phone          text not null default '',
  email          text,
  status         text not null default 'Prospect'
                 check (status in ('Prospect', 'Contacted', 'Lead', 'Active Lead', 'Unqualified')),
  lead_source    text not null default '',
  regions        text[] not null default '{}',
  categories     text[] not null default '{}',
  customer_types text[] not null default '{}',
  deal_value     numeric,
  follow_up      boolean not null default false,
  campaigns      text[] not null default '{}',
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id) on delete set null default auth.uid()
);

create table public.properties (
  id          text primary key,
  prospect_id text not null references public.prospects (id) on delete cascade,
  address     text not null,
  lat         double precision not null,
  lng         double precision not null,
  acres       numeric,
  category    text not null,
  relation    text not null check (relation in ('Owns', 'Interested in'))
);

create index properties_prospect_id_idx on public.properties (prospect_id);

-- Keep updated_at / updated_by current on every edit.
create function public.touch_prospect() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger prospects_touch before update on public.prospects
  for each row execute function public.touch_prospect();

-- Access: nothing for anonymous visitors; signed-in users read everything and edit three fields.
alter table public.prospects enable row level security;
alter table public.properties enable row level security;

revoke all on public.prospects, public.properties from anon, authenticated;
grant select on public.prospects, public.properties to authenticated;
grant update (status, follow_up, notes) on public.prospects to authenticated;

create policy "Signed-in users can read prospects" on public.prospects
  for select to authenticated using (true);
create policy "Signed-in users can update prospects" on public.prospects
  for update to authenticated using (true) with check (true);
create policy "Signed-in users can read properties" on public.properties
  for select to authenticated using (true);
