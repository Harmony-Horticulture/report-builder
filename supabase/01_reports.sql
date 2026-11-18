-- =====================================================================
-- Harmony Horticulture Report Builder: report tables
--
-- HOW TO USE: In Supabase, open SQL Editor > New query, paste this whole
-- file, and click Run. Run it once.
--
-- It needs the sign-in tables (profiles, invitations, clients) first:
-- either the Time Tracker's setup in the same project, or
-- 00_shared_login_and_clients.sql.
--
-- It only ADDS things. It does not change any Time Tracker table except
-- adding title and credentials columns to profiles.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Profile details used as the report signature (RC-04)
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists title       text not null default '';
alter table public.profiles add column if not exists credentials text not null default '';
alter table public.profiles add column if not exists phone       text not null default '';

-- People can update their own name, title, credentials and phone, and
-- nothing else (role and active stay admin-only).
create or replace function public.update_my_report_profile(
  p_full_name text, p_title text, p_credentials text, p_phone text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active_user() then raise exception 'Not signed in.'; end if;
  update profiles
     set full_name   = btrim(coalesce(p_full_name, full_name)),
         title       = btrim(coalesce(p_title, '')),
         credentials = btrim(coalesce(p_credentials, '')),
         phone       = btrim(coalesce(p_phone, ''))
   where id = auth.uid();
end $$;
grant execute on function public.update_my_report_profile(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Report types and their sections (RC-05, RC-06, RC-08)
-- sections is a list like
--   [{"key":"overview","title":"Overview","kind":"notes","help":"..."}]
-- kind is one of: notes, observations, photos, priorities
-- ---------------------------------------------------------------------
create table public.report_types (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text not null default '',
  sections    jsonb not null default '[]',
  sort_order  int not null default 0,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Reports
-- Each report keeps its own copy of the sections it was started with,
-- so editing a template never changes old reports.
-- ---------------------------------------------------------------------
create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles(id),
  type_id       uuid references public.report_types(id) on delete set null,
  type_name     text not null,
  sections      jsonb not null default '[]',
  client_id     bigint references public.clients(id) on delete set null,
  client_name   text not null default '',
  property      text not null default '',
  community     text not null default '',
  contact_name  text not null default '',
  contact_email text not null default '',
  report_date   date not null default current_date,
  -- Consultant name, title, credentials and email at the time of writing
  consultant    jsonb not null default '{}',
  -- Notes, observations, photos and priorities, keyed by section
  content       jsonb not null default '{}',
  status        text not null default 'draft' check (status in ('draft', 'review', 'sent')),
  version       int not null default 1,
  -- Secret part of the client's link. Random, so links can't be guessed.
  share_token   uuid unique,
  sent_at       timestamptz,
  sent_to       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index reports_user on public.reports (user_id, updated_at desc);
create index reports_date on public.reports (report_date desc);

create or replace function public.touch_report() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger reports_touch before update on public.reports
  for each row execute function public.touch_report();

-- Send history: who sent which version to whom, and when (RC-26, RC-28)
create table public.report_sends (
  id         bigint generated always as identity primary key,
  report_id  uuid not null references public.reports(id) on delete cascade,
  version    int not null,
  sent_by    uuid references public.profiles(id),
  sent_to    text not null,
  message    text not null default '',
  sent_at    timestamptz not null default now()
);
create index report_sends_report on public.report_sends (report_id, sent_at desc);

-- App settings (one row)
create table public.report_settings (
  id                  int primary key default 1 check (id = 1),
  -- AI polish stays off until Harmony Horticulture approves it (RC-19)
  ai_polish_enabled   boolean not null default false,
  -- Dictation fixes, e.g. {"heard":"acer palmer tum","write":"Acer palmatum"} (RC-18)
  dictation_terms     jsonb not null default '[]',
  updated_at          timestamptz not null default now()
);
insert into public.report_settings (id) values (1) on conflict do nothing;

-- ---------------------------------------------------------------------
-- Security rules
-- ---------------------------------------------------------------------
alter table public.report_types    enable row level security;
alter table public.reports         enable row level security;
alter table public.report_sends    enable row level security;
alter table public.report_settings enable row level security;

create policy "report types read"  on public.report_types for select using (is_active_user());
create policy "report types admin" on public.report_types for all using (is_admin()) with check (is_admin());

-- Consultants see and change their own reports; admins see everyone's (RC-01, RC-03)
create policy "reports read" on public.reports for select
  using (is_active_user() and (user_id = auth.uid() or is_admin()));
create policy "reports add" on public.reports for insert
  with check (is_active_user() and user_id = auth.uid());
create policy "reports change" on public.reports for update
  using (is_active_user() and (user_id = auth.uid() or is_admin()))
  with check (is_active_user() and (user_id = auth.uid() or is_admin()));
create policy "reports delete" on public.reports for delete
  using (is_admin() or (user_id = auth.uid() and status <> 'sent'));

create policy "sends read" on public.report_sends for select
  using (exists (select 1 from reports r where r.id = report_id and (r.user_id = auth.uid() or is_admin())));
create policy "sends add" on public.report_sends for insert
  with check (sent_by = auth.uid() and exists (
    select 1 from reports r where r.id = report_id and (r.user_id = auth.uid() or is_admin())));

create policy "settings read"  on public.report_settings for select using (is_active_user());
create policy "settings admin" on public.report_settings for update using (is_admin()) with check (is_admin());

-- Everyone signed in can see names, titles and emails of active teammates
-- (for the consultant filter on the dashboard), but nothing else changes.
create or replace function public.report_people()
returns table (id uuid, full_name text, email text, role text, title text, credentials text, active boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, p.email, p.role, p.title, p.credentials, p.active
    from profiles p where is_active_user();
$$;
grant execute on function public.report_people() to authenticated;

-- ---------------------------------------------------------------------
-- Photo storage
-- report-photos: private. Photos live in a folder named after the report,
--   and only people who can open that report can see them.
-- shared-reports: what clients open from their email. Each sent report
--   is in a folder named after its random share_token, so nobody can
--   find another client's report by changing the link (RC-27).
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('report-photos', 'report-photos', false), ('shared-reports', 'shared-reports', true)
on conflict (id) do nothing;

create or replace function public.can_open_report(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reports r
     where r.id::text = p_folder and is_active_user() and (r.user_id = auth.uid() or is_admin())
  );
$$;

create or replace function public.can_share_report(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reports r
     where r.share_token::text = p_folder and is_active_user() and (r.user_id = auth.uid() or is_admin())
  );
$$;

create policy "report photos read" on storage.objects for select to authenticated
  using (bucket_id = 'report-photos' and can_open_report((storage.foldername(name))[1]));
create policy "report photos add" on storage.objects for insert to authenticated
  with check (bucket_id = 'report-photos' and can_open_report((storage.foldername(name))[1]));
create policy "report photos change" on storage.objects for update to authenticated
  using (bucket_id = 'report-photos' and can_open_report((storage.foldername(name))[1]));
create policy "report photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'report-photos' and can_open_report((storage.foldername(name))[1]));

-- Public bucket: anyone with the exact link can download a file, but
-- nobody can list the folder. Only the report's author or an admin can write.
create policy "shared reports add" on storage.objects for insert to authenticated
  with check (bucket_id = 'shared-reports' and can_share_report((storage.foldername(name))[1]));
create policy "shared reports change" on storage.objects for update to authenticated
  using (bucket_id = 'shared-reports' and can_share_report((storage.foldername(name))[1]));
create policy "shared reports read own" on storage.objects for select to authenticated
  using (bucket_id = 'shared-reports' and can_share_report((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------
-- Starting report types (admins can change these in the app)
-- ---------------------------------------------------------------------
insert into public.report_types (name, description, sort_order, sections) values
(
  'Monthly Property Care Report',
  'Monthly visit: overview, observations with photos and recommendations, priorities and follow-up.',
  1,
  '[
    {"key":"overview","title":"Overview","kind":"notes","help":"A short summary of the visit and the overall health of the property."},
    {"key":"observations","title":"Observations","kind":"observations","help":"What you saw, with an optional photo and a recommendation for each."},
    {"key":"priorities","title":"Priorities","kind":"priorities","help":"What needs to happen, grouped Priority 1, Priority 2 and Future/ongoing."},
    {"key":"followup","title":"Follow-up","kind":"notes","help":"Next visit, open questions and anything the client needs to do."}
  ]'
),
(
  'Site Visit Photo Report',
  'Quick photo report: snap a photo and add a short note for each.',
  2,
  '[
    {"key":"summary","title":"Visit Summary","kind":"notes","help":"Optional: one or two sentences about the visit."},
    {"key":"photos","title":"Site Photos","kind":"photos","help":"Add a photo and a short note for each thing you want to show."},
    {"key":"next","title":"Next Steps","kind":"priorities","help":"Optional: what should happen next."}
  ]'
)
on conflict (name) do nothing;
