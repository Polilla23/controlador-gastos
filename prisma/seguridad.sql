-- Cierra el acceso público a la base.
--
-- Supabase expone automáticamente todo el esquema `public` como API REST, usando
-- los roles `anon` y `authenticated`. La clave `anon` viaja en el JavaScript del
-- navegador, o sea que es pública: si esos roles tienen permisos, cualquiera
-- puede leer y modificar los datos de todos los usuarios sin pasar por la app.
--
-- Esta app NO usa esa API: habla con Postgres directamente por Prisma, con el rol
-- dueño de las tablas. Así que los roles públicos no necesitan ningún permiso.
--
-- Hay que volver a correrlo después de cada `prisma db push` que cree tablas
-- nuevas (el script `npm run db:push` ya lo encadena).

-- 1) Sacarles todos los permisos sobre lo que ya existe.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all routines in schema public from anon, authenticated;

-- 2) Que las tablas que se creen más adelante tampoco los reciban.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on routines from anon, authenticated;

-- 3) Segunda barrera: RLS activo y sin políticas significa "nadie entra por la
--    API". El rol dueño de las tablas, que es el que usa Prisma, no se ve afectado.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;
