-- Tack coat as its own kind of material, and an optional fixed sell price per cost item
-- (e.g. tack coat costs $2/m², always goes on the quote at $3/m²).
alter table public.cost_items drop constraint if exists cost_items_material_kind_check;
alter table public.cost_items add constraint cost_items_material_kind_check
  check (material_kind in ('asphalt', 'base', 'prime', 'tack', 'seal', 'other'));
alter table public.cost_items add column if not exists sell_rate numeric check (sell_rate is null or sell_rate >= 0);
