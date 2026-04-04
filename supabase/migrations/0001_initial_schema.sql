-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- users
create table users (
  id uuid primary key default uuid_generate_v4(),
  spotify_id text unique not null,
  display_name text,
  avatar_url text,
  play_threshold int not null default 0,
  flipside_playlist_id text,
  lastfm_username text,
  created_at timestamptz not null default now()
);

-- groups
create table groups (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  invite_code text unique not null,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now()
);

-- group_members
create table group_members (
  id uuid primary key default uuid_generate_v4(),
  group_id uuid not null references groups(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique(group_id, user_id)
);

-- seed_artists (onboarding cold-start)
create table seed_artists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  spotify_artist_id text not null,
  name text not null,
  image_url text,
  added_at timestamptz not null default now(),
  unique(user_id, spotify_artist_id)
);

-- listened_artists (accumulated play history — never exposed to groups)
create table listened_artists (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  spotify_artist_id text,
  lastfm_artist_name text,
  source text not null check (source in ('spotify_recent', 'spotify_top', 'lastfm')),
  play_count int not null default 1,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(user_id, spotify_artist_id)
);

-- recommendation_cache
create table recommendation_cache (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  spotify_artist_id text not null,
  artist_data jsonb not null,
  score float not null default 0,
  why jsonb not null default '{}',
  seen_at timestamptz,
  expires_at timestamptz not null,
  source text not null default 'spotify_recommendations',
  created_at timestamptz not null default now(),
  unique(user_id, spotify_artist_id)
);

-- feedback
create table feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  spotify_artist_id text not null,
  signal text not null check (signal in ('thumbs_up', 'thumbs_down')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique(user_id, spotify_artist_id)
);

-- saves
create table saves (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  spotify_artist_id text not null,
  spotify_track_id text not null,
  created_at timestamptz not null default now()
);

-- group_activity (persists after member leaves)
create table group_activity (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id),
  group_id uuid not null references groups(id) on delete cascade,
  spotify_artist_id text not null,
  artist_name text not null,
  action_type text not null check (action_type in ('thumbs_up', 'save')),
  created_at timestamptz not null default now()
);

-- Indexes
create index on recommendation_cache(user_id, expires_at);
create index on feedback(user_id, spotify_artist_id);
create index on listened_artists(user_id, spotify_artist_id);
create index on group_activity(group_id, created_at desc);
create index on group_members(user_id);

-- RLS Policies

-- users: own row only
alter table users enable row level security;
create policy "users: own row" on users for all using (auth.uid()::text = spotify_id);

-- groups: members can read, creator can update
alter table groups enable row level security;
create policy "groups: members can read" on groups for select
  using (exists (select 1 from group_members where group_id = groups.id and user_id = (select id from users where spotify_id = auth.uid()::text)));
create policy "groups: creator can update" on groups for update
  using ((select id from users where spotify_id = auth.uid()::text) = created_by);
create policy "groups: authenticated can insert" on groups for insert
  with check (auth.uid() is not null);

-- group_members: members can read
alter table group_members enable row level security;
create policy "group_members: members can read" on group_members for select
  using (exists (select 1 from group_members gm where gm.group_id = group_members.group_id and gm.user_id = (select id from users where spotify_id = auth.uid()::text)));
create policy "group_members: own insert" on group_members for insert
  with check ((select id from users where spotify_id = auth.uid()::text) = user_id);
create policy "group_members: own delete" on group_members for delete
  using ((select id from users where spotify_id = auth.uid()::text) = user_id);

-- seed_artists: own rows only
alter table seed_artists enable row level security;
create policy "seed_artists: own rows" on seed_artists for all
  using ((select id from users where spotify_id = auth.uid()::text) = user_id);

-- listened_artists: own rows only, NEVER group-readable
alter table listened_artists enable row level security;
create policy "listened_artists: own rows" on listened_artists for all
  using ((select id from users where spotify_id = auth.uid()::text) = user_id);

-- recommendation_cache: own rows only
alter table recommendation_cache enable row level security;
create policy "recommendation_cache: own rows" on recommendation_cache for all
  using ((select id from users where spotify_id = auth.uid()::text) = user_id);

-- feedback: own rows only
alter table feedback enable row level security;
create policy "feedback: own rows" on feedback for all
  using ((select id from users where spotify_id = auth.uid()::text) = user_id);

-- saves: own rows only
alter table saves enable row level security;
create policy "saves: own rows" on saves for all
  using ((select id from users where spotify_id = auth.uid()::text) = user_id);

-- group_activity: group members can read, own inserts
alter table group_activity enable row level security;
create policy "group_activity: members can read" on group_activity for select
  using (exists (select 1 from group_members where group_id = group_activity.group_id and user_id = (select id from users where spotify_id = auth.uid()::text)));
create policy "group_activity: own insert" on group_activity for insert
  with check ((select id from users where spotify_id = auth.uid()::text) = user_id);
