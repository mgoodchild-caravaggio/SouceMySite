-- Only allow the agreed customer types and categories, so imported data can't drift.
-- To change a list: update src/types.ts and add a migration that replaces these constraints.

alter table public.prospects
  add constraint prospects_customer_types_check check (
    customer_types <@ array[
      'Buyer', 'Builder/Developer', 'Investor', 'Past Client',
      'Agricultural', 'Finance/Lender', 'Referral Source', 'Infrastructure'
    ]::text[]
  ),
  add constraint prospects_categories_check check (
    categories <@ array[
      'Industrial Land', 'Residential Land', 'Industrial Building', 'Residential',
      'Agricultural', 'White Belt', 'Expansion Boundary', 'Investment Property'
    ]::text[]
  );

alter table public.properties
  add constraint properties_category_check check (
    category in (
      'Industrial Land', 'Residential Land', 'Industrial Building', 'Residential',
      'Agricultural', 'White Belt', 'Expansion Boundary', 'Investment Property'
    )
  );
