const MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';
const ALLOWED_ORIGINS = new Set([
  'https://jessedatema08-ops.github.io',
  'http://localhost:8787',
  'http://127.0.0.1:8787'
]);

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    narration: { type: 'string' },
    response_visibility: { type: 'string', enum: ['party','private'] },
    consumes_scene_action: { type: 'boolean' },
    action_required: { type: 'string', enum: ['none','attack_roll','damage_roll','ability_check','saving_throw','reaction','target_selection','movement','item_use','choice'] },
    roll: {
      type: ['object','null'],
      properties: {
        label: { type: 'string' },
        expression: { type: 'string' },
        mode: { type: 'string', enum: ['normal','advantage','disadvantage'] },
        ability: { type: ['string','null'] },
        skill: { type: ['string','null'] },
        dc_visible: { type: 'boolean' },
        dc: { type: ['number','null'] },
        reason: { type: ['string','null'] }
      },
      required: ['label','expression','mode','ability','skill','dc_visible','dc','reason']
    },
    target_options: { type: 'array', items: { type: 'string' } },
    state_effects: {
      type: 'array', items: {
        type: 'object',
        properties: { path: { type: 'string' }, operation: { type: 'string', enum: ['set','add','subtract','append','remove'] }, value: {} },
        required: ['path','operation','value']
      }
    },
    hidden_notes: { type: 'string' },
    rules_note: { type: 'string' }
  },
  required: ['narration','response_visibility','consumes_scene_action','action_required','roll','target_options','state_effects','hidden_notes','rules_note']
};

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://jessedatema08-ops.github.io';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Vary': 'Origin'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) } });
}

function systemPrompt() {
  return `You are the AI Dungeon Master for Dungeon Dwellers V2.

Rules and authority:
- Use D&D 5e 2024 revised rules only.
- Supabase campaign, character, encounter, map, initiative, and V2 engine state supplied to you are authoritative.
- Deterministic V2 mechanics outrank model inference. If the message contains APP_RESOLVED_ACTION, the app has already resolved and applied the mechanics. Narrate the established result only. Do not recalculate it, request another roll for the same mechanic, or emit duplicate state_effects.
- The human player always performs player-facing rolls: attacks, damage, checks, saves, death saves, concentration, rerolls, initiative, and reactions.
- Never fabricate or assume a player roll result and never accept a typed die claim as authoritative.
- When a player-facing roll is required, STOP before resolving it and return the exact dice expression in roll.expression. Set roll.mode to normal, advantage, or disadvantage. The player should only need to press Roll.
- Initiative is AI-gated. Only request initiative when combat actually begins. Never tell a player to use a permanently available initiative control.
- Initiative groups are derived from actual combatants. Empty groups are skipped automatically. In solo play, once the player ends their turn the engine resolves applicable enemy groups and returns to the player's next turn without waiting for nonexistent players.
- Do not emit state_effects for an outcome still waiting on a player-facing roll. Wait for the verified roll, resolve the outcome, then emit the resulting state_effects.
- NPC and enemy rolls may be resolved privately. Never expose enemy roll totals, modifiers, hidden DC math, hidden resources, tactical intent, internal thoughts, or enemy-only perspective.
- Tell players only what their characters can perceive: visible movement, attacks, sounds, expressions, magic, injuries, environmental changes, and consequences.
- Respect action economy, reactions, movement, concentration, conditions, resources, cover, line of sight, creature size, weapon mastery data, spell areas, rests, durations, inventory, and encounter state present in the authoritative payload.
- Persistent maps belong to locations, not scenes. Never ask the user to manually generate a location. Player-safe map geometry must follow the public scene description; never preserve a generic placeholder when the current public location is clearly described. Never include undiscovered secret geometry in player-readable map payloads.
- Friendly fire and PvP are legal when rules and campaign state permit them.
- Public actions and ordinary visible consequences use response_visibility=party. Use response_visibility=private only for explicitly secret actions/questions or information only that player should know.
- Never leak private information through narration marked party, public metadata, public state effects, or player-readable map data.
- Whenever a resolved non-V2 action changes a campaign character, state_effects MUST describe the exact change. Only target supplied campaign character IDs.
- If an enemy or NPC affects a different player than the caller, target the affected player's character ID, not the caller's.
- Do not reveal puzzle answers. Give only information the character could know.
- Rules questions are free. In-world investigation can consume scene time/actions when appropriate.
- Answer rules questions directly from the rules and authoritative character state. Never request an Arcana, Intelligence, or other ability check merely to determine how a published spell or feature works.
- A spell that chooses a point within range may choose the caster's space unless its text says otherwise. Fireball can therefore be centered on the caster's space; the caster is inside the area, makes the Dexterity saving throw, and takes damage normally. This is a rules answer, not an Arcana check.
- Combat player turns may use asynchronous deadlines configured by the campaign. A combat round remains 6 seconds in-world.
- Be concise in routine play and cinematic only when the event deserves it.

Return only the structured response requested by the schema.`;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method === 'GET') return json({ ok: true, service: 'Dungeon Dwellers V2 AI DM', model: MODEL }, 200, origin);
    if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: 'Origin not allowed' }, 403, origin);

    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'Invalid JSON body' }, 400, origin); }
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    const campaignState = body?.campaignState && typeof body.campaignState === 'object' ? body.campaignState : {};
    const context = body?.context && typeof body.context === 'object' ? body.context : {};
    if (!message) return json({ ok: false, error: 'message is required' }, 400, origin);
    if (message.length > 12000) return json({ ok: false, error: 'message too long' }, 413, origin);

    const stateText = JSON.stringify(campaignState);
    const contextText = JSON.stringify(context);
    if (stateText.length + contextText.length > 50000) return json({ ok: false, error: 'campaign payload too large' }, 413, origin);

    try {
      const result = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: systemPrompt() },
          { role: 'system', content: `Campaign state: ${stateText}\nRelevant context: ${contextText}` },
          { role: 'user', content: message }
        ],
        response_format: { type: 'json_schema', schema: RESPONSE_SCHEMA }
      });
      return json({ ok: true, dm: result?.response ?? result }, 200, origin);
    } catch (error) {
      console.error('Workers AI error', error);
      return json({ ok: false, error: 'AI DM request failed', detail: String(error?.message || error) }, 502, origin);
    }
  }
};
