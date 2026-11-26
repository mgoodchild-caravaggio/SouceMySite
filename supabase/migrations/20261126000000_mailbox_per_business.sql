-- Real Estate and Staging use different Microsoft 365 mailboxes (different domains).
-- Each person can connect one mailbox per business; meetings remember which mailbox holds them;
-- campaign footers, sending domains and signatures are kept per business.

------------------------------------------------------------------------------------------------
-- Outlook connections: one per person per business
------------------------------------------------------------------------------------------------
alter table public.outlook_connections
  add column business text not null default 'Real Estate' check (business in ('Real Estate', 'Staging'));
alter table public.outlook_connections drop constraint outlook_connections_pkey;
alter table public.outlook_connections add primary key (user_id, business);

drop function public.outlook_status();
create function public.outlook_status()
returns table (user_id uuid, business text, mailbox text, connected_at timestamptz, last_error text)
language sql stable security definer set search_path = '' as $$
  select user_id, business, mailbox, connected_at, last_error from public.outlook_connections;
$$;
revoke all on function public.outlook_status() from public, anon;
grant execute on function public.outlook_status() to authenticated;

------------------------------------------------------------------------------------------------
-- Meetings: which business's mailbox the Outlook event lives in (all earlier ones: Real Estate)
------------------------------------------------------------------------------------------------
alter table public.meetings
  add column mailbox_business text not null default 'Real Estate' check (mailbox_business in ('Real Estate', 'Staging'));

------------------------------------------------------------------------------------------------
-- Campaign footer (CASL) and sending domain, per business
------------------------------------------------------------------------------------------------
alter table public.org_settings
  add column business text not null default 'Real Estate' check (business in ('Real Estate', 'Staging')),
  -- The domain campaigns are sent from; it must be verified with Resend.
  add column sending_domain text not null default '';
alter table public.org_settings drop constraint org_settings_pkey;
alter table public.org_settings drop column id;
alter table public.org_settings add primary key (business);
update public.org_settings set sending_domain = 'caravaggiorealestate.ca' where business = 'Real Estate';
insert into public.org_settings (business) values ('Staging');
grant update (sending_domain) on public.org_settings to authenticated;

------------------------------------------------------------------------------------------------
-- A separate signature for Staging emails
------------------------------------------------------------------------------------------------
alter table public.profiles add column signature_staging text not null default '';
grant update (signature_staging) on public.profiles to authenticated;
