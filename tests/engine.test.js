const assert = require('assert');
const {
    World,
    Player,
    StatusEffect,
    WorldEvent,
    EventQueue
} = require('../engine.js');

function testTimeValidation() {
    const world = World.createStarterWorld('Tester', 'town_central');
    assert.throws(() => world.advanceWorldTime(1.5), /safe integer/);
    assert.throws(() => world.advanceWorldTime(Number.NaN), /safe integer/);
    assert.throws(() => world.advanceWorldTime(-1), /safe integer/);
    world.advanceWorldTime(15);
    assert.strictEqual(world.currentTimeMinutes, 15);
}

function testPlayerActionsAndRoundTrip() {
    const world = World.createStarterWorld('Tester', 'town_central');
    world.worldMetadata = { name: 'Testland', description: 'Opis', plan: '### Lokacje' };
    const player = world.player;
    const result = world.performPlayerAction('idz do forest_entrance', player);

    assert.strictEqual(result.success, true);
    assert.strictEqual(player.locationId, 'forest_entrance');
    assert.strictEqual(world.currentTimeMinutes, 30);
    assert.ok(world.worldLog.some(entry => entry.change.type === 'travel_happened'));

    const snapshot = JSON.parse(JSON.stringify(world.toJSON()));
    const restored = World.fromJSON(snapshot);
    assert.strictEqual(restored.currentTimeMinutes, 30);
    assert.strictEqual(restored.player.locationId, 'forest_entrance');
    assert.strictEqual(restored.player.name, 'Tester');
    assert.strictEqual(restored.worldMetadata.plan, '### Lokacje');
    assert.ok(restored.locations.size >= 3);
}

function testStatusEffectDuration() {
    const world = World.createStarterWorld('Tester', 'town_central');
    const player = world.player;
    world.config.regenRates.hp = 0;
    player.hp = player.maxHp;
    player.addStatusEffect(new StatusEffect('test_drain', 60, 'hp_drain', 10));
    world.advanceWorldTime(30);
    assert.strictEqual(player.hp, player.maxHp - 30);
    assert.strictEqual(player.statusEffects[0].remainingMinutes, 30);
    world.advanceWorldTime(30);
    assert.strictEqual(player.hp, player.maxHp - 60);
    assert.strictEqual(player.statusEffects.length, 0);
}

function testEventQueueCountersAndCancellation() {
    const queue = new EventQueue();
    queue.schedule(new WorldEvent('event_a', 'economic_crisis', 20, 'regional', {}, 50, false, 'faction_a'));
    queue.schedule(new WorldEvent('event_b', 'plague', 30, 'regional', {}, 50, false, 'faction_b'));
    assert.strictEqual(queue.countByType('economic_crisis'), 1);
    assert.strictEqual(queue.countByFaction('faction_b'), 1);
}

testTimeValidation();
testPlayerActionsAndRoundTrip();
testStatusEffectDuration();
testEventQueueCountersAndCancellation();
console.log('engine tests passed');
