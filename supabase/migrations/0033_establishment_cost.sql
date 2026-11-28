-- Establishment: a charge per set-up on site (each mobilisation). Its own rate in the costs library.
alter table public.cost_items drop constraint if exists cost_items_category_check;
alter table public.cost_items add constraint cost_items_category_check
  check (category in ('crew', 'material', 'plant', 'truck', 'float', 'establishment', 'other'));
