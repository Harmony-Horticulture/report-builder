-- Intake form answers that have no column of their own (property manager,
-- billing, site access, providers, events). Keys match FORM in js/leads.js.
-- Already applied to the live project on 2026-11-20. Safe to run again.
alter table public.leads add column if not exists details jsonb not null default '{}'::jsonb;
comment on column public.leads.details is 'Intake form answers that have no column of their own. Keys match FORM in js/leads.js.';
select 'Lead details are set up' as result;
