-- Ejecutar UNA vez en Supabase > SQL Editor si ya habías creado la tabla flujo_items
-- con la versión anterior de la app. Agrega el tipo "category" (categorías con color).

alter table public.flujo_items drop constraint if exists flujo_items_kind_check;
alter table public.flujo_items add constraint flujo_items_kind_check
  check (kind in ('task','link','note','config','category'));
