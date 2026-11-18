-- Calendar step 2: meetings scheduled from Hub into Outlook. The server functions create, update
-- and cancel them (with the service role); everyone signed in can see them.

create table public.meetings (
  id               uuid primary key default gen_random_uuid(),
  contact_id       text not null references public.contacts (id) on delete cascade,
  organizer_id     uuid references auth.users (id) on delete set null,
  outlook_event_id text,
  kind             text not null check (kind in ('call', 'meeting', 'site_visit')),
  subject          text not null,
  starts_at        timestamptz not null,
  ends_at          timestamptz not null check (ends_at > starts_at),
  location         text not null default '',
  property_id      text references public.properties (id) on delete set null,
  teams_url        text,
  web_link         text,
  -- Everyone invited, as email addresses (the contact and any teammates).
  attendees        text[] not null default '{}',
  status           text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  created_at       timestamptz not null default now()
);

create index meetings_contact_idx on public.meetings (contact_id, starts_at desc);
create index meetings_starts_idx on public.meetings (starts_at) where status = 'scheduled';
create unique index meetings_outlook_event_idx on public.meetings (outlook_event_id) where outlook_event_id is not null;

alter table public.meetings enable row level security;
revoke all on public.meetings from anon, authenticated;
grant select on public.meetings to authenticated;
create policy "Signed-in users can see meetings" on public.meetings for select to authenticated using (true);
