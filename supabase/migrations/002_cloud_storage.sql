-- Run 001_phase8_collaboration.sql first. Then run this file in SQL Editor.
insert into public.profiles(user_id, display_name)
select id, coalesce(raw_user_meta_data->>'name','') from auth.users
on conflict(user_id) do nothing;

create table if not exists public.formsync_media (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(length(name) between 1 and 200),
  type text not null check(type in ('video/mp4','video/webm','video/quicktime')),
  size bigint not null check(size between 1 and 104857600),
  playback_size bigint not null default 0 check(playback_size between 0 and 104857600),
  has_original boolean not null default true,
  state text not null default 'uploading' check(state in ('uploading','processing','ready','failed','cancelled')),
  error text,
  info jsonb,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  unique(id,owner_id)
);
create table if not exists public.formsync_sessions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  media_id uuid not null,
  revision uuid not null,
  body jsonb not null check(octet_length(body::text) <= 1048576),
  foreign key(media_id,owner_id) references public.formsync_media(id,owner_id)
);
create table if not exists public.formsync_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision text not null,
  body jsonb not null check(octet_length(body::text)<=8388608 and body->>'revision' is not distinct from revision)
);
create or replace function public.formsync_validate_session()
returns trigger language plpgsql set search_path='' as $$
declare media_state text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_id::text));
  select state into media_state from public.formsync_media where id=new.media_id and owner_id=new.owner_id for share;
  if media_state is distinct from 'ready' then raise exception 'Video is not ready to save.'; end if;
  if new.body->>'id' is distinct from new.id::text or new.body->>'ownerId' is distinct from new.owner_id::text
    or new.body->>'videoId' is distinct from new.media_id::text or new.body->>'revision' is distinct from new.revision::text
  then raise exception 'Invalid session identity.'; end if;
  if tg_op='INSERT' and (select count(*) from public.formsync_sessions where owner_id=new.owner_id)>=100
  then raise exception 'The cloud workspace allows up to 100 sessions.'; end if;
  return new;
end $$;
drop trigger if exists formsync_session_validate on public.formsync_sessions;
create trigger formsync_session_validate before insert or update on public.formsync_sessions
for each row execute function public.formsync_validate_session();

create or replace function public.formsync_validate_media()
returns trigger language plpgsql set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.owner_id::text));
  if tg_op='INSERT' and (select count(*) from public.formsync_media where owner_id=new.owner_id and state in ('uploading','processing'))>=10
  then raise exception 'Finish or cancel an existing upload before starting another.'; end if;
  if tg_op='UPDATE' and (new.owner_id<>old.owner_id or new.id<>old.id) then raise exception 'Video identity cannot change.'; end if;
  if new.state='cancelled' and exists(select 1 from public.formsync_sessions where media_id=new.id)
  then raise exception 'Delete linked sessions before deleting this video.'; end if;
  if (select coalesce(sum(size+playback_size),0) from public.formsync_media where owner_id=new.owner_id and id<>new.id and state<>'cancelled')
     +new.size+new.playback_size>2147483648
  then raise exception 'The cloud workspace storage limit is 2 GB.'; end if;
  return new;
end $$;
drop trigger if exists formsync_media_validate on public.formsync_media;
create trigger formsync_media_validate before insert or update on public.formsync_media
for each row execute function public.formsync_validate_media();
alter table public.formsync_media enable row level security;
alter table public.formsync_sessions enable row level security;
alter table public.formsync_workspaces enable row level security;

drop policy if exists formsync_media_read on public.formsync_media;
create policy formsync_media_read on public.formsync_media for select to authenticated
using(owner_id=auth.uid() or public.has_active_coach_access(owner_id,auth.uid()));
drop policy if exists formsync_media_write on public.formsync_media;
create policy formsync_media_write on public.formsync_media for all to authenticated
using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists formsync_sessions_read on public.formsync_sessions;
create policy formsync_sessions_read on public.formsync_sessions for select to authenticated
using(owner_id=auth.uid() or public.has_active_coach_access(owner_id,auth.uid()));
drop policy if exists formsync_sessions_write on public.formsync_sessions;
create policy formsync_sessions_write on public.formsync_sessions for all to authenticated
using(owner_id=auth.uid()) with check(owner_id=auth.uid());
drop policy if exists formsync_workspaces_read on public.formsync_workspaces;
create policy formsync_workspaces_read on public.formsync_workspaces for select to authenticated
using(owner_id=auth.uid() or public.has_active_coach_access(owner_id,auth.uid()));
drop policy if exists formsync_workspaces_write on public.formsync_workspaces;
create policy formsync_workspaces_write on public.formsync_workspaces for all to authenticated
using(owner_id=auth.uid()) with check(owner_id=auth.uid());
grant select,insert,update,delete on public.formsync_media,public.formsync_sessions,public.formsync_workspaces to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('formsync-videos','formsync-videos',false,104857600,array['video/mp4','video/webm','video/quicktime'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists formsync_video_read on storage.objects;
create policy formsync_video_read on storage.objects for select to authenticated
using(bucket_id='formsync-videos' and exists(
  select 1 from public.formsync_media m
  where m.owner_id::text=(storage.foldername(storage.objects.name))[1] and m.id::text=(storage.foldername(storage.objects.name))[2]
  and (m.owner_id=auth.uid() or public.has_active_coach_access(m.owner_id,auth.uid()))
));
drop policy if exists formsync_video_insert on storage.objects;
create policy formsync_video_insert on storage.objects for insert to authenticated
with check(bucket_id='formsync-videos' and (storage.foldername(storage.objects.name))[1]=auth.uid()::text
and exists(select 1 from public.formsync_media m where m.owner_id=auth.uid() and m.id::text=(storage.foldername(storage.objects.name))[2]));
drop policy if exists formsync_video_update on storage.objects;
create policy formsync_video_update on storage.objects for update to authenticated
using(bucket_id='formsync-videos' and (storage.foldername(storage.objects.name))[1]=auth.uid()::text)
with check(bucket_id='formsync-videos' and (storage.foldername(storage.objects.name))[1]=auth.uid()::text);
drop policy if exists formsync_video_delete on storage.objects;
create policy formsync_video_delete on storage.objects for delete to authenticated
using(bucket_id='formsync-videos' and (storage.foldername(storage.objects.name))[1]=auth.uid()::text);
