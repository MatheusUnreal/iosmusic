-- =====================================================================
-- IOSMusic – configuração do Supabase
-- Cole TUDO no Supabase → SQL Editor → Run.
-- Depois rode o bloco do final (github) com seus dados.
-- =====================================================================

create extension if not exists pg_net;

-- ------------------------------------------------------------ tabelas
create table if not exists public.tracks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  artist      text not null default '',
  album       text not null default '',
  duration    int  not null default 0,
  source_url  text,
  source_id   text unique,
  audio_path  text not null,
  cover_path  text,
  size        bigint,
  added_at    timestamptz not null default now()
);

create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  track_ids   uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);

create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  url         text not null,
  playlist_id uuid references public.playlists(id) on delete set null,
  status      text not null default 'queued',  -- queued | downloading | converting | uploading | done | error
  progress    int  not null default 0,
  title       text,
  error       text,
  note        text,
  track_id    uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Só quem fez login (você) acessa. Desative novos cadastros no painel!
alter table public.tracks    enable row level security;
alter table public.playlists enable row level security;
alter table public.jobs      enable row level security;

drop policy if exists "logado" on public.tracks;
drop policy if exists "logado" on public.playlists;
drop policy if exists "logado" on public.jobs;
create policy "logado" on public.tracks    for all to authenticated using (true) with check (true);
create policy "logado" on public.playlists for all to authenticated using (true) with check (true);
create policy "logado" on public.jobs      for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------ armazenamento
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music', 'music', false, 52428800, array['audio/mp4', 'image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "music ler"    on storage.objects;
drop policy if exists "music apagar" on storage.objects;
create policy "music ler"    on storage.objects for select to authenticated using (bucket_id = 'music');
create policy "music apagar" on storage.objects for delete to authenticated using (bucket_id = 'music');

-- ------------------------------------------------------------ gatilho → GitHub Actions
-- Quando um link é adicionado, o banco avisa o GitHub para rodar o baixador.
-- O token do GitHub fica num schema privado, que o app não consegue ler.
create schema if not exists private;
revoke all on schema private from anon, authenticated;

create table if not exists private.config (key text primary key, value text not null);

create or replace function private.dispatch_download()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  repo text;
  tok  text;
begin
  select value into repo from private.config where key = 'github_repo';
  select value into tok  from private.config where key = 'github_token';
  if repo is null or tok is null then
    return null;
  end if;
  perform net.http_post(
    url     := 'https://api.github.com/repos/' || repo || '/actions/workflows/download.yml/dispatches',
    body    := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'iosmusic',
      'Content-Type', 'application/json'
    )
  );
  return null;
end;
$$;

drop trigger if exists jobs_dispatch on public.jobs;
create trigger jobs_dispatch
  after insert on public.jobs
  for each statement
  execute function private.dispatch_download();

-- =====================================================================
-- ÚLTIMO PASSO: troque os valores abaixo e rode só este bloco.
--   github_repo  → seu-usuario/nome-do-repositorio
--   github_token → token "fine-grained" do GitHub (veja o README)
-- =====================================================================
-- insert into private.config (key, value) values
--   ('github_repo',  'SEU-USUARIO/iosmusic'),
--   ('github_token', 'github_pat_COLE_AQUI')
-- on conflict (key) do update set value = excluded.value;
