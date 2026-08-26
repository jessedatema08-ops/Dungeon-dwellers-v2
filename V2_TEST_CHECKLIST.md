# V2 production regression checklist

- Authentication and campaign switcher open without selecting an existing campaign first.
- New campaign generation starts immediately unless the configured schedule actually pauses it.
- Per-campaign Delete opens from each listed campaign and requires confirmation.
- Existing reusable characters still load/select/import.
- Party and private chat still respect visibility.
- AI send button is the square V2 send control.
- AI-requested roll opens a separate Roll step; typed roll claims are not authoritative.
- Initiative has no free-standing manual button and starts only from AI combat declaration.
- All pending players roll initiative before player block 1 activates.
- Structured attacks/spells/features/items validate character ownership/resources/targets and record verified rolls.
- Player block requires End My Turn; enemy block resolves automatically.
- Tactical map has no fog or vision label, supports token taps and player token dragging.
- There is no Generate Location button; maps are AI/location driven.
- World map shows discovered locations/routes without fog.
- Short/Long Rest, death saves, equipment, item/currency transfer and level eligibility are available from V2 controls.
- Campaign backup export/restore is owner-only.
- Hidden encounter and long-term private memory state are not browser-readable.
- PWA installs/cache-updates to the final V2 cache.
