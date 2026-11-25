-- =====================================================================
-- SOP editing: SOPs written and edited in the app (sops.html).
-- Each SOP's text is kept in sops.content; saving keeps the previous
-- version in sop_versions. The Web app address of the Google Drive
-- helper (integrations/sop-drive.gs) is kept in report_settings.
-- Run after 07_sops.sql. Safe to run more than once.
-- =====================================================================
alter table public.sops add column if not exists content jsonb;
alter table public.sops add column if not exists drive_synced_at timestamptz;
alter table public.sops alter column pdf_path drop not null;
alter table public.sop_versions add column if not exists content jsonb;
alter table public.sop_versions alter column pdf_path drop not null;
alter table public.report_settings add column if not exists sop_drive_url text not null default '';

select 'SOP editing is set up' as result;
