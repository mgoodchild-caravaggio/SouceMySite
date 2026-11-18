-- Salesforce import: categories and regions used in Caravaggio's existing data.
-- Categories "Urban Boundary" and "Condo Land" come back; regions add Niagara, Wellington and Grey Bruce.
alter table public.contacts drop constraint contacts_categories_check,
  add constraint contacts_categories_check check (
    categories <@ array[
      'Industrial Land', 'Residential Land', 'Industrial Building', 'Residential', 'Agricultural',
      'White Belt', 'Expansion Boundary', 'Investment Property', 'Urban Boundary', 'Condo Land'
    ]::text[]
  );

alter table public.properties drop constraint properties_category_check,
  add constraint properties_category_check check (category in (
    'Industrial Land', 'Residential Land', 'Industrial Building', 'Residential', 'Agricultural',
    'White Belt', 'Expansion Boundary', 'Investment Property', 'Urban Boundary', 'Condo Land'
  ));
