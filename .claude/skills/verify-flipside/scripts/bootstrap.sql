-- VERIFICATION SCAFFOLDING. Not a migration. Never run against a real Supabase project.
--
-- Minimal stand-ins for what a Supabase project provides before the first file in
-- supabase/migrations/ runs, so those files apply unmodified to a bare Postgres.
-- Applied once by `fv launch` to an empty throwaway database.

-- The three API roles, plus the login role PostgREST connects as and switches from.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit;
grant anon, authenticated, service_role to authenticator;

-- auth.uid(): the RLS policies call it. Same definition PostgREST/Supabase use: the JWT's `sub`.
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
    ), ''
  )::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;

-- Supabase keeps extensions in an `extensions` schema. The migrations create the two they
-- need (uuid-ossp, pg_trgm) unqualified, so they land in public here; the schema only has to exist.
create schema extensions;

-- Supabase's default privileges: everything the migrations create in public is granted to the
-- three API roles (the migrations then REVOKE from anon/authenticated where they mean to).
-- Without this, service_role could not call the RPCs whose EXECUTE is revoked from PUBLIC.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
