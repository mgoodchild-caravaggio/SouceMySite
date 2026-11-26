-- A research run is worked on by one request at a time.
alter table public.research_runs add column locked_until timestamptz;
