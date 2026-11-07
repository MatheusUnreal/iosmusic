-- =====================================================================
-- IOSMusic – várias contas (cada usuário com a própria biblioteca)
-- Rode depois do setup.sql.
-- =====================================================================

-- 1) dono de cada linha (preenchido sozinho com o usuário logado)
alter table public.tracks    add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table public.playlists add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table public.jobs      add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- dados antigos ficam com a primeira conta criada
update public.tracks    set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;
update public.playlists set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;
update public.jobs      set user_id = (select id from auth.users order by created_at limit 1) where user_id is null;

alter table public.tracks    alter column user_id set not null;
alter table public.playlists alter column user_id set not null;
alter table public.jobs      alter column user_id set not null;

-- a mesma música pode existir em contas diferentes
alter table public.tracks drop constraint if exists tracks_source_id_key;
create unique index if not exists tracks_user_source on public.tracks (user_id, source_id);
create index if not exists tracks_user on public.tracks (user_id);
create index if not exists jobs_user on public.jobs (user_id);

-- 2) cada um só vê e mexe no que é seu
drop policy if exists "logado" on public.tracks;
drop policy if exists "logado" on public.playlists;
drop policy if exists "logado" on public.jobs;
drop policy if exists "dono" on public.tracks;
drop policy if exists "dono" on public.playlists;
drop policy if exists "dono" on public.jobs;
create policy "dono" on public.tracks    for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "dono" on public.playlists for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "dono" on public.jobs      for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 3) arquivos: só abre/apaga quem é dono da música
drop policy if exists "music ler"    on storage.objects;
drop policy if exists "music apagar" on storage.objects;
create policy "music ler" on storage.objects for select to authenticated using (
  bucket_id = 'music' and exists (
    select 1 from public.tracks t
    where t.user_id = (select auth.uid()) and (t.audio_path = storage.objects.name or t.cover_path = storage.objects.name)
  )
);
create policy "music apagar" on storage.objects for delete to authenticated using (
  bucket_id = 'music' and exists (
    select 1 from public.tracks t
    where t.user_id = (select auth.uid()) and (t.audio_path = storage.objects.name or t.cover_path = storage.objects.name)
  )
);
