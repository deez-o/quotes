-- Float charge: moving the paver and roller to site. A cost (per move), spread into the asphalt
-- rate on the quote, never its own line for the customer.
alter table public.cost_items drop constraint if exists cost_items_category_check;
alter table public.cost_items add constraint cost_items_category_check
  check (category in ('crew', 'material', 'plant', 'truck', 'float', 'other'));
