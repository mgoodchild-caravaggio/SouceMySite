-- Calendar and email, step 1 (docs/PLAN-calendar-email.md): email consent (CASL), a permanent
-- do-not-email list, and each person's Outlook connection for Microsoft Graph.

------------------------------------------------------------------------------------------------
-- Email consent on contacts
------------------------------------------------------------------------------------------------
alter table public.contacts
  add column email_consent      text not null default 'none' check (email_consent in ('express', 'implied', 'none')),
  add column consent_date       date,
  add column consent_source     text not null default '',
  -- Implied consent lapses (2 years after a deal, 6 months after an inquiry); express consent has no end date.
  add column consent_expires_on date,
  add column unsubscribed_at    timestamptz;

grant update (email_consent, consent_date, consent_source, consent_expires_on, unsubscribed_at)
  on public.contacts to authenticated;

------------------------------------------------------------------------------------------------
-- Do-not-email list: addresses Hub must never send marketing to again
------------------------------------------------------------------------------------------------
create table public.email_suppressions (
  email      text primary key check (email = lower(email)),
  reason     text not null check (reason in ('unsubscribed', 'bounced', 'complained', 'manual')),
  contact_id text references public.contacts (id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null default auth.uid()
);

alter table public.email_suppressions enable row level security;
revoke all on public.email_suppressions from anon, authenticated;
grant select, insert on public.email_suppressions to authenticated;
grant delete on public.email_suppressions to authenticated;
create policy "Signed-in users can see the do-not-email list" on public.email_suppressions
  for select to authenticated using (true);
create policy "Signed-in users can add to the do-not-email list" on public.email_suppressions
  for insert to authenticated with check (true);
create policy "Admins can remove from the do-not-email list" on public.email_suppressions
  for delete to authenticated using (public.is_admin());

-- Marking a contact unsubscribed adds their address to the list (and logs it).
create function public.suppress_unsubscribed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unsubscribed_at is not null and old.unsubscribed_at is null and coalesce(new.email, '') <> '' then
    insert into public.email_suppressions (email, reason, contact_id, created_by)
    values (lower(new.email), 'unsubscribed', new.id, auth.uid())
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

create trigger contacts_suppress_unsubscribed after update of unsubscribed_at on public.contacts
  for each row execute function public.suppress_unsubscribed();

-- Whether a contact may receive marketing email today. Used by campaigns and sequences later.
create function public.can_email_marketing(c public.contacts) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(c.email, '') <> ''
     and c.unsubscribed_at is null
     and c.archived_at is null
     and c.email_consent in ('express', 'implied')
     and (c.consent_expires_on is null or c.consent_expires_on >= current_date)
     and not exists (select 1 from public.email_suppressions s where s.email = lower(c.email));
$$;

------------------------------------------------------------------------------------------------
-- Outlook connections: one per person. Only the server functions (service role) can read tokens.
------------------------------------------------------------------------------------------------
create table public.outlook_connections (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  mailbox        text not null,
  display_name   text not null default '',
  -- AES-GCM encrypted by the Edge Functions; the key is a function secret, never in the database.
  refresh_token  text not null,
  scopes         text not null default '',
  connected_at   timestamptz not null default now(),
  last_used_at   timestamptz,
  last_error     text
);

alter table public.outlook_connections enable row level security;
revoke all on public.outlook_connections from anon, authenticated;
-- No policies: browsers can't read this table at all. The app asks for its status through
-- outlook_status() below, which never returns the token.

create function public.outlook_status()
returns table (user_id uuid, mailbox text, connected_at timestamptz, last_error text)
language sql stable security definer set search_path = '' as $$
  select user_id, mailbox, connected_at, last_error from public.outlook_connections;
$$;

revoke all on function public.outlook_status() from public, anon;
grant execute on function public.outlook_status() to authenticated;
