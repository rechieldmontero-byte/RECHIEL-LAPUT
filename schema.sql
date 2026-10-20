
-- SCHOLARSHIP MONITORING SYSTEM
-- Run in the Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1. User profiles and roles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'Scholar'
    check (role in ('Scholar', 'Scholarship Staff', 'Administrator')),
  created_at timestamptz not null default now()
);

-- 2. Scholarship programs
create table public.scholarship_programs (
  id uuid primary key default gen_random_uuid(),
  program_name text unique not null,
  max_gwa numeric(3,2) not null,
  min_units integer not null check (min_units >= 0),
  max_dropped integer not null check (max_dropped >= 0),
  created_at timestamptz not null default now()
);

insert into public.scholarship_programs
  (program_name, max_gwa, min_units, max_dropped)
values
  ('Merit Scholar', 1.75, 18, 0),
  ('Community Scholar', 2.25, 15, 1)
on conflict (program_name) do update set
  max_gwa = excluded.max_gwa,
  min_units = excluded.min_units,
  max_dropped = excluded.max_dropped;

-- 3. Semester submissions
create table public.semester_submissions (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.profiles(id),
  program_id uuid not null references public.scholarship_programs(id),
  semester text not null,
  school_year text not null,
  gwa numeric(3,2) not null check (gwa between 1.00 and 5.00),
  units integer not null check (units >= 0),
  failed_count integer not null check (failed_count >= 0),
  incomplete_count integer not null check (incomplete_count >= 0),
  dropped_count integer not null check (dropped_count >= 0),
  document_reference text not null,
  submitted_at timestamptz not null default now(),
  verification_status text not null default 'Pending'
    check (verification_status in ('Pending', 'Verified', 'Returned')),
  verification_notes text not null default '',
  compliance_status text not null default 'Not Evaluated'
    check (compliance_status in ('Not Evaluated', 'Compliant', 'With Deficiency')),
  deficiency_details text not null default '',
  renewal_decision text not null default 'Pending'
    check (renewal_decision in ('Pending', 'Approved', 'Held')),
  evaluated_by uuid references public.profiles(id),
  evaluated_at timestamptz
);

-- 4. Audit trail
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  record_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Create a Scholar profile automatically after registration.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'Scholar'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5. Enable Row Level Security
alter table public.profiles enable row level security;
alter table public.scholarship_programs enable row level security;
alter table public.semester_submissions enable row level security;
alter table public.audit_logs enable row level security;

-- Helper: staff/admin role check
create or replace function public.is_scholarship_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role in ('Scholarship Staff', 'Administrator')
  );
$$;

-- Profiles: users can read their own profile.
create policy "Read own profile or staff reads all"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or public.is_scholarship_staff());

-- Programs: all logged-in users can view programs.
create policy "Authenticated users read programs"
on public.scholarship_programs for select to authenticated
using (true);

-- Submissions: scholars see their own; staff can see all.
create policy "Read own submissions or staff reads all"
on public.semester_submissions for select to authenticated
using (
  scholar_id = (select auth.uid())
  or public.is_scholarship_staff()
);

-- Scholars can submit for themselves only.
create policy "Scholars create own submissions"
on public.semester_submissions for insert to authenticated
with check (
  scholar_id = (select auth.uid())
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'Scholar'
  )
);

-- Only staff/admin can update verification/evaluation records.
create policy "Staff updates submissions"
on public.semester_submissions for update to authenticated
using (public.is_scholarship_staff())
with check (public.is_scholarship_staff());

-- Audit logs: staff can read logs; users can only read their own.
create policy "Read own logs or staff reads all"
on public.audit_logs for select to authenticated
using (
  actor_id = (select auth.uid())
  or public.is_scholarship_staff()
);

-- Insert audit events only for the signed-in user.
create policy "Insert own audit logs"
on public.audit_logs for insert to authenticated
with check (actor_id = (select auth.uid()));

-- 6. Verify a submission (staff only)
create or replace function public.verify_submission(
  p_submission_id uuid,
  p_status text,
  p_notes text default ''
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_scholarship_staff() then
    raise exception 'Only Scholarship Staff can verify submissions.';
  end if;

  if p_status not in ('Verified', 'Returned') then
    raise exception 'Invalid verification status.';
  end if;

  update public.semester_submissions
  set verification_status = p_status,
      verification_notes = coalesce(p_notes, '')
  where id = p_submission_id;

  if not found then
    raise exception 'Submission not found or inaccessible.';
  end if;

  insert into public.audit_logs (actor_id, action, record_id, details)
  values (
    (select auth.uid()),
    'SUBMISSION_' || upper(p_status),
    p_submission_id,
    jsonb_build_object('notes', coalesce(p_notes, ''))
  );
end;
$$;

-- 7. Evaluate compliance and record renewal decision.
create or replace function public.evaluate_submission(
  p_submission_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  s public.semester_submissions%rowtype;
  prog public.scholarship_programs%rowtype;
  problems text[] := array[]::text[];
  late_submission boolean;
  result_status text;
begin
  if not public.is_scholarship_staff() then
    raise exception 'Only Scholarship Staff can evaluate submissions.';
  end if;

  if p_decision not in ('Approved', 'Held') then
    raise exception 'Decision must be Approved or Held.';
  end if;

  select * into s
  from public.semester_submissions
  where id = p_submission_id
  for update;

  if not found then
    raise exception 'Submission not found.';
  end if;

  if s.verification_status <> 'Verified' then
    raise exception 'Verify the grade document before evaluation.';
  end if;

  select * into prog
  from public.scholarship_programs
  where id = s.program_id;

  if s.gwa > prog.max_gwa then
    problems := array_append(problems, 'GWA exceeds the program limit');
  end if;

  if s.units < prog.min_units then
    problems := array_append(problems, 'Insufficient units');
  end if;

  if s.failed_count > 0 then
    problems := array_append(problems, 'Failed subject detected');
  end if;

  if s.incomplete_count > 0 then
    problems := array_append(problems, 'Incomplete subject detected');
  end if;

  if s.dropped_count > prog.max_dropped then
    problems := array_append(problems, 'Dropped subjects exceed the program limit');
  end if;

  late_submission :=
    s.submitted_at > timestamptz '2026-10-30 17:00:00+08';

  if late_submission then
    problems := array_append(problems, 'Late submission');
  end if;

  result_status := case
    when cardinality(problems) = 0 then 'Compliant'
    else 'With Deficiency'
  end;

  if result_status <> 'Compliant' and p_decision = 'Approved' then
    raise exception 'Cannot approve renewal: submission has deficiencies.';
  end if;

  update public.semester_submissions
  set compliance_status = result_status,
      deficiency_details = array_to_string(problems, '; '),
      renewal_decision = p_decision,
      evaluated_by = (select auth.uid()),
      evaluated_at = now()
  where id = p_submission_id;

  insert into public.audit_logs (actor_id, action, record_id, details)
  values (
    (select auth.uid()),
    'COMPLIANCE_EVALUATED',
    p_submission_id,
    jsonb_build_object(
      'compliance_status', result_status,
      'renewal_decision', p_decision,
      'deficiencies', problems
    )
  );

  return jsonb_build_object(
    'compliance_status', result_status,
    'renewal_decision', p_decision,
    'deficiencies', problems
  );
end;
$$;

-- Prevent users from changing profile roles through ordinary table updates.
revoke insert, update, delete on public.profiles from anon, authenticated;
revoke insert, update, delete on public.scholarship_programs from anon, authenticated;
revoke delete on public.semester_submissions from anon, authenticated;
revoke update, delete on public.audit_logs from anon, authenticated;

grant select on public.profiles, public.scholarship_programs,
  public.semester_submissions, public.audit_logs to authenticated;
grant insert on public.semester_submissions to authenticated;
grant select, insert on public.audit_logs to authenticated;

grant execute on function public.verify_submission(uuid, text, text)
  to authenticated;
grant execute on function public.evaluate_submission(uuid, text)
  to authenticated;
