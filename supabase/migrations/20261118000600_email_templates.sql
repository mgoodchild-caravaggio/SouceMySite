-- Email step 3: reusable email templates and a per-person email signature.

create table public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  subject    text not null default '',
  -- Plain text with merge fields such as {{first_name}}; line breaks are kept when sent.
  body       text not null default '',
  -- Shared templates are visible to the whole team; personal ones only to their owner.
  shared     boolean not null default true,
  owner_id   uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.touch_template() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger email_templates_touch before update on public.email_templates
  for each row execute function public.touch_template();

alter table public.email_templates enable row level security;
revoke all on public.email_templates from anon, authenticated;
grant select, insert, delete on public.email_templates to authenticated;
grant update (name, subject, body, shared) on public.email_templates to authenticated;

create policy "See shared templates and your own" on public.email_templates
  for select to authenticated using (shared or owner_id = auth.uid());
create policy "Add your own templates" on public.email_templates
  for insert to authenticated with check (owner_id = auth.uid());
create policy "Edit your own templates (admins: any shared one)" on public.email_templates
  for update to authenticated using (owner_id = auth.uid() or (shared and public.is_admin())) with check (true);
create policy "Delete your own templates (admins: any shared one)" on public.email_templates
  for delete to authenticated using (owner_id = auth.uid() or (shared and public.is_admin()));

-- A signature added to the end of emails each person sends from Hub (Outlook doesn't add it for us).
alter table public.profiles add column signature text not null default '';
grant update (signature) on public.profiles to authenticated;

-- Starter templates for the team to adapt.
insert into public.email_templates (name, subject, body, shared, owner_id) values
  ('Intro: land owner', 'Your property at {{property_address}}',
   E'Hi {{first_name}},\n\nI work with land owners in {{region}} and wanted to introduce myself. We''re seeing steady interest in properties like yours at {{property_address}}, and I''d be glad to share what similar parcels have been doing.\n\nWould you be open to a short call this week?', true, null),
  ('Follow-up after a call', 'Following up',
   E'Hi {{first_name}},\n\nThanks for taking the time to speak with me today. As promised, here''s a quick summary of next steps:\n\n- \n\nLet me know if anything changes on your side.', true, null),
  ('Site visit confirmation', 'Site visit at {{property_address}}',
   E'Hi {{first_name}},\n\nJust confirming our visit to {{property_address}}. If anything comes up before then, reply here or call me.\n\nLooking forward to it.', true, null);
