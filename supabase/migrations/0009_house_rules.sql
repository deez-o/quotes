-- House rules stay in the background: starter_rules is the platform's hidden method (readable by
-- the platform admin and the server only). Customers no longer get a visible copy; their own
-- rules (Teach screen) are layered on top and win where they conflict.
-- Earlier copies are parked (code S#, off) rather than deleted, so nothing is lost.
update public.rules
set code = 'S' || regexp_replace(code, '\D', '', 'g'), status = 'off', updated_at = now()
where source = 'starter' and code not like 'S%';
