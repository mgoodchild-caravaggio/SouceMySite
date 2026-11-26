-- Matching step 5: Ask Hub outside research (web search for builders/developers and municipal
-- development applications), reviewed as leads. Also: adding a property or a listing/requirement is
-- noted on the contact's timeline, so it counts in "Your day".

------------------------------------------------------------------------------------------------
-- Research runs: one request ("builders in Innisfil"), worked through in short steps by ai-research
------------------------------------------------------------------------------------------------
create table public.research_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('developers', 'applications')),
  area        text not null check (length(trim(area)) > 0),
  focus       text not null default '',
  status      text not null default 'running' check (status in ('running', 'done', 'failed')),
  summary     text not null default '',
  error       text,
  steps       int not null default 0,
  searches    int not null default 0,
  cost_usd    numeric(10, 5) not null default 0,
  -- The conversation with Claude so far (server only).
  messages    jsonb not null default '[]',
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  finished_at timestamptz
);
create index research_runs_created_idx on public.research_runs (created_at desc);

alter table public.research_runs enable row level security;
revoke all on public.research_runs from anon, authenticated;
-- Everything but the raw conversation.
grant select (id, kind, area, focus, status, summary, error, steps, searches, cost_usd, created_by, created_at, updated_at, finished_at)
  on public.research_runs to authenticated;
create policy "Signed-in users can see research" on public.research_runs for select to authenticated using (true);

------------------------------------------------------------------------------------------------
-- Findings: leads to review
------------------------------------------------------------------------------------------------
create table public.research_findings (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references public.research_runs (id) on delete cascade,
  kind          text not null check (kind in ('developer', 'application')),
  name          text not null,          -- company, or the application's title
  contact_name  text not null default '',
  role          text not null default '',
  website       text not null default '',
  phone         text not null default '',
  email         text not null default '',
  address       text not null default '',
  municipality  text not null default '',
  summary       text not null default '',
  app_status    text not null default '', -- e.g. "Draft plan approved, Oct 2026"
  file_number   text not null default '',
  source_url    text not null default '',
  source_title  text not null default '',
  -- Placed on the map by the browser when there's an address.
  lat           double precision,
  lng           double precision,
  state         text not null default 'new' check (state in ('new', 'added', 'dismissed')),
  contact_id    text references public.contacts (id) on delete set null,
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz,
  created_at    timestamptz not null default now()
);
create index research_findings_run_idx on public.research_findings (run_id);
create index research_findings_state_idx on public.research_findings (state, created_at desc);

alter table public.research_findings enable row level security;
revoke all on public.research_findings from anon, authenticated;
grant select on public.research_findings to authenticated;
grant update (lat, lng, state, contact_id, decided_by, decided_at) on public.research_findings to authenticated;
create policy "Signed-in users can see findings" on public.research_findings for select to authenticated using (true);
create policy "Signed-in users can review findings" on public.research_findings for update to authenticated using (true) with check (true);

------------------------------------------------------------------------------------------------
-- Timeline entries for new properties and listings/requirements (people's own edits only:
-- imports run without a signed-in user and stay quiet)
------------------------------------------------------------------------------------------------
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in (
  'note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored',
  'campaign_sent', 'unsubscribed', 'bounced', 'campaign_stage', 'match_added', 'file_added', 'file_removed',
  'property_added', 'opportunity_added'
));

create function public.log_property_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    insert into public.activities (contact_id, kind, body, created_by) values (new.contact_id, 'property_added', new.address, auth.uid());
  end if;
  return new;
end;
$$;
create trigger properties_log_added after insert on public.properties
  for each row execute function public.log_property_added();

create function public.log_opportunity_added() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    insert into public.activities (contact_id, kind, body, created_by)
    values (new.contact_id, 'opportunity_added', (case when new.kind = 'listing' then 'Listing: ' else 'Requirement: ' end) || new.title, auth.uid());
  end if;
  return new;
end;
$$;
create trigger opportunities_log_added after insert on public.opportunities
  for each row execute function public.log_opportunity_added();

-- Research spend counts toward Ask Hub's monthly cap: ai-research logs each step in ai_requests.
