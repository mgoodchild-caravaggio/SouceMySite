-- Matching step 3: campaigns become an opportunity plus a worked list of members, each with a stage.
-- Email-only campaigns keep working unchanged (kind = 'email'); an email blast from a matching
-- campaign is an email campaign whose parent_id points at it.

alter table public.campaigns
  add column kind           text not null default 'email' check (kind in ('email', 'match')),
  add column opportunity_id uuid references public.opportunities (id) on delete set null,
  -- Find-matches criteria: list filters plus an optional map area ({ statuses, customerTypes, ... , area }).
  add column criteria       jsonb not null default '{}',
  add column parent_id      uuid references public.campaigns (id) on delete set null,
  add column match_status   text not null default 'active' check (match_status in ('active', 'closed'));

create index campaigns_parent_idx on public.campaigns (parent_id) where parent_id is not null;
create index campaigns_opportunity_idx on public.campaigns (opportunity_id) where opportunity_id is not null;

grant update (opportunity_id, criteria, match_status) on public.campaigns to authenticated;

-- A matching campaign is shared working space: anyone on the team can rename it, change its criteria
-- or close it. (Email campaigns stay editable only as drafts, by their author or an admin.)
create policy "Matching campaigns can be edited by anyone" on public.campaigns for update to authenticated
  using (kind = 'match') with check (kind = 'match');
-- ...and deleted by their author or an admin.
create policy "Matching campaigns can be deleted by their author or an admin" on public.campaigns for delete to authenticated
  using (kind = 'match' and (created_by = auth.uid() or public.is_admin()));

------------------------------------------------------------------------------------------------
-- Members: who's on the list, how they got there and where they are.
------------------------------------------------------------------------------------------------
create table public.campaign_members (
  id                uuid primary key default gen_random_uuid(),
  campaign_id       uuid not null references public.campaigns (id) on delete cascade,
  contact_id        text not null references public.contacts (id) on delete cascade,
  stage             text not null default 'shortlisted'
                    check (stage in ('suggested', 'shortlisted', 'contacted', 'interested', 'not_interested', 'offer')),
  score             int check (score between 0 and 100),
  -- [{ text, tone }] from the matching engine, as they were when the member was added.
  reasons           jsonb not null default '[]',
  source            text not null default 'manual' check (source in ('match', 'manual', 'map', 'contact', 'ai')),
  note              text not null default '',
  last_contacted_at timestamptz,
  assigned_to       uuid references public.profiles (id) on delete set null,
  added_by          uuid references auth.users (id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create index campaign_members_contact_idx on public.campaign_members (contact_id);

create trigger campaign_members_touch before update on public.campaign_members
  for each row execute function public.touch_template();

alter table public.campaign_members enable row level security;
revoke all on public.campaign_members from anon, authenticated;
grant select, insert, delete on public.campaign_members to authenticated;
grant update (stage, note, last_contacted_at, assigned_to, score, reasons) on public.campaign_members to authenticated;
create policy "Everyone can see members" on public.campaign_members for select to authenticated using (true);
create policy "Anyone can add members" on public.campaign_members for insert to authenticated
  with check (exists (select 1 from public.campaigns c where c.id = campaign_id and c.kind = 'match'));
create policy "Anyone can update members" on public.campaign_members for update to authenticated using (true) with check (true);
create policy "Anyone can remove members" on public.campaign_members for delete to authenticated using (true);

------------------------------------------------------------------------------------------------
-- Stage changes go on the contact's timeline, whoever makes them.
------------------------------------------------------------------------------------------------
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in (
  'note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored',
  'campaign_sent', 'unsubscribed', 'bounced', 'campaign_stage'
));

create function public.stage_label(s text) returns text
language sql immutable set search_path = '' as $$
  select case s
    when 'suggested' then 'Suggested' when 'shortlisted' then 'Shortlisted' when 'contacted' then 'Contacted'
    when 'interested' then 'Interested' when 'not_interested' then 'Not interested' when 'offer' then 'Offer / deal'
    else s end
$$;

create function public.log_campaign_member() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  camp text;
begin
  select name into camp from public.campaigns where id = new.campaign_id;
  if tg_op = 'INSERT' then
    -- AI suggestions aren't on the list until someone accepts them.
    if new.stage <> 'suggested' then
      insert into public.activities (contact_id, kind, body, created_by)
      values (new.contact_id, 'campaign_stage', format('Added to “%s” (%s)', camp, public.stage_label(new.stage)), auth.uid());
    end if;
  elsif new.stage is distinct from old.stage then
    insert into public.activities (contact_id, kind, body, created_by)
    values (new.contact_id, 'campaign_stage', format('“%s”: %s → %s', camp, public.stage_label(old.stage), public.stage_label(new.stage)), auth.uid());
  end if;
  return new;
end;
$$;
revoke execute on function public.log_campaign_member() from public, anon, authenticated;

create trigger campaign_members_log after insert or update of stage on public.campaign_members
  for each row execute function public.log_campaign_member();
