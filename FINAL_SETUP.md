# Dungeon Dwellers — Final Production Setup

The frontend is designed for GitHub Pages. Supabase is the source of truth for auth, campaigns, characters, maps, visibility, initiative, scene turns, reactions, chat, notification preferences, and event history.

## 1. Database migrations

Run these files in Supabase SQL Editor in this order. Existing installs can skip files already run successfully.

1. `supabase-schema.sql`
2. `supabase-final-migration.sql`
3. `supabase-final-fix.sql`
4. `supabase-final-v2.sql`
5. `supabase-final-v3.sql`
6. `supabase-final-v4.sql`

The v2 migration tightens invite membership, hides NPC private state from players, adds scene-turn submissions, notification outbox, private map views, and server-only visibility helpers. The v3 migration initializes 24-hour asynchronous Scene Turn deadlines for campaigns outside combat. The v4 migration completes server notification triggers for party mentions and campaign pause/resume.

## 2. Deploy Edge Functions

Using the Supabase CLI from the repository root:

```bash
supabase functions deploy dungeon-ai
supabase functions deploy dungeon-turns
supabase functions deploy dungeon-notifier
```

Set function secrets in Supabase. Never place the service role or VAPID private key in the browser or GitHub Pages files.

```bash
supabase secrets set DUNGEON_AI_WORKER_URL=https://dungeon-dwellers-ai.jesse-datema08.workers.dev
supabase secrets set TURN_CRON_SECRET=CHOOSE_A_LONG_RANDOM_SECRET
supabase secrets set NOTIFIER_CRON_SECRET=CHOOSE_ANOTHER_LONG_RANDOM_SECRET
supabase secrets set VAPID_PUBLIC_KEY=YOUR_PUBLIC_VAPID_KEY
supabase secrets set VAPID_PRIVATE_KEY=YOUR_PRIVATE_VAPID_KEY
supabase secrets set VAPID_SUBJECT=mailto:YOUR_EMAIL
```

Supabase automatically provides the function runtime with the project URL and service-role environment variables.

## 3. Web Push public key

Put only the **public** VAPID key in `config.js`:

```js
window.DD_VAPID_PUBLIC_KEY='YOUR_PUBLIC_VAPID_KEY';
```

The private VAPID key belongs only in Supabase function secrets.

## 4. Scheduled processors

Schedule `dungeon-turns` at least every 1–5 minutes and `dungeon-notifier` at least every 1–5 minutes. A Supabase Cron/pg_cron job, external scheduler, or trusted automation can POST to the functions. Send `x-cron-secret` using the corresponding cron secret.

`dungeon-turns` resolves asynchronous Scene Turns when everyone submits or the scene deadline expires. During combat it enforces expired 6-hour player blocks, records missed turns as doing nothing meaningful, resolves enemy blocks through the AI worker, advances the four-block sequence, and queues halfway/one-hour/open/expired/round notifications.

`dungeon-notifier` reads each player’s notification preferences and quiet hours, then sends Web Push through saved device subscriptions.

## 5. Auth redirects

Supabase Authentication URL Configuration should include:

`https://jessedatema08-ops.github.io/Dungeon-dwellers/`

Email/password is the current default sign-in method.

## 6. Campaign invitations

Campaign owners generate links from the app. Invite URLs look like:

`https://jessedatema08-ops.github.io/Dungeon-dwellers/?invite=TOKEN`

Accepting an invite can only add the signed-in user as `player`. It never grants owner/admin. The owner can create multiple campaigns and each invite is tied to one campaign.

## 7. Security model

- Publishable Supabase key may be in the frontend.
- Secret/service-role key must never be in frontend files.
- Owner controls render only for campaign owners.
- Private NPC state is server/owner-only.
- Player-specific map views and hidden-token visibility are stored per authenticated user.
- AI orchestration runs through `dungeon-ai` so hidden state and visibility updates can be applied server-side without exposing service credentials.
- Player-facing dice are generated in the app with `crypto.getRandomValues`.
