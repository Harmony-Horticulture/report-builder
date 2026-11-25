-- =====================================================================
-- Flower season planner (flowers.html): one row per client job per
-- season, plus the planner's settings (tax, surcharge, markups, crew
-- rates, QuickBooks items). Admins only.
-- Run in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.flower_jobs (
  id               uuid primary key default gen_random_uuid(),
  season           text not null,                       -- e.g. "Spring 2027"
  client_id        bigint references public.clients(id) on delete set null,
  client_name      text not null,
  status           text not null default 'Draft',
  install_date     date,
  data             jsonb not null default '{}'::jsonb,  -- address, plants, labor, materials, locations, notes
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by_name  text
);
create index if not exists flower_jobs_season on public.flower_jobs (season);

alter table public.report_settings add column if not exists flower_settings jsonb;

alter table public.flower_jobs enable row level security;
drop policy if exists "flower jobs admin" on public.flower_jobs;
create policy "flower jobs admin" on public.flower_jobs for all using (is_admin()) with check (is_admin());

create or replace function public.touch_flower_job() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists flower_jobs_touch on public.flower_jobs;
create trigger flower_jobs_touch before update on public.flower_jobs for each row execute function public.touch_flower_job();

select 'Flower planner is set up' as result;
