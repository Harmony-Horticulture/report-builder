-- =====================================================================
-- Vendor statements and invoices from the accounting@ inbox, checked
-- against QuickBooks every weekday morning (tools/vendor_check.js).
-- Shown on the Statement check page under "From email". Admins only.
-- Run in Supabase > SQL Editor. Safe to run again.
-- =====================================================================

create table if not exists public.vendor_docs (
  id           uuid primary key default gen_random_uuid(),
  gmail_id     text not null,
  file_name    text not null default '',
  received_at  timestamptz,
  from_email   text,
  subject      text,
  email_url    text,
  doc_type     text not null default 'statement',   -- statement | invoice
  vendor       text,                                 -- as written on the document
  qb_vendor    text,                                 -- the matching QuickBooks vendor
  doc_no       text,
  doc_date     date,
  amount       numeric(12,2),                        -- statement: open balance; invoice: total
  status       text not null,                        -- Matches | To check | Couldn't read | Couldn't check | Done
  issues       int not null default 0,
  summary      text,
  result       jsonb not null default '{}'::jsonb,   -- problems, totals
  checked_at   timestamptz not null default now(),
  done_at      timestamptz,
  done_by_name text,
  unique (gmail_id, file_name)
);
create index if not exists vendor_docs_received on public.vendor_docs (received_at desc);

alter table public.vendor_docs enable row level security;
drop policy if exists "vendor docs admin" on public.vendor_docs;
create policy "vendor docs admin" on public.vendor_docs for all using (is_admin()) with check (is_admin());

select 'Vendor statements from email are set up' as result;
