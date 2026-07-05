-- Настройка Supabase для «Архива»: выполни один раз в своём проекте
-- (supabase.com → твой проект → SQL Editor → New query → вставь → Run).
-- Создаёт таблицу с одним архивом на пользователя и включает row-level
-- security: каждый видит и меняет только свою строку.

create table if not exists public.archives (
  user_id uuid primary key references auth.users (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.archives enable row level security;

create policy "own archive select" on public.archives
  for select using (auth.uid() = user_id);
create policy "own archive insert" on public.archives
  for insert with check (auth.uid() = user_id);
create policy "own archive update" on public.archives
  for update using (auth.uid() = user_id);
create policy "own archive delete" on public.archives
  for delete using (auth.uid() = user_id);
