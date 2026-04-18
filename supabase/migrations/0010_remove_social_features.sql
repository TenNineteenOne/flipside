-- Drop group tables (cascade handles FK references)
drop table if exists group_activity cascade;
drop table if exists group_members cascade;
drop table if exists groups cascade;

-- Remove PII columns from users that will be replaced by HMAC auth
alter table users drop column if exists display_name;
alter table users drop column if exists avatar_url;
