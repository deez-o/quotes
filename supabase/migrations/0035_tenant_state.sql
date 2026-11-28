-- Which state the company works in: sets the usual mixes a new plant starts with.
alter table public.tenant_settings add column if not exists state text check (state is null or state in ('QLD','NSW','VIC','SA','WA','TAS','NT','ACT'));
