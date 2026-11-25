-- =====================================================================
-- SOP library: the SOPs page (sops.html), open to everyone signed in.
--
-- Everyone active (consultants, technicians and admins) can read SOPs
-- marked "everyone". SOPs marked "admins" are only visible to admins.
-- Only admins can add, update or archive an SOP.
-- Each SOP has a PDF (what people read in the app) and, optionally, the
-- editable Word file (admins only). Replacing the file keeps the old one
-- as a past version.
--
-- Safe to run more than once. Run it in Supabase > SQL Editor.
-- =====================================================================

create table if not exists public.sops (
  id              uuid primary key default gen_random_uuid(),
  sop_number      text not null default '',
  title           text not null,
  category        text not null default 'Field work',
  audience        text not null default 'everyone' check (audience in ('everyone', 'admins')),
  summary         text not null default '',
  version         text not null default '',
  pdf_path        text not null,
  word_path       text,
  drive_url       text not null default '',
  search_text     text not null default '',
  archived        boolean not null default false,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_by_name text not null default '',
  created_at      timestamptz not null default now()
);

create table if not exists public.sop_versions (
  id               uuid primary key default gen_random_uuid(),
  sop_id           uuid not null references public.sops(id) on delete cascade,
  version          text not null default '',
  pdf_path         text not null,
  word_path        text,
  was_updated_at   timestamptz,
  replaced_at      timestamptz not null default now(),
  replaced_by_name text not null default ''
);
create index if not exists sop_versions_sop on public.sop_versions (sop_id, replaced_at desc);

alter table public.sops enable row level security;
alter table public.sop_versions enable row level security;
grant select, insert, update, delete on public.sops, public.sop_versions to authenticated;

drop policy if exists "sops read" on public.sops;
drop policy if exists "sops admin" on public.sops;
create policy "sops read" on public.sops for select
  using (is_admin() or (is_active_user() and audience = 'everyone' and not archived));
create policy "sops admin" on public.sops for all using (is_admin()) with check (is_admin());

drop policy if exists "sop versions admin" on public.sop_versions;
create policy "sop versions admin" on public.sop_versions for all using (is_admin()) with check (is_admin());

-- Private file storage: PDFs and Word files
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sops', 'sops', false, 26214400, array[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do nothing;

-- Who can open a file: admins can open any. Everyone else can open only
-- the current PDF of an SOP that is open to everyone.
create or replace function public.can_open_sop_file(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or (is_active_user() and exists (
    select 1 from sops where pdf_path = p and audience = 'everyone' and not archived));
$$;

drop policy if exists "sop files read" on storage.objects;
drop policy if exists "sop files add" on storage.objects;
drop policy if exists "sop files delete" on storage.objects;
create policy "sop files read" on storage.objects for select using (bucket_id = 'sops' and can_open_sop_file(name));
create policy "sop files add" on storage.objects for insert with check (bucket_id = 'sops' and is_admin());
create policy "sop files delete" on storage.objects for delete using (bucket_id = 'sops' and is_admin());

select 'The SOP library is set up' as result;
