-- Phase 2: Auth pivot — username-only HMAC auth
-- Add username_hash for credentials-based login (HMAC-SHA256 of username)
alter table users add column if not exists username_hash text;
create unique index if not exists users_username_hash_key on users (username_hash)
  where username_hash is not null;

-- Add flag for users authorized to use Spotify OAuth
alter table users add column if not exists spotify_authorized boolean not null default false;

-- Make spotify_id nullable: existing Spotify users keep their ID;
-- new username-only users will have null spotify_id
alter table users alter column spotify_id drop not null;
