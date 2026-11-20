-- Only admins (Krista and Kasey) can see or change leads.
-- Before this, a consultant or technician could see and edit leads assigned to them.
-- Safe to run again.
drop policy if exists "leads assigned update" on public.leads;
drop policy if exists "leads read" on public.leads;
create policy "leads read" on public.leads for select using (is_admin());
-- Intakes and notes follow the leads a person can see, so they are admin-only too.
select 'Leads are now admins only' as result;
