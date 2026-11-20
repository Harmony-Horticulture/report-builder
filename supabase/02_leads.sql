-- =====================================================================
-- Harmony Horticulture Leads: one place for every new lead
--
-- HOW TO USE: In Supabase, open SQL Editor > New query, paste this whole
-- file, and click Run. It is safe to run again (for example after an
-- update): it skips anything that is already there.
--
-- It needs the sign-in tables (profiles) from the Time Tracker or from
-- 00_shared_login_and_clients.sql. It only ADDS tables. It does not
-- change any Time Tracker or report data.
--
-- Who sees leads: admins see and edit every lead. Consultants and
-- technicians see only the leads assigned to them.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Leads: one row per person or project asking about our services
-- ---------------------------------------------------------------------
create table if not exists public.leads (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  lead_date       date default (now() at time zone 'America/Phoenix')::date,  -- the day the lead came in

  -- Who and where
  project_name    text not null default '',   -- e.g. "Behrens Residence"
  contact_name    text not null default '',
  company         text not null default '',
  email           text not null default '',
  phone           text not null default '',
  address         text not null default '',

  -- What they need
  property_type   text not null default '',   -- e.g. Estate / Large Residential, HOA
  service         text not null default '',   -- e.g. Diagnostic, Oversight, Ongoing consulting
  request         text not null default '',   -- the problem in their words
  goals           text not null default '',
  budget          text not null default '',
  newsletter      boolean,

  -- How it came in
  channel         text not null default 'phone'
                  check (channel in ('phone', 'email', 'text', 'website', 'intake_form', 'referral', 'other')),
  heard_about     text not null default '',   -- "How did you hear about us" or who referred them

  -- Where it stands
  stage           text not null default 'new'
                  check (stage in ('new', 'contacted', 'intake_sent', 'intake_received', 'scheduled', 'proposal_sent', 'won', 'lost')),
  next_steps      text not null default '',
  zone_quote      numeric(10, 2),             -- site visit minimum for their area
  site_notes      text not null default '',   -- notes from the call or site interview
  assigned_to     uuid references public.profiles(id) on delete set null,
  in_quickbooks   boolean not null default false,
  closed_reason   text not null default '',

  -- Housekeeping
  created_by      uuid references public.profiles(id) on delete set null,
  slack_record_id text unique                 -- set for leads brought over from the Slack Leads list
);

create index if not exists leads_stage_idx on public.leads (stage);
create index if not exists leads_email_idx on public.leads (lower(email));
create index if not exists leads_date_idx  on public.leads (lead_date desc nulls last, created_at desc);

-- Intake form and website answers, kept exactly as submitted.
-- answers is a list like [{"q": "Property address", "a": "123 Main St"}]
create table if not exists public.lead_intakes (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.leads(id) on delete cascade,
  source       text not null default 'intake_form'
               check (source in ('intake_form', 'website', 'manual')),
  submitted_at timestamptz not null default now(),
  answers      jsonb not null default '[]',
  -- The form response or email id, so the same submission is never added twice
  external_id  text unique,
  received_at  timestamptz not null default now()
);
create index if not exists lead_intakes_lead_idx on public.lead_intakes (lead_id, submitted_at desc);

-- Running notes and history on a lead ("Left a message", "Stage: Proposal sent")
create table if not exists public.lead_notes (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.leads(id) on delete cascade,
  created_at  timestamptz not null default now(),
  author_id   uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  body        text not null,
  automatic   boolean not null default false
);
create index if not exists lead_notes_lead_idx on public.lead_notes (lead_id, created_at desc);

-- ---------------------------------------------------------------------
-- Keep updated_at current, and write a history note when the stage changes
-- ---------------------------------------------------------------------
create or replace function public.touch_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  labels jsonb := '{"new":"New","contacted":"Contacted","intake_sent":"Waiting on intake form",
    "intake_received":"Intake received","scheduled":"Site visit scheduled",
    "proposal_sent":"Proposal sent","won":"Won","lost":"Lost"}';
  who text;
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    select coalesce(nullif(full_name, ''), email) into who from profiles where id = auth.uid();
    insert into lead_notes (lead_id, author_id, author_name, body, automatic)
    values (new.id, auth.uid(), coalesce(who, 'Automatic'),
            'Stage changed to ' || coalesce(labels ->> new.stage, new.stage), true);
  end if;
  return new;
end $$;

drop trigger if exists leads_touch on public.leads;
create trigger leads_touch before update on public.leads
  for each row execute function public.touch_lead();

-- ---------------------------------------------------------------------
-- Security rules
-- ---------------------------------------------------------------------
alter table public.leads        enable row level security;
alter table public.lead_intakes enable row level security;
alter table public.lead_notes   enable row level security;

drop policy if exists "leads read"   on public.leads;
drop policy if exists "leads admin"  on public.leads;
drop policy if exists "leads assigned update" on public.leads;
create policy "leads read"  on public.leads for select
  using (is_admin() or (is_active_user() and assigned_to = auth.uid()));
create policy "leads admin" on public.leads for all
  using (is_admin()) with check (is_admin());
create policy "leads assigned update" on public.leads for update
  using (is_active_user() and assigned_to = auth.uid())
  with check (is_active_user() and assigned_to = auth.uid());

drop policy if exists "intakes read"  on public.lead_intakes;
drop policy if exists "intakes admin" on public.lead_intakes;
create policy "intakes read"  on public.lead_intakes for select
  using (exists (select 1 from leads l where l.id = lead_id));
create policy "intakes admin" on public.lead_intakes for all
  using (is_admin()) with check (is_admin());

drop policy if exists "lead notes read" on public.lead_notes;
drop policy if exists "lead notes add"  on public.lead_notes;
drop policy if exists "lead notes admin" on public.lead_notes;
create policy "lead notes read" on public.lead_notes for select
  using (exists (select 1 from leads l where l.id = lead_id));
create policy "lead notes add"  on public.lead_notes for insert
  with check (author_id = auth.uid() and exists (select 1 from leads l where l.id = lead_id));
create policy "lead notes admin" on public.lead_notes for delete
  using (is_admin());

-- People a lead can be assigned to (name only)
create or replace function public.lead_people()
returns table (id uuid, full_name text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email), p.role
    from profiles p where p.active and is_active_user() order by 2;
$$;

grant select, insert, update, delete on public.leads, public.lead_intakes, public.lead_notes to authenticated;
grant usage, select on sequence public.lead_notes_id_seq to authenticated;
grant execute on function public.lead_people() to authenticated;

notify pgrst, 'reload schema';

-- Final check: shows one line saying whether everything is in place
select case
  when to_regclass('public.leads') is null or to_regclass('public.lead_intakes') is null
    or to_regclass('public.lead_notes') is null
    then 'Something is missing: send a screenshot of this page'
  else 'Leads are set up (' || (select count(*) from public.leads) || ' leads so far)'
end as result;
