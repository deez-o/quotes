-- App-wide pricing defaults for every customer (each can change them in Setup).
alter table public.tenant_settings
  alter column default_binder set default 'C320',
  alter column default_prime set default 'K2',
  alter column spray_markup_percent set default 15,
  alter column extra_establishment_rate set default 5000;

-- Fill them in for existing customers who haven't set their own.
update public.tenant_settings set
  default_binder = coalesce(default_binder, 'C320'),
  default_prime = coalesce(default_prime, 'K2'),
  spray_markup_percent = coalesce(spray_markup_percent, 15),
  extra_establishment_rate = coalesce(extra_establishment_rate, 5000);
