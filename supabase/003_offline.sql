-- IOSMusic – lembra quais músicas cada usuário quer no iPhone (offline).
-- Ao entrar de novo, ou em outro aparelho, o app baixa essas músicas sozinho.
alter table public.tracks add column if not exists offline boolean not null default false;
