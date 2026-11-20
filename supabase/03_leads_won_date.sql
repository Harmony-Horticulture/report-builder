-- =====================================================================
-- Leads: remember the day each lead was won, for "Won this month".
-- SQL Editor > New query > paste > Run. Safe to run again.
-- =====================================================================
alter table public.leads add column if not exists won_at timestamptz;

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
    new.won_at := case when new.stage = 'won' then now() else null end;
    select coalesce(nullif(full_name, ''), email) into who from profiles where id = auth.uid();
    insert into lead_notes (lead_id, author_id, author_name, body, automatic)
    values (new.id, auth.uid(), coalesce(who, 'Automatic'),
            'Stage changed to ' || coalesce(labels ->> new.stage, new.stage), true);
  end if;
  return new;
end $$;

notify pgrst, 'reload schema';
select 'Won dates are set up' as result;
