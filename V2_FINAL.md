# Dungeon Dwellers V2

Dungeon Dwellers V2 moves normal gameplay from free-form AI mechanics to authoritative structured game state.

## Gameplay core

- D&D 5e 2024-oriented character action catalog for weapons, attacks, spells, features, items, core actions, rests, reactions, death saves, initiative, equipment, transfers, and level eligibility.
- Player-facing rolls are explicit app rolls. The AI never supplies a player's result.
- Structured actions resolve through Supabase before the AI narrates the already-established result.
- AI-gated initiative, initiative blocks, explicit End My Turn, automatic enemy blocks, hidden enemy rolls, and automatic combat ending.

## Maps

- Persistent location maps and discovered world map.
- No fog of war.
- Interactive tokens, 5-foot grid, creature sizes, pathfinding, terrain, walls/doors, line of sight, cover, elevation markers, and area effects.
- Map/location creation remains AI-controlled; there is no manual Generate Location control.

## Campaign continuity

- Compact campaign engine, long-term memory, and encounter snapshots: one row per campaign instead of high-volume normalized event state.
- Chat history capped to protect free-tier storage.
- Complete owner backup/export and guarded restore.

## Security

- Hidden campaign memory and encounter state are service-role-only and are not readable from a player browser, including by the campaign owner during play.
- V2 trigger functions are not executable through the Data API.
- Existing RLS remains the authority for player-owned character/token/initiative operations.

## Hosting

- GitHub Pages serves the V2 frontend and final V2 service-worker cache.
- Supabase hosts authoritative state and V2 Edge Functions.
- `worker/src/index.js` contains the V2-compatible Cloudflare Workers AI prompt contract. Cloudflare runtime deployment is managed separately from the repository.
