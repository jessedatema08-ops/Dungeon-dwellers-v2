# Dungeon Dwellers production setup

The GitHub Pages frontend is wired to Supabase Auth, Realtime, Storage, campaign invites, player-scoped map visibility, asynchronous Scene Turns, Initiative Blocks, and notification preferences.

## 1. Upgrade the existing Supabase database

In Supabase -> SQL Editor, run these files in this order:

1. `supabase-final-migration.sql`
2. `supabase-final-fix.sql`
3. `supabase-notification-queue.sql`
4. `supabase-scene-turns.sql`

The invite RPC always joins the authenticated user as `player`; it never grants `owner`.

## 2. Deploy the Edge Functions

Deploy these folders with the Supabase CLI or Dashboard function deployment workflow:

- `supabase/functions/push-dispatch`
- `supabase/functions/notification-drain`
- `supabase/functions/daily-digest`
- `supabase/functions/campaign-tick`
- `supabase/functions/vision-refresh`

Required function secrets:

- `DD_AI_URL=https://dungeon-dwellers-ai.jesse-datema08.workers.dev`
- `DD_PUSH_SECRET=<long random secret>`
- `DD_TICK_SECRET=<different long random secret>`
- `VAPID_PUBLIC_KEY=<web-push public key>`
- `VAPID_PRIVATE_KEY=<web-push private key>`
- `VAPID_SUBJECT=mailto:<your email>`

Supabase supplies `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` inside Edge Functions. Never place the service-role key in the GitHub Pages frontend.

Generate a VAPID pair with a trusted Web Push tool such as `npx web-push generate-vapid-keys --json`. Put only the PUBLIC key into `config.js` as `window.DD_VAPID_PUBLIC_KEY`. Keep the private key only in Supabase function secrets.

## 3. Schedule server jobs

Use Supabase Cron to invoke:

- `campaign-tick` every 1 minute. This resolves expired/fully-submitted Scene Turns, advances 6-hour player Initiative Blocks, skips empty blocks, resolves enemy blocks through the AI provider, and sends halfway/one-hour/expiration reminders.
- `notification-drain` every 1 minute. This delivers queued reaction, mention, pause/resume, scene, and major-character notifications according to each player's settings.
- `daily-digest` once per day at the time you choose for Digest users.

Pass `x-dd-tick-secret` with the value of `DD_TICK_SECRET` when invoking scheduled functions if your scheduling method supports custom headers.

## 4. Player workflow

The Campaign Owner creates a campaign and presses **Invite Player**. The generated URL has `?invite=<token>`. A friend opens the URL, creates/signs into their own account, and the database RPC adds them to only that campaign with role `player`.

Each campaign has separate membership. The owner can create additional campaigns and send a different invite URL for each.

## 5. Map behavior

The owner may upload a PNG/JPG/WebP map or use the built-in generated map. There is no manual map editor. Hidden tokens are protected by RLS. `vision-refresh` sends the current player's senses, position, scene state, and hidden-token state to the AI visibility adjudicator and writes only that player's `token_visibility` and `map_views` records. The browser renders the player-safe result.

## 6. Turn behavior

Outside combat, the app uses Scene Turns. Players may freely ask the AI DM rules/known-information questions and use party chat, but meaningful scene actions are submitted once per Scene Turn. The server resolves early when everyone submits or at the deadline.

Combat order is always built from rolled initiative:

1. First `ceil(players / 2)` players, sorted by initiative
2. First `ceil(enemies / 2)` enemies, sorted by initiative
3. Remaining players
4. Remaining enemies

Empty blocks are skipped. Player combat blocks are 6 real-world hours. Enemy blocks resolve through the AI DM. A combat round remains 6 seconds in-world. Reaction windows are 1 real-world hour.

## 7. Dice

`dice-engine.js` supports arbitrary mixed expressions such as `1d20`, `2d6+4`, `8d6`, `1d4+1d8+5`, `d100`, and other dice up to configured safety limits. Advantage/disadvantage d20 rolls visibly show both dice and the kept die. Player-facing AI roll requests open the same app-owned roller. The center d20 button is always available as a free fallback roller.
