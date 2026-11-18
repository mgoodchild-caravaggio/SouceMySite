-- Email step 4: marketing campaigns sent through Resend, with per-recipient tracking.

------------------------------------------------------------------------------------------------
-- Brokerage details for the footer CASL requires on every marketing email (one row).
------------------------------------------------------------------------------------------------
create table public.org_settings (
  id              boolean primary key default true check (id),
  brokerage_name  text not null default '',
  mailing_address text not null default '',
  contact_line    text not null default '', -- phone, email or website
  updated_at      timestamptz not null default now()
);
insert into public.org_settings (id) values (true);

alter table public.org_settings enable row level security;
revoke all on public.org_settings from anon, authenticated;
grant select on public.org_settings to authenticated;
grant update (brokerage_name, mailing_address, contact_line) on public.org_settings to authenticated;
create policy "Everyone can read the brokerage details" on public.org_settings for select to authenticated using (true);
create policy "Admins can change the brokerage details" on public.org_settings for update to authenticated using (public.is_admin()) with check (true);

------------------------------------------------------------------------------------------------
-- Campaigns. Anyone can draft; only admins can send (enforced by the campaign-send function).
------------------------------------------------------------------------------------------------
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  business      text not null default 'Real Estate' check (business in ('Real Estate', 'Staging')),
  name          text not null check (length(trim(name)) > 0),
  subject       text not null default '',
  body          text not null default '',
  -- The person the email comes from (their name and @caravaggiorealestate.ca address); replies go to them.
  sender_id     uuid references public.profiles (id) on delete set null,
  -- The list filters used to pick the audience, so a draft reopens with the same audience.
  audience      jsonb not null default '{}',
  status        text not null default 'draft' check (status in ('draft', 'scheduled', 'sending', 'sent', 'cancelled')),
  scheduled_for timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_by    uuid references auth.users (id) on delete set null default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger campaigns_touch before update on public.campaigns
  for each row execute function public.touch_template();

alter table public.campaigns enable row level security;
revoke all on public.campaigns from anon, authenticated;
grant select, insert, delete on public.campaigns to authenticated;
grant update (name, subject, body, sender_id, audience, business) on public.campaigns to authenticated;
create policy "Everyone can see campaigns" on public.campaigns for select to authenticated using (true);
create policy "Anyone can start a draft" on public.campaigns for insert to authenticated with check (created_by = auth.uid() and status = 'draft');
create policy "Drafts can be edited by their author or an admin" on public.campaigns for update to authenticated
  using (status = 'draft' and (created_by = auth.uid() or public.is_admin())) with check (status = 'draft');
create policy "Drafts can be deleted by their author or an admin" on public.campaigns for delete to authenticated
  using (status = 'draft' and (created_by = auth.uid() or public.is_admin()));

------------------------------------------------------------------------------------------------
-- One row per recipient. Written only by the server functions.
------------------------------------------------------------------------------------------------
create table public.campaign_sends (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns (id) on delete cascade,
  contact_id      text references public.contacts (id) on delete set null,
  email           text not null,
  status          text not null default 'queued'
                  check (status in ('queued', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'skipped')),
  error           text,
  resend_id       text,
  -- Secret token in the unsubscribe link, so it only works for this recipient.
  unsub_token     uuid not null default gen_random_uuid(),
  sent_at         timestamptz,
  delivered_at    timestamptz,
  opened_at       timestamptz,
  clicked_at      timestamptz,
  bounced_at      timestamptz,
  unsubscribed_at timestamptz,
  unique (campaign_id, email)
);

create index campaign_sends_campaign_idx on public.campaign_sends (campaign_id, status);
create unique index campaign_sends_resend_idx on public.campaign_sends (resend_id) where resend_id is not null;
create unique index campaign_sends_token_idx on public.campaign_sends (unsub_token);

alter table public.campaign_sends enable row level security;
revoke all on public.campaign_sends from anon, authenticated;
-- Everyone can see results, but never the unsubscribe tokens.
grant select (id, campaign_id, contact_id, email, status, error, sent_at, delivered_at, opened_at, clicked_at, bounced_at, unsubscribed_at)
  on public.campaign_sends to authenticated;
create policy "Everyone can see campaign results" on public.campaign_sends for select to authenticated using (true);

-- Totals per campaign for the list and results views.
create view public.campaign_stats with (security_invoker = true) as
  select campaign_id,
         count(*)                                                    as recipients,
         count(*) filter (where status = 'queued')                   as queued,
         count(*) filter (where status in ('sent', 'delivered'))     as sent,
         count(*) filter (where status = 'delivered')                as delivered,
         count(*) filter (where opened_at is not null)               as opened,
         count(*) filter (where clicked_at is not null)              as clicked,
         count(*) filter (where status = 'bounced')                  as bounced,
         count(*) filter (where status in ('failed', 'skipped'))     as failed,
         count(*) filter (where unsubscribed_at is not null)         as unsubscribed
  from public.campaign_sends
  group by campaign_id;
grant select on public.campaign_stats to authenticated;

------------------------------------------------------------------------------------------------
-- Activity kinds for campaign events on a contact's timeline.
------------------------------------------------------------------------------------------------
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in (
  'note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored',
  'campaign_sent', 'unsubscribed', 'bounced'
));
