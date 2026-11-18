-- =====================================================================
-- Client contacts. Run once (SQL Editor > New query > paste > Run),
-- after 01_reports.sql. Safe to run again.
--
-- Adds the contact person, email and phone to the shared clients list,
-- so picking a client in a report fills in who to greet and where to
-- send it. The Time Tracker uses the same clients list and ignores
-- these columns, so nothing changes there.
--
-- To fill them in, run the client-contacts.sql file from the project
-- files (it has customer emails, so it isn't kept in GitHub).
-- =====================================================================
alter table public.clients add column if not exists contact_name  text;
alter table public.clients add column if not exists contact_email text;
alter table public.clients add column if not exists phone         text;
