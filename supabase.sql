-- Ejecutar una vez en Supabase > SQL Editor.
-- Una sola tabla guarda tareas, links, notas y la configuración (campo "kind").

create table if not exists public.flujo_items (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('task','link','note','config')),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists flujo_items_user_kind_idx on public.flujo_items (user_id, kind);

alter table public.flujo_items enable row level security;

drop policy if exists "flujo_items_owner_all" on public.flujo_items;
create policy "flujo_items_owner_all" on public.flujo_items
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Después: Authentication > Users > "Add user" para crear tu usuario,
-- y en Authentication > Providers > Email desactivá "Allow new users to sign up".
