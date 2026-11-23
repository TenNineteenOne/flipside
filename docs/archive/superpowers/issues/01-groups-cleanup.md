# Issue 01 — Groups Cleanup

**Type:** AFK
**Blocked by:** None — start immediately

## What to build

Remove all Groups-related code from the codebase. Groups is a removed feature; its routes, pages, components, and side-effects are dead code that creates confusion.

Delete or gut the following:

- `app/join/[code]/` — entire directory
- `app/(app)/groups/` — entire directory (including `[id]/`)
- `app/api/groups/` — entire directory (all group management endpoints)
- `components/groups/` — entire directory
- `components/feed/group-activity-badge.tsx`
- `lib/groups.ts`

In the feedback route (`app/api/feedback/route.ts`): remove the block that fetches the user's groups and creates `group_activity` rows on thumbs_up. Keep the `feedback` table upsert and the `seen_at` update — those are still needed.

Do not touch the `group_activity` table itself in the database (leave schema as-is, just stop writing to it).

## Acceptance criteria

- [ ] Navigating to `/join/anything` returns a 404
- [ ] Navigating to `/groups` returns a 404
- [ ] All `/api/groups/**` endpoints return 404
- [ ] Posting a thumbs_up to `/api/feedback` no longer creates any `group_activity` rows
- [ ] No Groups import or reference remains in any file outside of database migration files
- [ ] The app builds without errors (`next build`)

## Blocked by

None — can start immediately.

## User stories addressed

- Story 63: Groups-related API routes removed
- Story 64: Feedback route stops creating `group_activity` rows
- Story 65: `/join/[code]` route deleted
- Story 66: Groups removed from nav everywhere
