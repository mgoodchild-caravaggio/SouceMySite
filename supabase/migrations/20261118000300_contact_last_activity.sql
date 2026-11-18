-- Latest activity per contact, for the "Last activity" column in the lists.
-- security_invoker makes the view follow the activities table's access rules.
create view public.contact_last_activity with (security_invoker = true) as
  select contact_id, max(occurred_at) as last_activity_at
  from public.activities
  group by contact_id;

revoke all on public.contact_last_activity from anon, authenticated;
grant select on public.contact_last_activity to authenticated;
