-- 0043 — additive and safe to apply at any time, before or after the app deploy.
--
-- (a) Index for "every listened row of one user". Both existing indexes on
--     listened_artists are partial, so the exclusion read (`where user_id = $1
--     order by id limit 1000`, once per page on every generation) fell back to a
--     full table scan. Plain `create index` takes a short write lock; the table is
--     small enough today. On a big table use `create index concurrently` by hand.
--
-- (b) The 200-seed cap as a database rule. lib/api/seed-cap.ts counts and then
--     inserts, so two tabs adding at once could both pass the count. The trigger
--     locks the user's row first, so concurrent adds queue up and the second one
--     sees the first one's rows. Re-sending a seed the user already has is
--     always allowed (the routes upsert). Users already over 200 keep their rows
--     and can still remove; they cannot add. The app maps 23514 to a 400.

create index if not exists idx_listened_artists_user_id_id
  on listened_artists (user_id, id);

create or replace function enforce_seed_artist_cap() returns trigger
language plpgsql
as $$
begin
  perform 1 from users where id = new.user_id for update;
  if not exists (select 1 from seed_artists where user_id = new.user_id and artist_id = new.artist_id)
     and (select count(*) from seed_artists where user_id = new.user_id) >= 200 then
    raise exception 'seed artist cap (200) reached for user %', new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists seed_artists_cap on seed_artists;
create trigger seed_artists_cap
  before insert on seed_artists
  for each row execute function enforce_seed_artist_cap();
