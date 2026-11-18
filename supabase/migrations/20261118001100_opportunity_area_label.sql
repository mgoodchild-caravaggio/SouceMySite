-- The place name for a requirement's search area ("Barrie"), so it reads "within 25 km of Barrie".
alter table public.opportunities add column area_label text not null default '';
