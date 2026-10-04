create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'athlete' check (role in ('athlete', 'coach')),
  created_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''));
  return new;
end;
$$;

drop trigger if exists formsync_profile_on_signup on auth.users;
create trigger formsync_profile_on_signup
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create table if not exists public.coach_invitations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  invitee_email text not null,
  code_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_by uuid references public.profiles(user_id) on delete set null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  check (accepted_by is null or accepted_at is not null)
);

create table if not exists public.coach_access (
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete cascade,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (athlete_id, coach_id),
  check (athlete_id <> coach_id)
);

create or replace function public.has_active_coach_access(p_athlete uuid, p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.coach_access ca
    where ca.athlete_id = p_athlete
      and ca.coach_id = p_coach
      and ca.revoked_at is null
  );
$$;

create or replace function public.prevent_invitation_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
     or new.athlete_id <> old.athlete_id
     or new.invitee_email <> old.invitee_email
     or new.code_hash <> old.code_hash
     or new.created_at <> old.created_at
     or new.expires_at <> old.expires_at
     or (
       (new.accepted_by is distinct from old.accepted_by
        or new.accepted_at is distinct from old.accepted_at)
       and not (
         old.accepted_by is null
         and old.accepted_at is null
         and new.accepted_by = auth.uid()
         and new.accepted_at is not null
         and lower(coalesce(auth.jwt() ->> 'email', '')) = old.invitee_email
       )
     ) then
    raise exception 'Invitation identity fields cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists formsync_invitation_immutable on public.coach_invitations;
create trigger formsync_invitation_immutable
before update on public.coach_invitations
for each row execute function public.prevent_invitation_identity_change();

create or replace function public.prevent_coach_access_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.athlete_id <> old.athlete_id
     or new.coach_id <> old.coach_id
     or new.granted_at <> old.granted_at then
    raise exception 'Coach access identity fields cannot be changed.';
  end if;
  return new;
end;
$$;

drop trigger if exists formsync_coach_access_immutable on public.coach_access;
create trigger formsync_coach_access_immutable
before update on public.coach_access
for each row execute function public.prevent_coach_access_identity_change();

create or replace function public.create_coach_invitation(p_email text)
returns table (invitation_id uuid, invite_code uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  raw_code uuid := gen_random_uuid();
  new_id uuid := gen_random_uuid();
  normalized_email text := lower(trim(p_email));
  actor_role text;
begin
  select role into actor_role from public.profiles where user_id = auth.uid();
  if actor_role is distinct from 'athlete' then
    raise exception 'Only athlete accounts can invite a coach.';
  end if;
  if normalized_email is null or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid coach email address.';
  end if;
  insert into public.coach_invitations (
    id, athlete_id, invitee_email, code_hash, expires_at
  )
  values (
    new_id, auth.uid(), normalized_email,
    encode(extensions.digest(raw_code::text, 'sha256'), 'hex'),
    now() + interval '7 days'
  );
  return query select new_id, raw_code, now() + interval '7 days';
end;
$$;

create or replace function public.accept_coach_invitation(p_code uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.coach_invitations%rowtype;
  actor_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  actor_role text;
begin
  if auth.uid() is null or actor_email = '' then
    raise exception 'Sign in with the invited email address.';
  end if;
  select * into invite
  from public.coach_invitations
  where code_hash = encode(extensions.digest(p_code::text, 'sha256'), 'hex')
  for update;
  if not found
     or invite.revoked_at is not null
     or invite.accepted_at is not null
     or invite.expires_at <= now()
     or invite.invitee_email <> actor_email then
    raise exception 'Invitation is invalid, expired, or addressed to another email.';
  end if;
  select role into actor_role from public.profiles where user_id = auth.uid();
  if actor_role = 'athlete' and exists (
    select 1 from public.coach_access
    where coach_id = auth.uid() and revoked_at is null
  ) then
    raise exception 'This athlete account already has an active coach link.';
  end if;
  update public.profiles set role = 'coach' where user_id = auth.uid();
  insert into public.coach_access (athlete_id, coach_id)
  values (invite.athlete_id, auth.uid())
  on conflict (athlete_id, coach_id)
  do update set granted_at = now(), revoked_at = null;
  update public.coach_invitations
  set accepted_by = auth.uid(), accepted_at = now()
  where id = invite.id;
  return invite.athlete_id;
end;
$$;

create table if not exists public.coach_feedback (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete cascade,
  session_id uuid not null,
  at_seconds numeric(10, 2) not null default 0 check (at_seconds between 0 and 1800),
  body text not null check (length(trim(body)) between 1 and 2000),
  annotations jsonb not null default '[]'::jsonb
    check (jsonb_typeof(annotations) = 'array' and pg_column_size(annotations) <= 65536),
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  coach_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (team_id, athlete_id)
);

create or replace function public.is_team_coach(p_team uuid, p_coach uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.teams t
    where t.id = p_team and t.coach_id = p_coach
  );
$$;

create or replace function public.is_team_member(p_team uuid, p_athlete uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members tm
    where tm.team_id = p_team and tm.athlete_id = p_athlete
  );
$$;

create table if not exists public.workout_assignments (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete set null,
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 100),
  instructions text not null default '' check (length(instructions) <= 2000),
  sets integer not null check (sets between 1 and 30),
  reps integer not null check (reps between 1 and 1000),
  due_at date not null,
  completed_at timestamptz,
  completed_sets integer not null default 0 check (completed_sets between 0 and sets),
  created_at timestamptz not null default now()
);

create or replace function public.complete_workout_assignment(
  p_assignment uuid,
  p_completed_sets integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workout_assignments
  set completed_sets = least(sets, greatest(0, p_completed_sets)),
      completed_at = case
        when least(sets, greatest(0, p_completed_sets)) >= sets then now()
        else null
      end
  where id = p_assignment and athlete_id = auth.uid();
  if not found then
    raise exception 'Assignment not found or not owned by this athlete.';
  end if;
end;
$$;

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.profiles(user_id) on delete cascade,
  coach_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (athlete_id, coach_id),
  check (athlete_id <> coach_id)
);

create table if not exists public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(user_id) on delete cascade,
  body text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.coach_invitations enable row level security;
alter table public.coach_access enable row level security;
alter table public.coach_feedback enable row level security;
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.workout_assignments enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;

create policy "Profiles visible to self or linked coach" on public.profiles
for select to authenticated
using (
  user_id = auth.uid()
  or public.has_active_coach_access(user_id, auth.uid())
  or public.has_active_coach_access(auth.uid(), user_id)
);
create policy "Athlete sees own invitations and invitee sees matching email" on public.coach_invitations
for select to authenticated
using (athlete_id = auth.uid() or invitee_email = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy "Athlete revokes own pending invitations" on public.coach_invitations
for update to authenticated
using (athlete_id = auth.uid() and accepted_at is null)
with check (athlete_id = auth.uid() and accepted_at is null);

create policy "Linked parties see access status" on public.coach_access
for select to authenticated
using (athlete_id = auth.uid() or coach_id = auth.uid());
create policy "Athlete can revoke coach access" on public.coach_access
for update to authenticated
using (athlete_id = auth.uid())
with check (athlete_id = auth.uid());

create policy "Athlete and linked coach read timestamped feedback" on public.coach_feedback
for select to authenticated
using (
  athlete_id = auth.uid()
  or (coach_id = auth.uid() and public.has_active_coach_access(athlete_id, auth.uid()))
);
create policy "Linked coach writes timestamped feedback" on public.coach_feedback
for insert to authenticated
with check (
  coach_id = auth.uid()
  and public.has_active_coach_access(athlete_id, auth.uid())
);
create policy "Coach edits own feedback while linked" on public.coach_feedback
for update to authenticated
using (coach_id = auth.uid() and public.has_active_coach_access(athlete_id, auth.uid()))
with check (coach_id = auth.uid() and public.has_active_coach_access(athlete_id, auth.uid()));

create policy "Coach and members see team" on public.teams
for select to authenticated
using (
  coach_id = auth.uid()
  or exists (select 1 from public.team_members tm where tm.team_id = id and tm.athlete_id = auth.uid())
);
create policy "Coach manages own teams" on public.teams
for all to authenticated
using (coach_id = auth.uid())
with check (coach_id = auth.uid());

create policy "Team members see roster" on public.team_members
for select to authenticated
using (
  athlete_id = auth.uid()
  or public.is_team_coach(team_id, auth.uid())
);
create policy "Coach adds linked athlete to roster" on public.team_members
for insert to authenticated
with check (
  public.is_team_coach(team_id, auth.uid())
  and public.has_active_coach_access(athlete_id, auth.uid())
);
create policy "Coach removes roster member" on public.team_members
for delete to authenticated
using (public.is_team_coach(team_id, auth.uid()));

create policy "Athlete or assigned coach reads workout" on public.workout_assignments
for select to authenticated
using (
  athlete_id = auth.uid()
  or (coach_id = auth.uid() and public.has_active_coach_access(athlete_id, auth.uid()))
);
create policy "Coach assigns workout to linked athlete" on public.workout_assignments
for insert to authenticated
with check (
  coach_id = auth.uid()
  and public.has_active_coach_access(athlete_id, auth.uid())
  and (team_id is null or (
    public.is_team_coach(team_id, auth.uid())
    and public.is_team_member(team_id, athlete_id)
  ))
);

create policy "Participants read their conversations" on public.conversations
for select to authenticated
using (
  (athlete_id = auth.uid() and public.has_active_coach_access(athlete_id, coach_id))
  or (coach_id = auth.uid() and public.has_active_coach_access(athlete_id, coach_id))
);
create policy "Linked coach starts conversation" on public.conversations
for insert to authenticated
with check (
  (coach_id = auth.uid() or athlete_id = auth.uid())
  and public.has_active_coach_access(athlete_id, coach_id)
);

create policy "Participants read conversation messages" on public.conversation_messages
for select to authenticated
using (
  exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.athlete_id = auth.uid() or c.coach_id = auth.uid())
      and public.has_active_coach_access(c.athlete_id, c.coach_id)
  )
);
create policy "Participants send messages as themselves" on public.conversation_messages
for insert to authenticated
with check (
  sender_id = auth.uid()
  and exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and (c.athlete_id = auth.uid() or c.coach_id = auth.uid())
      and public.has_active_coach_access(c.athlete_id, c.coach_id)
  )
);

revoke all on function public.create_coach_invitation(text) from public, anon;
grant execute on function public.create_coach_invitation(text) to authenticated;
revoke all on function public.accept_coach_invitation(uuid) from public, anon;
grant execute on function public.accept_coach_invitation(uuid) to authenticated;
revoke all on function public.has_active_coach_access(uuid, uuid) from public, anon;
grant execute on function public.has_active_coach_access(uuid, uuid) to authenticated;
revoke all on function public.is_team_coach(uuid, uuid) from public, anon;
grant execute on function public.is_team_coach(uuid, uuid) to authenticated;
revoke all on function public.is_team_member(uuid, uuid) from public, anon;
grant execute on function public.is_team_member(uuid, uuid) to authenticated;
revoke all on function public.complete_workout_assignment(uuid, integer) from public, anon;
grant execute on function public.complete_workout_assignment(uuid, integer) to authenticated;

grant select on public.profiles to authenticated;
grant select, insert, update on public.coach_invitations to authenticated;
grant select, update on public.coach_access to authenticated;
grant select, insert on public.coach_feedback to authenticated;
grant select, insert, update, delete on public.teams to authenticated;
grant select, insert, delete on public.team_members to authenticated;
grant select, insert on public.workout_assignments to authenticated;
grant select, insert on public.conversations to authenticated;
grant select, insert on public.conversation_messages to authenticated;
