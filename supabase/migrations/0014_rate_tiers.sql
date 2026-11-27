-- Sliding-scale rates (e.g. seal per m² by job size): [{"up_to": 500, "rate": 9.5}, {"up_to": 2000, "rate": 7.2}].
-- The whole quantity is priced at the rate for its band; above the last break the item's normal rate applies.
alter table public.cost_items add column if not exists rate_tiers jsonb
  check (rate_tiers is null or jsonb_typeof(rate_tiers) = 'array');
