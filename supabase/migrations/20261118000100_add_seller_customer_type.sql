-- Add "Seller" back to the allowed customer types (it was left out of the list by mistake).
alter table public.prospects
  drop constraint prospects_customer_types_check,
  add constraint prospects_customer_types_check check (
    customer_types <@ array[
      'Buyer', 'Seller', 'Builder/Developer', 'Investor', 'Past Client',
      'Agricultural', 'Finance/Lender', 'Referral Source', 'Infrastructure'
    ]::text[]
  );
