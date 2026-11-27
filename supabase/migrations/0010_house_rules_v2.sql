-- House rules v2: the original 40, merged with Dan's quoting bot rules (Nov 2026), generalised.
-- Company-specific setups (named systems, people, templates, set densities) are customer rules, not house rules.
-- Figures here are defaults; a customer's own rule replaces any of them.

insert into public.starter_rules (module, code, grp, text, always_on) values
-- Reading the RFQ
('quoting','S1','Reading the RFQ','Get and read the full pack (email, every attachment and embedded image, drawings, specs, BoQ) before measuring, pricing or asking anything. Email quantities are often partial or out of date, and quantity tables are often pasted in as pictures.', false),
('quoting','S2','Reading the RFQ','If the answer is already in the pack, do not ask the client for it.', false),
('quoting','S3','Reading the RFQ','Follow portal and file-share links (EstimateOne, tender portals, SharePoint, Dropbox, WeTransfer, Box) to get the full pack. Never click anything that declines a tender or changes bid status. If a sign-in or one-time code is needed, stop and ask.', true),
('quoting','S4','Reading the RFQ','Check later emails on the same thread. A later email overrides an earlier one on scope, quantities and staging. Watch for a second, slightly different request for the same site.', false),
('quoting','S5','Reading the RFQ','Work the customer passes to someone else (see the pass-on setting, e.g. residential driveways) is flagged as a pass-on and not priced.', false),
-- Quote numbers
('quoting','S6','Quote numbers','Before numbering, check past quotes for the same project, address, suburb or drawing number. Every quote gets a new number, even for the same job for another client, unless the customer''s setting to reuse numbers is on; then reuse only when scope and quantities are exactly the same.', false),
('quoting','S7','Quote numbers','Same project for another client: keep the same project name and site so the quotes are linked as one project.', false),
('quoting','S8','Quote numbers','Earlier quotes for the same site appear on the Overview as comparables.', false),
-- Files
('quoting','S9','Files','Never edit, move or delete the client''s originals (drawings, BoQ, emails), the master template or past quotes. Work in one copy per job and keep updating that same copy.', true),
('quoting','S10','Files','Keep the client''s own folder names if their pack already has them, and save emails and files with short, clear names so file paths stay short.', false),
-- Measuring
('quoting','S11','Measuring and mark-up','Never guess the scale. Calibrate from the title block and sheet size, then check against a scale bar, a known dimension or a chainage. If the sheet was printed at a different size, use the effective scale.', false),
('quoting','S12','Measuring and mark-up','Measure widths kerb lip to kerb lip and lengths along the centreline in sensible runs. Treat flares, knuckles and cul-de-sac bulbs as irregular areas.', false),
('quoting','S13','Measuring and mark-up','Leave out anything marked by others, existing work, and anything beyond the limit of works.', false),
('quoting','S14','Measuring and mark-up','Price at the BoQ; the measured take-off is a check. With no BoQ, price the take-off and flag it. Note small differences and flag differences above the tolerance setting.', false),
('quoting','S15','Measuring and mark-up','Mark up drawings: our asphalt highlighted, a colour per treatment, a legend, width labels on each run, and callouts in clear space.', false),
-- Mixes
('quoting','S16','Mixes and binders','If no binder is stated, use the customer''s default binder and do not ask. A binder the customer doesn''t supply for asphalt is quoted as their default binder and flagged; spray seal binder still follows the spray spec.', false),
('quoting','S17','Mixes and binders','If the client names a mix that is not on the product list, quote the nearest agreed mix and flag it.', false),
('quoting','S18','Mixes and binders','If a stated depth is below a mix''s minimum layer thickness (e.g. 10 mm mixes need about 35 mm), use the next suitable thinner-layer mix and flag it.', false),
('quoting','S19','Mixes and binders','A prime-only job with no type named uses the customer''s default prime. An unspecified "primer seal" is the customer''s standard primer seal (commonly a 10 mm primer seal). A product the customer lists as a prime is treated as a prime even if the client wrote "primer seal".', false),
-- Ours and not ours
('quoting','S20','Ours and not ours','Not ours unless clearly asked for: traffic management, linemarking, concrete, kerb, drainage, earthworks, gravel base, and foamed bitumen or stabilisation.', false),
('quoting','S21','Ours and not ours','No MTV or profiling in the lay rates. Flag an MTV as not ours. If profiling is asked for, price it separately (by quantity, or an hourly hire rate if there is no quantity) and note it is priced separately.', false),
('quoting','S22','Ours and not ours','Tack is in the lay rate. Tack shown only on drawings or in specs is not priced; add a separate tack line only if the BoQ has one.', false),
-- Shifts
('quoting','S23','Shifts and establishments','Price whole shifts, based on the total square metres laid in a day, not one shift per mix. Count per establishment: prime or seal is a separate visit from asphalt, and asphalt layers requested separately get their own visits.', false),
('quoting','S24','Shifts and establishments','Group areas and stages the way the RFQ or BoQ groups them. Stages grouped there, or done at the same time, share shifts.', false),
('quoting','S25','Shifts and establishments','Output figures are guides. When a job is just over a limit or the shift count is borderline, price the count that can win and flag the risk (e.g. about 8,800 m² of prime stays as 1 shift).', false),
('quoting','S26','Shifts and establishments','Haul sets output: use the supply plant to site km and minutes. Longer hauls mean fewer loads and fewer square metres a shift. Over about 70 minutes is long haul; at about 80 minutes or more, allow about 1.5 truck rounds a shift.', false),
('quoting','S27','Shifts and establishments','Establishments beyond those allowed are charged at the customer''s extra-establishment rate. Float moves are for asphalt establishments only, never seal or spray shifts.', false),
-- Pricing inputs
('quoting','S28','Pricing inputs','Tonnes = area x depth x the product''s density from the customer''s costs or workbook. Never overwrite a density.', true),
('quoting','S29','Pricing inputs','Prime and seal are priced per square metre with the customer''s spray mark-up, and their areas are entered as fixed values.', false),
('quoting','S30','Pricing inputs','The crew rate comes from the customer''s crew rates by job type, travel band and square metres a shift. Night work uses the night crew rate; very small jobs (under about 20 t) use the small-crew rate. Flag any job treated differently.', false),
('quoting','S31','Pricing inputs','Haul is measured by the driving route from the supply plant (the nearest one that supplies the mix, unless another is chosen) to the site: one-way km and minutes plus a truck allowance. Over 60 minutes uses the higher crew band.', false),
-- Overview
('quoting','S32','The Overview','Every Overview has: job at a glance with a source for every fact, scope, not ours, flags and questions, a site and haul map, exact figures from the pricing, terms and site hours (say plainly if not stated), drawing mark-ups (or say there were none), and 2 to 4 comparable past quotes. No fluff.', false),
('quoting','S33','The Overview','The Overview shows the quantity being priced (usually the BoQ), not the measured totals.', false),
('quoting','S34','The Overview','Comparables are for reference only. Never change pricing to match them, and never compare against the final pricer''s own quote.', false),
('quoting','S35','The Overview','Flag every assumption (night works, shift counts, mix, binder, anything guessed) on the pricing and on the Overview.', true),
-- Email and records
('quoting','S36','Email and records','Never send a quote. Drafts only: reply-all drafts with the quote attached stay unsent until a person sends them.', true),
('quoting','S37','Email and records','If quantities, areas, depths or mix are missing, draft a polite question from the shared sales mailbox with a generic team signature, only after reading everything. Never attach the quote. The draft stays unsent until approved.', false),
('quoting','S38','Email and records','Never delete RFQ emails. Move them to the to-be-quoted folder once actioned.', true),
('quoting','S39','Email and records','Past quotes, worksheets and accounting records are read-only history.', true),
('quoting','S40','Email and records','If a standing rule and a one-off instruction conflict, follow the instruction for that job and note the exception on the Overview.', false),
-- New from the bot
('quoting','S41','Shifts and establishments','Default outputs a shift: car parks with bays and islands up to about 2,500 m² of asphalt; open or distant jobs about 3,700 m² of asphalt; prime about 8,000 m² (about 10% leeway); seal about 5,000 to 6,000 m², with over 10,000 m² getting 2 seal shifts.', false),
('quoting','S42','Mixes and binders','RAP mixes are standard: never query them. Only use a RAP mix when the job is large enough to justify it (about 1,000 t or more).', false),
('quoting','S43','Additional items','Road tape, bitumen tape and similar joint tapes are one item, priced per metre as an additional service. Make sure the line shows on the customer''s quote.', false),
('quoting','S44','Pricing and margin','Aim for the customer''s margin target (per asphalt shift or a % of the total). Spray work is left out of a per-shift target and stays at the spray mark-up. If the customer wants whole-dollar rates, round the supply and lay rate to a whole dollar per tonne.', false),
('quoting','S45','Pricing and margin','Flag awkward, risky jobs for a harder margin, and easy, competitive jobs as ones to win on a lower margin.', false),
('quoting','S46','Pricing and margin','Never undo a change a person made to a draft (margins, shifts, staging, wording). When reusing an earlier quote, keep that person''s approach. A signed-off final is final.', true),
('quoting','S47','Learning','Compare each signed-off final with the draft and propose every difference as a new rule for the customer to approve.', false),
('quoting','S48','What goes on the quote','Keep the project name short: street names, or the site address if the name is too long. Keep line notes short (an area, street or stage).', false),
('quoting','S49','What goes on the quote','Line totals must add up to the quote total, and the quote total must match the pricing.', true)
on conflict (module, code) do update set grp = excluded.grp, text = excluded.text, always_on = excluded.always_on;
