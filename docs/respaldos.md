# Respaldos y restauración (DEP-06)

Dos capas:

1. **Respaldo automático del proveedor (Supabase).** Supabase respalda la base diariamente según el plan
   contratado; la recuperación a un punto en el tiempo es un complemento de pago. Revisar en
   **Database → Backups** qué incluye el plan y cuántos días conserva. Los archivos del bucket no forman parte
   de ese respaldo de la base.
2. **Respaldo propio, base y archivos juntos**, con el script del repositorio. Recomendado cada semana y antes de
   cada cambio importante, guardado fuera de Supabase (disco externo o nube de la clínica).

## Respaldo propio

En una computadora con PostgreSQL 16+ (`pg_dump`, `pg_restore`) y un `.env.local` con `DIRECT_DATABASE_URL`,
`STORAGE_DRIVER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_BUCKET`:

```
pnpm backup                    # crea respaldos/AAAA-MM-DD_HHMM/ con base.dump, archivos/ y manifiesto.json
pnpm backup:check respaldos/AAAA-MM-DD_HHMM   # restaura en una base temporal y compara conteos y archivos
```

`manifiesto.json` guarda los conteos por tabla, la huella SHA-256 del volcado y los archivos que no se pudieron
copiar. La carpeta contiene datos clínicos: guardarla cifrada y con acceso restringido.

## Prueba de restauración realizada

Se ejecutó `pnpm backup` y `pnpm backup:check` contra la base de demostración: 13 tablas con conteos idénticos, la seguridad por fila funcionando en la base restaurada
(incluidas 390 filas de bitácora) y 22 de 22 archivos. La prueba encontró que la columna de búsqueda de pacientes
no se restauraba; se corrigió en `db/migrations/0010_restorable_functions.sql`.

## Restaurar en producción

1. Crear un proyecto nuevo de Supabase (no sobrescribir el actual hasta verificar).
2. Crear el rol de la aplicación (las políticas de seguridad lo usan) y restaurar conservando los permisos:
   ```
   psql "<DIRECT_DATABASE_URL nueva>" -c "create role nce_app nologin; grant nce_app to current_user;"
   pg_restore --no-owner --dbname "<DIRECT_DATABASE_URL nueva>" base.dump
   ```
   (Los avisos sobre roles propios de Supabase que ya existen se pueden ignorar.)
3. Subir `archivos/` al bucket `estudios` del proyecto nuevo, conservando las rutas.
4. Cambiar en Vercel `DATABASE_URL`, `DIRECT_DATABASE_URL`, `SUPABASE_*` y volver a desplegar
   (las migraciones confirman que el esquema está al día).
5. Entrar como dueño y revisar un expediente con estudios.
