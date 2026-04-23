-- Shared server-side cache for Last.fm lookups
-- kind = 'tag_top' stores top artists for a genre tag (payload = string[] of names)
-- kind = 'similar' stores artist.getSimilar results (payload = [{ name, match }])
-- TTL is enforced in app code; the fetched_at index keeps it cheap to sweep.
create table if not exists lastfm_cache (
  kind text not null,
  key text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  primary key (kind, key)
);

create index if not exists lastfm_cache_fetched_at_idx
  on lastfm_cache(fetched_at);

-- Cache rows are shared across users; only service_role touches this table.
alter table lastfm_cache enable row level security;
