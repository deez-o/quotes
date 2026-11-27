-- Crew (and hire) charged by the hour with overtime: ordinary hours a day at the rate,
-- then ot1_hours at ot1_multiplier (time and a half), then ot2_multiplier (double time).
alter table public.cost_items
  add column if not exists ordinary_hours numeric check (ordinary_hours > 0 and ordinary_hours <= 24),
  add column if not exists ot1_hours      numeric check (ot1_hours >= 0 and ot1_hours <= 24),
  add column if not exists ot1_multiplier numeric check (ot1_multiplier >= 1 and ot1_multiplier <= 5),
  add column if not exists ot2_multiplier numeric check (ot2_multiplier >= 1 and ot2_multiplier <= 5);
