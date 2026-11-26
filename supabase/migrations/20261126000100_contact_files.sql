-- Files (PDFs, photos, documents…) attached to contacts and prospects.
-- The files themselves are in a private Storage bucket; this table says which contact each belongs to.

------------------------------------------------------------------------------------------------
-- Storage bucket: private, 50 MB per file (the project's upload limit)
------------------------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('contact-files', 'contact-files', false, 52428800)
on conflict (id) do nothing;

-- Files are stored as <contact id>/<random id>-<file name>.
create policy "Signed-in users can read contact files" on storage.objects
  for select to authenticated using (bucket_id = 'contact-files');
create policy "Signed-in users can upload contact files" on storage.objects
  for insert to authenticated with check (bucket_id = 'contact-files');
create policy "Uploaders and admins can delete contact files" on storage.objects
  for delete to authenticated using (bucket_id = 'contact-files' and (owner_id = auth.uid()::text or public.is_admin()));

------------------------------------------------------------------------------------------------
-- Which contact each file belongs to
------------------------------------------------------------------------------------------------
create table public.contact_files (
  id          uuid primary key default gen_random_uuid(),
  contact_id  text not null references public.contacts (id) on delete cascade,
  path        text not null unique,
  name        text not null check (length(trim(name)) > 0),
  size        bigint not null default 0,
  mime_type   text not null default '',
  uploaded_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now()
);
create index contact_files_contact_idx on public.contact_files (contact_id, created_at desc);

alter table public.contact_files enable row level security;
revoke all on public.contact_files from anon, authenticated;
grant select, insert, delete on public.contact_files to authenticated;
grant update (name) on public.contact_files to authenticated;
create policy "Signed-in users can see contact files" on public.contact_files
  for select to authenticated using (true);
create policy "Signed-in users can attach files" on public.contact_files
  for insert to authenticated with check (uploaded_by = auth.uid());
create policy "Uploaders and admins can rename files" on public.contact_files
  for update to authenticated using (uploaded_by = auth.uid() or public.is_admin()) with check (true);
create policy "Uploaders and admins can remove files" on public.contact_files
  for delete to authenticated using (uploaded_by = auth.uid() or public.is_admin());

------------------------------------------------------------------------------------------------
-- Note attaching and removing files on the contact's timeline (and so in the daily summary)
------------------------------------------------------------------------------------------------
alter table public.activities drop constraint activities_kind_check;
alter table public.activities add constraint activities_kind_check check (kind in (
  'note', 'call', 'email', 'meeting', 'status_change', 'follow_up_done', 'created', 'archived', 'restored',
  'campaign_sent', 'unsubscribed', 'bounced', 'campaign_stage', 'match_added', 'file_added', 'file_removed'
));

create function public.log_contact_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities (contact_id, kind, body, created_by) values (new.contact_id, 'file_added', new.name, auth.uid());
    return new;
  end if;
  -- Not when the whole contact is being deleted.
  if exists (select 1 from public.contacts where id = old.contact_id) then
    insert into public.activities (contact_id, kind, body, created_by) values (old.contact_id, 'file_removed', old.name, auth.uid());
  end if;
  return old;
end;
$$;

create trigger contact_files_log after insert or delete on public.contact_files
  for each row execute function public.log_contact_file();
