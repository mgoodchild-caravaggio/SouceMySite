-- Step 1 of the roadmap (docs/ROADMAP.md): one contact list, an activity log, user profiles with
-- roles, archiving instead of deleting, follow-up dates and assignment, and two businesses.

------------------------------------------------------------------------------------------------
-- Profiles: one per user, with a role. Admins can invite users and permanently delete contacts.
------------------------------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users (id) on delete cascade,
  email            text not null,
  display_name     text not null default '',
  role             text not null default 'member' check (role in ('admin', 'member')),
  -- The business shown in the sidebar switch, remembered per user.
  current_business text not null default 'Real Estate' check (current_business in ('Real Estate', 'Staging')),
  created_at       timestamptz not null default now()
);

-- Every new user (invited by email, or first Microsoft/Google sign-in of an invited email) gets a profile.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data ->> 'full_name', split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for users who already exist.
insert into public.profiles (id, email, display_name)
select id, coalesce(email, ''), split_part(coalesce(email, ''), '@', 1) from auth.users
on conflict (id) do nothing;

update public.profiles set role = 'admin', display_name = 'Matt Goodchild'
where email = 'mgoodchild@caravaggiorealestate.ca';

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
-- Users can rename themselves and change their business switch, but not their role.
grant update (display_name, current_business) on public.profiles to authenticated;

create policy "Signed-in users can see everyone's profile" on public.profiles
  for select to authenticated using (true);
create policy "Users can update their own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Roles are changed in the Supabase dashboard (or SQL) for now; the app has no role editor yet.

------------------------------------------------------------------------------------------------
-- Contacts: prospects become contacts; "is_prospect" marks the ones in the sales pipeline.
------------------------------------------------------------------------------------------------
alter table public.prospects rename to contacts;
alter table public.contacts rename constraint prospects_pkey to contacts_pkey;
alter table public.contacts rename constraint prospects_status_check to contacts_status_check;
alter table public.contacts rename constraint prospects_customer_types_check to contacts_customer_types_check;
alter table public.contacts rename constraint prospects_categories_check to contacts_categories_check;
alter table public.contacts rename constraint prospects_updated_by_fkey to contacts_updated_by_fkey;
alter trigger prospects_touch on public.contacts rename to contacts_touch;
alter table public.properties rename column prospect_id to contact_id;
alter index public.properties_prospect_id_idx rename to properties_contact_id_idx;

alter table public.contacts
  alter column id set default gen_random_uuid()::text,
  add column business        text not null default 'Real Estate' check (business in ('Real Estate', 'Staging')),
  add column is_prospect     boolean not null default true,
  add column title           text not null default '',
  add column phone_2         text not null default '',
  add column mailing_address text not null default '',
  add column website         text not null default '',
  add column follow_up_on    date,
  add column assigned_to     uuid references public.profiles (id) on delete set null,
  add column archived_at     timestamptz,
  add column archived_by     uuid references auth.users (id) on delete set null,
  add column created_by      uuid references auth.users (id) on delete set null default auth.uid();

-- The old yes/no follow-up flag becomes a date (today, for anything that was flagged).
update public.contacts set follow_up_on = current_date where follow_up;
alter table public.contacts drop column follow_up;

-- New contacts default to non-prospects only when the app says so; existing rows are all prospects.
alter table public.contacts alter column is_prospect set default false;

alter table public.properties alter column id set default gen_random_uuid()::text;

create index contacts_follow_up_on_idx on public.contacts (follow_up_on) where archived_at is null;
create index contacts_assigned_to_idx on public.contacts (assigned_to);

-- Keep the touch function's name in line with the table.
alter function public.touch_prospect() rename to touch_contact;

------------------------------------------------------------------------------------------------
-- Activities: notes, calls, emails, meetings and automatic entries for changes.
------------------------------------------------------------------------------------------------
create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  contact_id  text not null references public.contacts (id) on delete cascade,
  kind        text not null check (kind in ('note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored')),
  body        text not null default '',
  occurred_at timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);

create index activities_contact_id_idx on public.activities (contact_id, occurred_at desc);
create index activities_occurred_at_idx on public.activities (occurred_at desc);

-- Log creation, status changes and archive/restore automatically, whoever makes them.
create function public.log_contact_changes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities (contact_id, kind, body) values (new.id, 'created', '');
  elsif tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.activities (contact_id, kind, body)
      values (new.id, 'status_change', old.status || ' → ' || new.status);
    end if;
    if new.archived_at is not null and old.archived_at is null then
      insert into public.activities (contact_id, kind) values (new.id, 'archived');
    elsif new.archived_at is null and old.archived_at is not null then
      insert into public.activities (contact_id, kind) values (new.id, 'restored');
    end if;
  end if;
  return new;
end;
$$;

create trigger contacts_log_changes after insert or update on public.contacts
  for each row execute function public.log_contact_changes();

-- Record who archived a contact.
create function public.stamp_archive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  end if;
  return new;
end;
$$;

create trigger contacts_stamp_archive before update on public.contacts
  for each row execute function public.stamp_archive();

------------------------------------------------------------------------------------------------
-- Access rules
------------------------------------------------------------------------------------------------
-- Contacts: everyone signed in reads, adds and edits; only admins permanently delete, and only from the archive.
revoke all on public.contacts from anon, authenticated;
grant select, insert, delete on public.contacts to authenticated;
grant update (
  first_name, last_name, company, phone, phone_2, email, title, mailing_address, website,
  business, is_prospect, status, lead_source, regions, categories, customer_types, deal_value,
  campaigns, notes, follow_up_on, assigned_to, archived_at
) on public.contacts to authenticated;

drop policy "Signed-in users can read prospects" on public.contacts;
drop policy "Signed-in users can update prospects" on public.contacts;
create policy "Signed-in users can read contacts" on public.contacts
  for select to authenticated using (true);
create policy "Signed-in users can add contacts" on public.contacts
  for insert to authenticated with check (created_by = auth.uid());
create policy "Signed-in users can update contacts" on public.contacts
  for update to authenticated using (true) with check (true);
create policy "Admins can delete archived contacts" on public.contacts
  for delete to authenticated using (public.is_admin() and archived_at is not null);

-- Properties: everyone signed in manages them.
revoke all on public.properties from anon, authenticated;
grant select, insert, update, delete on public.properties to authenticated;
drop policy "Signed-in users can read properties" on public.properties;
create policy "Signed-in users can manage properties" on public.properties
  for all to authenticated using (true) with check (true);

-- Activities: everyone reads and adds; people can edit or remove only their own notes.
alter table public.activities enable row level security;
revoke all on public.activities from anon, authenticated;
grant select, insert, delete on public.activities to authenticated;
grant update (body, occurred_at) on public.activities to authenticated;
create policy "Signed-in users can read activities" on public.activities
  for select to authenticated using (true);
create policy "Signed-in users can add activities" on public.activities
  for insert to authenticated with check (created_by = auth.uid());
create policy "Users can edit their own activities" on public.activities
  for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "Users can delete their own activities" on public.activities
  for delete to authenticated using (created_by = auth.uid());
