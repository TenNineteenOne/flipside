-- Convert NOT_FOUND sentinel values back to NULL for retry
UPDATE listened_artists
SET spotify_artist_id = NULL
WHERE spotify_artist_id = 'NOT_FOUND';
