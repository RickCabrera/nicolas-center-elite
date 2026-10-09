-- 0010 · DEP-06 · Respaldos restaurables.
-- pg_restore ejecuta con search_path vacío; las expresiones de columnas generadas e índices deben usar
-- nombres completos. norm() llamaba a f_unaccent() sin esquema y la restauración fallaba.
create or replace function public.norm(text) returns text
language sql immutable parallel safe as $$ select lower(public.f_unaccent(coalesce($1, ''))) $$;
