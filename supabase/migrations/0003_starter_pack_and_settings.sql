-- Starter pack v1 (from Dan's "How I work" method, generalised) and per-customer settings.

-------------------------------------------------------------------------------
-- Customer settings: the figures and defaults each contractor sets for itself.
-------------------------------------------------------------------------------
create table public.tenant_settings (
  tenant_id                 uuid primary key references public.tenants on delete cascade,
  -- Pricing target the draft aims for (optional)
  margin_mode               text not null default 'none' check (margin_mode in ('none', 'per_shift', 'percent')),
  margin_per_shift          numeric,          -- e.g. 7000 (AUD per asphalt shift)
  margin_percent            numeric,          -- e.g. 12 (% of total)
  whole_dollar_rates        boolean not null default false,
  -- Defaults used by the starter rules
  default_binder            text,             -- e.g. 'C320'
  default_prime             text,             -- e.g. 'K2'
  spray_markup_percent      numeric,          -- e.g. 15
  extra_establishment_rate  numeric,          -- AUD per extra establishment, e.g. 4000
  change_tolerance_percent  numeric not null default 5,  -- drawing vs RFQ differences above this are flagged
  reuse_quote_numbers       boolean not null default false, -- off: every quote gets a new number
  pass_on_rules             text,             -- e.g. 'Residential driveways go to <partner>'
  info_request_signature    text,             -- generic team signature for information requests
  updated_at                timestamptz not null default now()
);

alter table public.tenant_settings enable row level security;
create policy "members read" on public.tenant_settings
  for select to authenticated using (public.is_member(tenant_id));
create policy "admins write" on public.tenant_settings
  for all to authenticated
  using (public.has_role(tenant_id, array['admin']))
  with check (public.has_role(tenant_id, array['admin']));

-- Starter rules get a group heading for display
alter table public.starter_rules add column if not exists grp text;
alter table public.rules add column if not exists grp text;

-------------------------------------------------------------------------------
-- Starter pack v1 (replaces the placeholder rules S1-S9 text; new tenants copy these)
-------------------------------------------------------------------------------
insert into public.starter_rules (module, code, grp, text, always_on) values
('quoting','S1','Reading the RFQ','Read the full email, every attachment and every embedded image before measuring or asking anything. Quantity tables are often pasted in as pictures.', false),
('quoting','S2','Reading the RFQ','If the answer is already in the pack, do not ask the client for it.', false),
('quoting','S3','Reading the RFQ','Follow portal and file-share links (EstimateOne, tender portals, SharePoint, Dropbox, WeTransfer, Box) to get the full pack. Never click anything that declines a tender or changes bid status. If a sign-in or one-time code is needed, stop and ask.', true),
('quoting','S4','Reading the RFQ','Check later emails on the same thread. A later email overrides an earlier one on scope, quantities and staging. Watch for a second, slightly different request for the same site.', false),
('quoting','S5','Reading the RFQ','Work the customer passes to someone else (see the pass-on setting, e.g. residential driveways) is flagged as a pass-on and not priced.', false),
('quoting','S6','Quote numbers','Every quote gets a new quote number, even for the same job for another client or an identical resend (unless the customer setting to reuse numbers is on).', false),
('quoting','S7','Quote numbers','Same project for another client: keep the same project name and site so the quotes are linked as one project.', false),
('quoting','S8','Quote numbers','Earlier quotes for the same site appear on the Overview as comparables.', false),
('quoting','S9','Files','Never edit the client''s originals (drawings, BoQ, emails), the master template or past worksheets. Always work in a copy.', true),
('quoting','S10','Files','Keep the client''s own folder names if their pack already has them, and save emails with short, clear names.', false),
('quoting','S11','Measuring and mark-up','Never guess the scale. Calibrate from the title block and sheet size, then check against a scale bar, a known dimension or a chainage. If the sheet was printed at a different size, use the effective scale.', false),
('quoting','S12','Measuring and mark-up','Measure widths kerb lip to kerb lip and lengths along the centreline in sensible runs. Treat flares, knuckles and cul-de-sac bulbs as irregular areas.', false),
('quoting','S13','Measuring and mark-up','Leave out anything marked by others, existing work, and anything beyond the limit of works.', false),
('quoting','S14','Measuring and mark-up','Price at the BoQ; the measured take-off is a check. With no BoQ, price the take-off and flag it. Note small differences and flag differences above the tolerance setting.', false),
('quoting','S15','Measuring and mark-up','Mark up drawings: our asphalt highlighted, a colour per treatment, a legend, width labels on each run, and callouts in clear space.', false),
('quoting','S16','Mixes and binders','If no binder is stated, assume the customer''s default binder and do not ask.', false),
('quoting','S17','Mixes and binders','If the client names a mix that is not on the product list, quote the nearest agreed mix and flag it.', false),
('quoting','S18','Mixes and binders','If a stated depth is below a mix''s minimum layer thickness, use the next suitable mix and flag it.', false),
('quoting','S19','Mixes and binders','A prime-only job with no type named uses the customer''s default prime. A product the customer lists as a prime is treated as a prime, even if the client wrote "primer seal".', false),
('quoting','S20','Ours and not ours','Not ours unless clearly asked for: traffic management, linemarking, concrete, kerb, drainage, earthworks, gravel base, and foamed bitumen or stabilisation.', false),
('quoting','S21','Ours and not ours','No MTV or profiling in the lay rates unless specified. Specified profiling is priced as a lump sum; otherwise hourly hire rates are shown as a schedule only.', false),
('quoting','S22','Ours and not ours','Tack is in the lay rate. Add a separate tack line only if the BoQ has one.', false),
('quoting','S23','Shifts and establishments','Price whole shifts, counted per establishment. Prime or seal is a separate visit from asphalt, and asphalt layers requested separately get their own visits.', false),
('quoting','S24','Shifts and establishments','Stages grouped in the RFQ or BoQ, or done at the same time, share shifts.', false),
('quoting','S25','Shifts and establishments','When the shift count is borderline, price the competitive count and flag the risk.', false),
('quoting','S26','Shifts and establishments','Long hauls reduce the square metres per shift.', false),
('quoting','S27','Shifts and establishments','Establishments beyond those allowed are charged at the customer''s extra-establishment rate.', false),
('quoting','S28','Pricing inputs','Tonnes = area x depth x the product density in the customer''s workbook. Never overwrite a density cell.', true),
('quoting','S29','Pricing inputs','Prime and seal are priced per square metre with the customer''s spray mark-up, and their areas are entered as fixed values.', false),
('quoting','S30','Pricing inputs','The crew rate comes from the customer''s crew table by job type, travel band and square metres per shift. Flag any job treated differently from its table.', false),
('quoting','S31','Pricing inputs','Haul is measured by driving route from the customer''s plant: one-way km and minutes plus a modest truck allowance. Over 60 minutes uses the higher crew band.', false),
('quoting','S32','The Overview','Every Overview has: job at a glance with sources, scope, not ours, flags and questions, a site and haul map, terms and site hours (say plainly if not stated), drawing mark-ups (or say there were none), and 2 to 4 comparable past quotes.', false),
('quoting','S33','The Overview','The Overview shows the quantity being priced (usually the BoQ), not the measured totals.', false),
('quoting','S34','The Overview','Comparables are for reference only. Never change pricing to match them.', false),
('quoting','S35','The Overview','Flag every assumption, on the worksheet and on the Overview.', true),
('quoting','S36','Email and records','Never send a quote. Drafts only.', true),
('quoting','S37','Email and records','If information is missing, draft a polite question from the shared sales mailbox with a generic team signature, only after reading everything. Never attach the quote. The draft stays unsent until approved.', false),
('quoting','S38','Email and records','Never delete RFQ emails. Move them to the to-be-quoted folder once actioned.', true),
('quoting','S39','Email and records','Past worksheets and accounting records are read-only history.', true),
('quoting','S40','Email and records','If a standing rule and a one-off instruction conflict, follow the instruction for that job and note the exception on the Overview.', false)
on conflict (module, code) do update set grp = excluded.grp, text = excluded.text, always_on = excluded.always_on;
