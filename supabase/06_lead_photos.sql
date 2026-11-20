-- Photos on a lead: a private storage folder only admins (Krista and Kasey) can use.
-- Already applied to the live project on 2026-11-20. Safe to run again.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('lead-photos', 'lead-photos', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif'])
on conflict (id) do nothing;
drop policy if exists "lead photos read" on storage.objects;
drop policy if exists "lead photos add" on storage.objects;
drop policy if exists "lead photos delete" on storage.objects;
create policy "lead photos read" on storage.objects for select using (bucket_id = 'lead-photos' and is_admin());
create policy "lead photos add" on storage.objects for insert with check (bucket_id = 'lead-photos' and is_admin());
create policy "lead photos delete" on storage.objects for delete using (bucket_id = 'lead-photos' and is_admin());
select 'Lead photos are set up' as result;
