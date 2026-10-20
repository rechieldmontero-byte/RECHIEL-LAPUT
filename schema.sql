-- Scholarship Monitoring System: schema and access-control setup.
-- Safe to re-run on the current assignment-based Supabase schema; it does not drop data.
-- Create the staff Auth account first. The final block links SMS@gmail.com as staff.

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('Scholar','Scholarship Staff');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.verification_status as enum ('Pending','Verified','Returned');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.compliance_status as enum ('Not Evaluated','Compliant','With Deficiency');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.renewal_status as enum ('Not Decided','Approved','Held');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  student_id text unique,
  full_name text not null default '',
  email text,
  role public.app_role not null default 'Scholar',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists student_id text;
alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists is_active boolean not null default true;

create table if not exists public.scholarship_programs (
  id uuid primary key default gen_random_uuid(),
  program_name text not null unique,
  max_gwa numeric(3,2) not null check (max_gwa between 1 and 5),
  min_enrolled_units integer not null check (min_enrolled_units >= 0),
  max_failed_count integer not null default 0 check (max_failed_count >= 0),
  max_incomplete_count integer not null default 0 check (max_incomplete_count >= 0),
  max_dropped_count integer not null check (max_dropped_count >= 0),
  deadline timestamptz not null
);

create table if not exists public.scholar_assignments (
  id uuid primary key default gen_random_uuid(),
  scholar_id uuid not null references public.profiles(id),
  program_id uuid not null references public.scholarship_programs(id),
  assigned_by uuid references public.profiles(id),
  is_active boolean not null default true,
  assigned_at timestamptz not null default now(),
  unique (scholar_id, program_id)
);

create table if not exists public.semester_submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.scholar_assignments(id),
  academic_year text not null check (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
  semester text not null check (semester in ('Semester 1','Semester 2','Summer')),
  gwa numeric(3,2) not null check (gwa between 1 and 5),
  enrolled_units integer not null check (enrolled_units >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  incomplete_count integer not null default 0 check (incomplete_count >= 0),
  dropped_count integer not null default 0 check (dropped_count >= 0),
  evidence_reference text,
  submitted_at timestamptz not null default now(),
  verification public.verification_status not null default 'Pending',
  verification_reason text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  compliance public.compliance_status not null default 'Not Evaluated',
  compliance_reasons text[] not null default '{}',
  evaluated_by uuid references public.profiles(id),
  evaluated_at timestamptz,
  renewal public.renewal_status not null default 'Not Decided',
  decision_note text,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, academic_year, semester)
);
alter table public.semester_submissions alter column evidence_reference drop not null;

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  module text not null,
  record_id uuid,
  description text not null,
  created_at timestamptz not null default now()
);

insert into public.scholarship_programs
  (program_name,max_gwa,min_enrolled_units,max_failed_count,max_incomplete_count,max_dropped_count,deadline)
values
  ('Merit Scholar',1.75,18,0,0,0,'2026-10-30 17:00:00+08'),
  ('Community Scholar',2.25,15,0,0,1,'2026-10-30 17:00:00+08')
on conflict (program_name) do nothing;

create or replace function public.current_app_role()
returns public.app_role
language sql stable security definer set search_path=public
as $$ select role::text::public.app_role from public.profiles where id=auth.uid() and is_active=true $$;

create or replace function public.is_scholarship_staff()
returns boolean
language sql stable security definer set search_path=public
as $$ select coalesce(public.current_app_role()='Scholarship Staff',false) $$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,student_id,full_name,email,role,is_active)
  values(new.id, nullif(trim(new.raw_user_meta_data->>'student_id'),''), coalesce(new.raw_user_meta_data->>'full_name',''), new.email, 'Scholar', true)
  on conflict(id) do nothing;
  return new;
end $$;



drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.audit_submission_insert()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  select auth.uid(),'SUBMITTED','Submission',new.id,
         'Submitted '||new.academic_year||' '||new.semester
  from public.scholar_assignments a where a.id=new.assignment_id;
  return new;
end $$;

drop trigger if exists semester_submission_audit_insert on public.semester_submissions;
create trigger semester_submission_audit_insert
after insert on public.semester_submissions
for each row execute function public.audit_submission_insert();

create or replace function public.staff_register_scholar(
  p_student_id text,p_full_name text,p_email text,p_program_name text
)
returns uuid language plpgsql security definer set search_path=public,auth
as $$
declare v_user_id uuid; v_program_id uuid; v_assignment_id uuid;
begin
  if not public.is_scholarship_staff() then raise exception 'Access denied: Scholarship Staff only.'; end if;
  select id into v_user_id from auth.users where lower(email)=lower(trim(p_email));
  if v_user_id is null then raise exception 'Create the scholar Auth account first.'; end if;
  if v_user_id=auth.uid() then raise exception 'Staff cannot register their own account as a scholar.'; end if;
  select id into v_program_id from public.scholarship_programs where program_name=p_program_name;
  if v_program_id is null then raise exception 'Unknown scholarship program.'; end if;

  insert into public.profiles(id,student_id,full_name,email,role,is_active)
  values(v_user_id,trim(p_student_id),trim(p_full_name),lower(trim(p_email)),'Scholar',true)
  on conflict(id) do update set student_id=excluded.student_id,full_name=excluded.full_name,
    email=excluded.email,role='Scholar',is_active=true
  where public.profiles.role::text='Scholar';
  if not found then raise exception 'That account is already configured as staff.'; end if;

  update public.scholar_assignments set is_active=false
  where scholar_id=v_user_id and is_active=true;
  insert into public.scholar_assignments(scholar_id,program_id,assigned_by,is_active)
  values(v_user_id,v_program_id,auth.uid(),true)
  on conflict(scholar_id,program_id) do update
    set assigned_by=auth.uid(),is_active=true,assigned_at=now()
  returning id into v_assignment_id;

  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'SCHOLAR_ASSIGNED','Scholar',v_user_id,
         'Assigned '||trim(p_student_id)||' to '||p_program_name);
  return v_assignment_id;
end $$;

create or replace function public.staff_submit_academic_summary(
  p_scholar_id uuid,
  p_academic_year text,
  p_semester text,
  p_gwa numeric,
  p_enrolled_units integer,
  p_failed_count integer,
  p_incomplete_count integer,
  p_dropped_count integer
)
returns uuid language plpgsql security definer set search_path=public,auth
as $$
declare v_assignment_id uuid; v_submission_id uuid;
begin
  if not public.is_scholarship_staff() then
    raise exception 'Only Scholarship Staff can submit an academic summary for a scholar.';
  end if;
  if not exists(
    select 1 from public.profiles
    where id=p_scholar_id and role::text='Scholar' and is_active
  ) then raise exception 'Scholar account not found or inactive.'; end if;
  select id into v_assignment_id from public.scholar_assignments
    where scholar_id=p_scholar_id and is_active
    order by assigned_at desc limit 1;
  if v_assignment_id is null then raise exception 'Scholar has no active scholarship assignment.'; end if;
  if p_academic_year is null or p_academic_year !~ '^[0-9]{4}-[0-9]{4}$' then
    raise exception 'School year must use the format YYYY-YYYY.';
  end if;
  if split_part(p_academic_year,'-',2)::integer <> split_part(p_academic_year,'-',1)::integer + 1
     or p_semester is null or p_semester not in ('Semester 1','Semester 2','Summer')
     or p_gwa is null or p_gwa < 1 or p_gwa > 5
     or p_enrolled_units is null or p_enrolled_units < 0
     or p_failed_count is null or p_failed_count < 0
     or p_incomplete_count is null or p_incomplete_count < 0
     or p_dropped_count is null or p_dropped_count < 0 then
    raise exception 'Check that school years are consecutive and that semester, GWA, enrolled units, and subject counts are valid.';
  end if;

  insert into public.semester_submissions(
    assignment_id,academic_year,semester,gwa,enrolled_units,
    failed_count,incomplete_count,dropped_count
  ) values (
    v_assignment_id,p_academic_year,p_semester,p_gwa,p_enrolled_units,
    p_failed_count,p_incomplete_count,p_dropped_count
  )
  returning id into v_submission_id;
  return v_submission_id;
end $$;

create or replace function public.scholar_submit_academic_summary(
  p_assignment_id uuid,
  p_academic_year text,
  p_semester text,
  p_gwa numeric,
  p_enrolled_units integer,
  p_failed_count integer,
  p_incomplete_count integer,
  p_dropped_count integer
)
returns uuid language plpgsql security definer set search_path=public,auth
as $$
declare v_submission_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in before submitting an academic summary.'; end if;
  if not exists(
    select 1 from public.profiles
    where id=auth.uid() and role::text='Scholar' and is_active
  ) then raise exception 'Only an active scholar account can submit an academic summary.'; end if;
  if not exists(
    select 1 from public.scholar_assignments
    where id=p_assignment_id and scholar_id=auth.uid() and is_active
  ) then raise exception 'No active scholarship assignment exists for this account.'; end if;
  if p_academic_year is null or p_academic_year !~ '^[0-9]{4}-[0-9]{4}$' then
    raise exception 'School year must use the format YYYY-YYYY.';
  end if;
  if split_part(p_academic_year,'-',2)::integer <> split_part(p_academic_year,'-',1)::integer + 1
     or p_semester is null or p_semester not in ('Semester 1','Semester 2','Summer')
     or p_gwa is null or p_gwa < 1 or p_gwa > 5
     or p_enrolled_units is null or p_enrolled_units < 0
     or p_failed_count is null or p_failed_count < 0
     or p_incomplete_count is null or p_incomplete_count < 0
     or p_dropped_count is null or p_dropped_count < 0 then
    raise exception 'Check that school years are consecutive and that semester, GWA, enrolled units, and subject counts are valid.';
  end if;

  insert into public.semester_submissions(
    assignment_id,academic_year,semester,gwa,enrolled_units,
    failed_count,incomplete_count,dropped_count
  ) values (
    p_assignment_id,p_academic_year,p_semester,p_gwa,p_enrolled_units,
    p_failed_count,p_incomplete_count,p_dropped_count
  )
  returning id into v_submission_id;
  return v_submission_id;
end $$;

create or replace function public.staff_edit_academic_summary(
  p_submission_id uuid,
  p_academic_year text,
  p_semester text,
  p_gwa numeric,
  p_enrolled_units integer,
  p_failed_count integer,
  p_incomplete_count integer,
  p_dropped_count integer
)
returns void language plpgsql security definer set search_path=public,auth
as $$
declare v_submission public.semester_submissions%rowtype;
begin
  if not public.is_scholarship_staff() then
    raise exception 'Only Scholarship Staff can edit an academic summary.';
  end if;
  if p_academic_year is null or p_academic_year !~ '^[0-9]{4}-[0-9]{4}$' then
    raise exception 'School year must use the format YYYY-YYYY.';
  end if;
  if split_part(p_academic_year,'-',2)::integer <> split_part(p_academic_year,'-',1)::integer + 1
     or p_semester is null or p_semester not in ('Semester 1','Semester 2','Summer')
     or p_gwa is null or p_gwa < 1 or p_gwa > 5
     or p_enrolled_units is null or p_enrolled_units < 0
     or p_failed_count is null or p_failed_count < 0
     or p_incomplete_count is null or p_incomplete_count < 0
     or p_dropped_count is null or p_dropped_count < 0 then
    raise exception 'Check that school years are consecutive and that semester, GWA, enrolled units, and subject counts are valid.';
  end if;
  select * into v_submission from public.semester_submissions
    where id=p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;

  update public.semester_submissions set
    academic_year=p_academic_year,
    semester=p_semester,
    gwa=p_gwa,
    enrolled_units=p_enrolled_units,
    failed_count=p_failed_count,
    incomplete_count=p_incomplete_count,
    dropped_count=p_dropped_count,
    verification='Pending',
    verification_reason=null,
    verified_by=null,
    verified_at=null,
    compliance='Not Evaluated',
    compliance_reasons='{}',
    evaluated_by=null,
    evaluated_at=null,
    renewal='Not Decided',
    decision_note=null,
    decided_by=null,
    decided_at=null,
    updated_at=now()
  where id=p_submission_id;
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'SUMMARY_EDITED','Submission',p_submission_id,
    'Academic summary edited; prior review and approval statuses reset.');
end $$;

create or replace function public.staff_approve_submission(p_submission_id uuid)
returns void language plpgsql security definer set search_path=public,auth
as $$
begin
  if not public.is_scholarship_staff() then
    raise exception 'Only Scholarship Staff can approve submissions.';
  end if;
  update public.semester_submissions set
    renewal='Approved',
    decision_note='Approved by Scholarship Staff.',
    decided_by=auth.uid(),
    decided_at=now(),
    updated_at=now()
  where id=p_submission_id;
  if not found then raise exception 'Submission not found.'; end if;
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'RENEWAL_APPROVED','Submission',p_submission_id,
         'Approved by Scholarship Staff.');
end $$;

create or replace function public.verify_submission(
  p_submission_id uuid,p_status text,p_notes text default ''
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not public.is_scholarship_staff() then raise exception 'Only Scholarship Staff can verify submissions.'; end if;
  if p_status not in ('Verified','Returned') then raise exception 'Invalid verification status.'; end if;
  if p_status='Returned' and length(trim(coalesce(p_notes,'')))=0 then raise exception 'Return reason is required.'; end if;
  update public.semester_submissions set verification=p_status::public.verification_status,
    verification_reason=coalesce(p_notes,''),verified_by=auth.uid(),
    verified_at=case when p_status='Verified' then now() else null end,
    compliance='Not Evaluated',compliance_reasons='{}',evaluated_by=null,evaluated_at=null,
    renewal='Not Decided',decision_note=null,decided_by=null,decided_at=null,updated_at=now()
  where id=p_submission_id;
  if not found then raise exception 'Submission not found.'; end if;
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'VERIFICATION_'||upper(p_status),'Submission',p_submission_id,
         coalesce(nullif(trim(p_notes),''),'Submission verified'));
end $$;

create or replace function public.evaluate_submission(p_submission_id uuid)
returns jsonb language plpgsql security definer set search_path=public
as $$
declare s public.semester_submissions%rowtype; p public.scholarship_programs%rowtype;
  v_reasons text[]:='{}'; v_result public.compliance_status;
begin
  if not public.is_scholarship_staff() then raise exception 'Only Scholarship Staff can evaluate submissions.'; end if;
  select * into s from public.semester_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  if s.verification<>'Verified' then
    raise exception 'Verify the submission before evaluating.';
  end if;
  select sp.* into p from public.scholarship_programs sp
    join public.scholar_assignments a on a.program_id=sp.id where a.id=s.assignment_id;
  if not found then raise exception 'Scholarship policy not found.'; end if;

  if s.gwa>p.max_gwa then v_reasons:=array_append(v_reasons,'GWA exceeds program limit.'); end if;
  if s.enrolled_units<p.min_enrolled_units then v_reasons:=array_append(v_reasons,'Insufficient enrolled units.'); end if;
  if s.failed_count>p.max_failed_count then v_reasons:=array_append(v_reasons,'Failed subject limit exceeded.'); end if;
  if s.incomplete_count>p.max_incomplete_count then v_reasons:=array_append(v_reasons,'Incomplete subject limit exceeded.'); end if;
  if s.dropped_count>p.max_dropped_count then v_reasons:=array_append(v_reasons,'Dropped subject limit exceeded.'); end if;
  if s.submitted_at>p.deadline then v_reasons:=array_append(v_reasons,'Submission was late.'); end if;

  v_result:=case when cardinality(v_reasons)=0 then 'Compliant'::public.compliance_status
                 else 'With Deficiency'::public.compliance_status end;
  update public.semester_submissions set compliance=v_result,compliance_reasons=v_reasons,
    evaluated_by=auth.uid(),evaluated_at=now(),renewal='Not Decided',
    decision_note=null,decided_by=null,decided_at=null,updated_at=now()
  where id=s.id;
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'EVALUATED','Submission',s.id,v_result||': '||array_to_string(v_reasons,'; '));
  return jsonb_build_object('compliance_status',v_result,'deficiencies',to_jsonb(v_reasons));
end $$;

create or replace function public.record_renewal(
  p_submission_id uuid,p_decision text,p_note text
)
returns void language plpgsql security definer set search_path=public
as $$
declare s public.semester_submissions%rowtype;
begin
  if not public.is_scholarship_staff() then raise exception 'Only Scholarship Staff can record renewal decisions.'; end if;
  if p_decision not in ('Approved','Held') then raise exception 'Decision must be Approved or Held.'; end if;
  if length(trim(coalesce(p_note,'')))=0 then raise exception 'Decision note is required.'; end if;
  select * into s from public.semester_submissions where id=p_submission_id for update;
  if not found then raise exception 'Submission not found.'; end if;
  if s.verification<>'Verified' then raise exception 'Verify the submission before recording a decision.'; end if;
  if s.compliance='Not Evaluated' then raise exception 'Evaluate compliance before recording a decision.'; end if;
  if p_decision='Approved' and s.compliance<>'Compliant' then raise exception 'Cannot approve a submission with deficiencies.'; end if;
  update public.semester_submissions set renewal=p_decision::public.renewal_status,
    decision_note=trim(p_note),decided_by=auth.uid(),decided_at=now(),updated_at=now()
  where id=s.id;
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'RENEWAL_'||upper(p_decision),'Submission',s.id,trim(p_note));
end $$;

drop function if exists public.scholar_resubmit_returned(uuid,numeric,integer,integer,integer,integer,text);
create or replace function public.scholar_resubmit_returned(
  p_submission_id uuid,p_gwa numeric,p_units integer,p_failed integer,
  p_incomplete integer,p_dropped integer
)
returns void language plpgsql security definer set search_path=public
as $$
begin
  if not exists(select 1 from public.semester_submissions s
    join public.scholar_assignments a on a.id=s.assignment_id
    where s.id=p_submission_id and s.verification='Returned' and a.scholar_id=auth.uid()) then
    raise exception 'Only your own Returned submission can be corrected.';
  end if;
  if p_gwa<1 or p_gwa>5 or p_units<0 or p_failed<0 or p_incomplete<0 or p_dropped<0
    then raise exception 'Invalid corrected values.'; end if;
  update public.semester_submissions set gwa=p_gwa,enrolled_units=p_units,
    failed_count=p_failed,incomplete_count=p_incomplete,dropped_count=p_dropped,
    submitted_at=now(),verification='Pending',
    verification_reason=null,verified_by=null,verified_at=null,compliance='Not Evaluated',
    compliance_reasons='{}',evaluated_by=null,evaluated_at=null,renewal='Not Decided',
    decision_note=null,decided_by=null,decided_at=null,updated_at=now()
  where id=p_submission_id;
  insert into public.audit_logs(actor_id,action,module,record_id,description)
  values(auth.uid(),'RESUBMITTED','Submission',p_submission_id,'Corrected and resubmitted; pending verification.');
end $$;

alter table public.profiles enable row level security;
alter table public.scholarship_programs enable row level security;
alter table public.scholar_assignments enable row level security;
alter table public.semester_submissions enable row level security;
alter table public.audit_logs enable row level security;

do $$
declare p record;
begin
  for p in select tablename,policyname from pg_policies where schemaname='public'
    and tablename in ('profiles','scholarship_programs','scholar_assignments','semester_submissions','audit_logs')
  loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;

create policy profiles_self_or_staff on public.profiles for select to authenticated
using (id=auth.uid() or public.is_scholarship_staff());
create policy programs_authenticated_read on public.scholarship_programs for select to authenticated
using (true);
create policy assignments_self_or_staff on public.scholar_assignments for select to authenticated
using (scholar_id=auth.uid() or public.is_scholarship_staff());
create policy submissions_self_or_staff on public.semester_submissions for select to authenticated
using (public.is_scholarship_staff() or exists(
  select 1 from public.scholar_assignments a where a.id=assignment_id and a.scholar_id=auth.uid()
));
create policy scholar_insert_own_submission on public.semester_submissions for insert to authenticated
with check (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.role::text='Scholar' and p.is_active)
  and exists(select 1 from public.scholar_assignments a where a.id=assignment_id and a.scholar_id=auth.uid() and a.is_active)
  and verification='Pending' and compliance='Not Evaluated' and renewal='Not Decided'
);
create policy audit_staff_read on public.audit_logs for select to authenticated
using (public.is_scholarship_staff());

grant usage on schema public to authenticated;
grant select on public.profiles,public.scholarship_programs,public.scholar_assignments,
  public.semester_submissions,public.audit_logs to authenticated;
grant insert on public.semester_submissions to authenticated;

revoke all on function public.staff_register_scholar(text,text,text,text) from public;
revoke all on function public.staff_submit_academic_summary(uuid,text,text,numeric,integer,integer,integer,integer) from public;
revoke all on function public.staff_edit_academic_summary(uuid,text,text,numeric,integer,integer,integer,integer) from public;
revoke all on function public.staff_approve_submission(uuid) from public;
revoke all on function public.scholar_submit_academic_summary(uuid,text,text,numeric,integer,integer,integer,integer) from public;
revoke all on function public.verify_submission(uuid,text,text) from public;
revoke all on function public.evaluate_submission(uuid) from public;
revoke all on function public.record_renewal(uuid,text,text) from public;
revoke all on function public.scholar_resubmit_returned(uuid,numeric,integer,integer,integer,integer) from public;
grant execute on function public.staff_register_scholar(text,text,text,text) to authenticated;
grant execute on function public.staff_submit_academic_summary(uuid,text,text,numeric,integer,integer,integer,integer) to authenticated;
grant execute on function public.staff_edit_academic_summary(uuid,text,text,numeric,integer,integer,integer,integer) to authenticated;
grant execute on function public.staff_approve_submission(uuid) to authenticated;
grant execute on function public.scholar_submit_academic_summary(uuid,text,text,numeric,integer,integer,integer,integer) to authenticated;
grant execute on function public.verify_submission(uuid,text,text) to authenticated;
grant execute on function public.evaluate_submission(uuid) to authenticated;
grant execute on function public.record_renewal(uuid,text,text) to authenticated;
grant execute on function public.scholar_resubmit_returned(uuid,numeric,integer,integer,integer,integer) to authenticated;

-- Bootstrap the first staff profile for an existing Auth user.
do $$
declare v_staff_email text := 'SMS@gmail.com'; v_user_id uuid; v_email text;
begin
  select id,email into v_user_id,v_email from auth.users
  where lower(email)=lower(trim(v_staff_email));
  if v_user_id is null then
    raise notice 'No Auth account found for %. Create the account first, then re-run this SQL.',v_staff_email;
    return;
  end if;
  insert into public.profiles(id,full_name,email,role,is_active)
  values(v_user_id,'Scholarship Staff',v_email,'Scholarship Staff',true)
  on conflict(id) do update
  set email=excluded.email,role='Scholarship Staff',is_active=true;
end $$;

notify pgrst, 'reload schema';
