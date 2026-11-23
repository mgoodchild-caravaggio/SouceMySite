-- Matches added by hand: "this buyer is a fit for this listing", whatever the matching engine says.
-- A row links an opportunity to a contact, and optionally to one of that contact's own listings or
-- requirements, so the match shows from both sides.

create table public.opportunity_matches (
  id                   uuid primary key default gen_random_uuid(),
  opportunity_id       uuid not null references public.opportunities (id) on delete cascade,
  contact_id           text not null references public.contacts (id) on delete cascade,
  other_opportunity_id uuid references public.opportunities (id) on delete set null,
  note                 text not null default '',
  created_by           uuid references auth.users (id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (opportunity_id, contact_id)
);

create index opportunity_matches_other_idx on public.opportunity_matches (other_opportunity_id) where other_opportunity_id is not null;
create index opportunity_matches_contact_idx on public.opportunity_matches (contact_id);

alter table public.opportunity_matches enable row level security;
revoke all on public.opportunity_matches from anon, authenticated;
grant select, insert, delete on public.opportunity_matches to authenticated;
grant update (note, other_opportunity_id) on public.opportunity_matches to authenticated;
create policy "Everyone can see matches" on public.opportunity_matches for select to authenticated using (true);
create policy "Anyone can add a match" on public.opportunity_matches for insert to authenticated with check (created_by = auth.uid());
create policy "Anyone can edit a match" on public.opportunity_matches for update to authenticated using (true) with check (true);
create policy "Anyone can remove a match" on public.opportunity_matches for delete to authenticated using (true);

-- Note it on the matched contact's timeline, so it's there when you next call them.
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in (
  'note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored',
  'campaign_sent', 'unsubscribed', 'bounced', 'campaign_stage', 'match_added'
));

create function public.log_manual_match() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  owner_name text;
begin
  select title, contact_id into o from public.opportunities where id = new.opportunity_id;
  select trim(first_name || ' ' || last_name) into owner_name from public.contacts where id = o.contact_id;
  insert into public.activities (contact_id, kind, body, created_by)
  values (new.contact_id, 'match_added',
          format('Matched by hand with “%s” (%s)', o.title, coalesce(nullif(owner_name, ''), 'another contact'))
            || case when new.note <> '' then ': ' || new.note else '' end,
          auth.uid());
  return new;
end;
$$;
revoke execute on function public.log_manual_match() from public, anon, authenticated;

create trigger opportunity_matches_log after insert on public.opportunity_matches
  for each row execute function public.log_manual_match();
