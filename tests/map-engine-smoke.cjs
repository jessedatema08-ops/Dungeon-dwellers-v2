const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'map-engine.js'), 'utf8');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(source, context);

const maps = context.window.DungeonMapEngine;
assert.ok(maps, 'map engine loads');

const spec = maps.starterSpec('smoke-seed', 'Smoke Dungeon');
assert.equal(spec.version, 3);
assert.ok(spec.doors.length > 0, 'generated maps include doors');
assert.ok(spec.lighting.sources.length > 0, 'generated maps include light sources');
assert.ok(spec.objects.some((object) => object.cover), 'generated maps include cover');

const door = spec.doors[0];
const pathThroughDoor = maps.findPath(
  spec,
  { x: door.x, y: door.y + 0.5 },
  { x: door.x, y: door.y - 0.5 },
  { tokens: [] },
);
assert.ok(pathThroughDoor, 'an open door creates a legal opening in its wall');

const costSpec = {
  ...spec,
  regions: [
    { id: 'cost-zone', type: 'terrain', shape: 'rect', x: 0, y: 0, w: 2, h: 2,
      properties: { movementCost: 2, elevationFt: 5 } },
  ],
};
assert.equal(maps.pathFeet(costSpec, [{ x: 0, y: 0 }, { x: 0.5, y: 0 }]), 5,
  'terrain multiplier applies without charging elevation twice inside one zone');
assert.equal(maps.pathFeet(costSpec, [{ x: 2.5, y: 0 }, { x: 1.5, y: 0 }]), 15,
  'entering elevated difficult terrain charges terrain and ascent');

const blockedSpec = {
  ...spec,
  doors: [],
  walls: [{ x1: 1, y1: 0, x2: 1, y2: 2, blocksMovement: true, blocksVision: true }],
};
assert.equal(maps.movementBlocked(blockedSpec, { x: 0.5, y: 1 }, { x: 1.5, y: 1 }), true);
assert.equal(maps.lineOfSight(blockedSpec, { x: 0.5, y: 1 }, { x: 1.5, y: 1 }).clear, false);

console.log('map-engine smoke checks passed');

