-- Each company's own branding for the quotes they send: logo, colour and business details.
alter table public.tenant_settings
  add column if not exists logo_path        text,   -- in the job-files bucket, under the tenant's folder
  add column if not exists brand_color      text check (brand_color is null or brand_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists business_name    text,
  add column if not exists business_abn     text,
  add column if not exists business_phone   text,
  add column if not exists business_email   text,
  add column if not exists business_address text,
  add column if not exists business_website text;
