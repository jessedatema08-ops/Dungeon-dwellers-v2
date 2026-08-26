# Dungeon Dwellers — Beta v4

Interactive GitHub Pages beta for the asynchronous AI-DM D&D interface.

## Rules corrections in this build
The included solo character is a level 5 Champion Fighter using the 2024 rules. The beta now reflects the level-5 Fighter feature table: Second Wind has 3 uses; Action Surge has 1 use; Extra Attack allows two attacks with the Attack action; Tactical Shift is available after Second Wind; Tactical Mind uses Second Wind after a failed ability check; Indomitable is **not** present because it begins at Fighter 9. The Claymore is mechanically treated as a Greatsword: 2d6 Slashing, Heavy, Two-Handed, Graze, 6 lb.

## Working local beta flows
- Scene actions, Custom Turn confirmation, map/fog presentation
- Inventory → item details → Use → target selection → Swing → player-triggered attack roll → damage roll → second attack from Extra Attack → scene-impact return
- Second Wind, Tactical Shift, Action Surge, Tactical Mind
- Champion initiative Advantage and 19–20 critical threshold
- Saving throws, hidden checks, passive checks, group checks, concentration, death saves
- Reaction-window preview and Opportunity Attack path
- Travel, merchant, rests, crafting, downtime, quests, NPC relationships
- Campaign Owner pause, rewind, state correction, and combat transition
- Local persistence, offline PWA caching, local notification test

## Production-only services
Static GitHub Pages cannot provide live AI DM inference, Supabase authentication/realtime multiplayer, true server push, secure permissions, durable shared event history, or full D&D Beyond PDF parsing. The beta labels these honestly instead of faking them.
