const assert = require('assert');
const {
    World,
    Player,
    StatusEffect,
    WorldEvent,
    EventQueue,
    NarrativeMemory
} = require('../engine.js');

function narrativeFact(overrides = {}) {
    return {
        kind: 'knowledge',
        subject: { type: 'player', id: 'player:mat' },
        predicate: 'knowledge.test',
        value: 'test value',
        certainty: 'confirmed',
        importance: 0.6,
        tags: ['test'],
        relatedIds: [],
        locationId: 'town_central',
        knownBy: ['player:mat'],
        directorOnly: false,
        source: { turnId: 'turn_source', speakerId: 'player:mat', kind: 'player_statement', gameTime: 10 },
        ...overrides
    };
}

function narrativePatch(facts = [], overrides = {}) {
    return {
        version: 1,
        facts,
        retractions: [],
        episode: null,
        threads: [],
        ...overrides
    };
}

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
    const blocked = world.performPlayerAction('idz do forest_entrance', player);
    assert.strictEqual(blocked.success, false);
    assert.strictEqual(player.locationId, 'town_central');

    world.performPlayerAction('idz do city_gate_north', player);
    const result = world.performPlayerAction('idz do forest_entrance', player);

    assert.strictEqual(result.success, true);
    assert.strictEqual(player.locationId, 'forest_entrance');
    assert.strictEqual(world.currentTimeMinutes, 61);
    assert.ok(world.worldLog.some(entry => entry.change.type === 'travel_happened'));

    const snapshot = JSON.parse(JSON.stringify(world.toJSON()));
    const restored = World.fromJSON(snapshot);
    assert.strictEqual(restored.currentTimeMinutes, 61);
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

function testTradeCombatAndQuestLoop() {
    const world = World.createStarterWorld('Tester', 'town_central');
    world.config.regenRates.hp = 0;
    world.config.regenRates.stamina = 0;
    const player = world.player;

    const quest = world.performPlayerAction('przyjmij zadanie', player);
    assert.strictEqual(quest.success, true);
    assert.strictEqual(player.getQuest('forest_threat').status, 'active');

    world.performPlayerAction('idz do market_square', player);
    const purchase = world.performPlayerAction('kup healing_potion', player);
    assert.strictEqual(purchase.success, true);
    assert.strictEqual(player.getItemQuantity('healing_potion'), 2);
    assert.strictEqual(player.gold, 75);

    player.hp = 50;
    const use = world.performPlayerAction('uzyj healing_potion', player);
    assert.strictEqual(use.success, true);
    assert.strictEqual(player.hp, 80);
    assert.strictEqual(player.getItemQuantity('healing_potion'), 1);

    world.performPlayerAction('idz do town_central', player);
    world.performPlayerAction('idz do city_gate_north', player);
    world.performPlayerAction('idz do forest_entrance', player);
    let combat;
    for (let i = 0; i < 7; i += 1) {
        combat = world.performPlayerAction('atak npc_forest_bandit', player);
    }
    assert.strictEqual(combat.success, true);
    assert.strictEqual(world.getNPC('npc_forest_bandit').isAlive, false);
    assert.strictEqual(player.getQuest('forest_threat').status, 'completed');
    assert.strictEqual(player.gold, 155);
}

function testStructuredBlueprintWorld() {
    const blueprint = {
        version: 1,
        world: { name: 'Ash Coast', description: 'A test world' },
        startLocationId: 'harbor',
        locations: [
            { id: 'harbor', name: 'Harbor', connections: ['forest'] },
            { id: 'forest', name: 'Forest', connections: ['harbor'], dangerLevel: 50 }
        ],
        factions: [{ id: 'guild', name: 'Guild', power: 70, relations: {} }],
        npcs: [{ id: 'merchant', name: 'Merchant', role: 'merchant', locationId: 'harbor', isMerchant: true, inventory: [{ id: 'bread', quantity: 3 }] }],
        quests: [{ id: 'test_quest', title: 'Test quest', objective: { type: 'explore', required: 1 }, reward: { gold: 10, xp: 5 } }]
    };
    const world = World.createFromBlueprint(blueprint, 'Blueprint Player');
    assert.strictEqual(world.worldMetadata.name, 'Ash Coast');
    assert.strictEqual(world.player.locationId, 'harbor');
    assert.strictEqual(world.locations.get('harbor').connections[0], 'forest');
    assert.strictEqual(world.getNPC('merchant').isMerchant, true);
    assert.strictEqual(world.questDefinitions[0].id, 'test_quest');
    const roundTrip = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(roundTrip.locations.size, 2);
    assert.strictEqual(roundTrip.getNPC('merchant').inventory[0].id, 'bread');
}

function testNarrativeMemoryRoundTripAndLegacyMigration() {
    const world = World.createStarterWorld('Tester', 'town_central');
    assert.ok(world.narrativeMemory instanceof NarrativeMemory);
    world.recordNarrativeTurn({
        id: 'turn_roundtrip', actorId: 'player:mat', userText: 'Przedstawiam się jako Mat.',
        narratorText: 'Karczmarz zapamiętuje imię Mata.', locationId: 'town_central', participantIds: ['npc:innkeeper']
    });
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch([
        narrativeFact({ predicate: 'identity.name', value: 'Mat', canonicalKey: 'player:mat:identity.name' })
    ])).success, true);

    const restored = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(restored.narrativeMemory.facts.size, 1);
    assert.strictEqual(restored.narrativeMemory.turns[0].id, 'turn_roundtrip');

    const legacy = world.toJSON();
    delete legacy.narrativeMemory;
    legacy.historyNodes = [{
        nodeId: 'legacy_1', parentId: null, branchId: 'main', timeStartMinutes: 0, timeEndMinutes: 10,
        tags: ['exploration'], staticImportance: 0.5, dynamicImportance: 0, finalImportance: 0.5,
        persistent: false, relevanceScore: 1, lastReferencedTime: 0, causedBy: [], causes: [],
        summaryText: 'Mat arrived in the old town.', level: 1
    }];
    const migrated = World.fromJSON(legacy);
    assert.strictEqual(migrated.narrativeMemory.schemaVersion, 1);
    assert.strictEqual(migrated.narrativeMemory.episodes.length, 1);
    assert.strictEqual(migrated.narrativeMemory.episodes[0].summary, 'Mat arrived in the old town.');
}

function testNarrativeFactIdempotenceAndClothingHistory() {
    const world = World.createStarterWorld('Tester', 'town_central');
    const first = narrativeFact({
        kind: 'appearance', predicate: 'appearance.current.outerwear', canonicalKey: 'player:mat:appearance.current.outerwear',
        value: 'green travelling cloak', source: { turnId: 'turn_1', speakerId: 'player:mat', kind: 'player_statement', gameTime: 10 }
    });
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch([first])).success, true);
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch([first])).success, true);
    assert.strictEqual(world.narrativeMemory.facts.size, 1);

    const second = narrativeFact({
        kind: 'appearance', predicate: 'appearance.current.outerwear', canonicalKey: 'player:mat:appearance.current.outerwear',
        value: 'steel breastplate', source: { turnId: 'turn_2', speakerId: 'player:mat', kind: 'player_statement', gameTime: 30 }
    });
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch([second])).success, true);
    const clothingFacts = Array.from(world.narrativeMemory.facts.values());
    assert.strictEqual(clothingFacts.length, 2);
    assert.ok(clothingFacts.some(fact => fact.value === 'green travelling cloak' && fact.state === 'superseded' && fact.validTo === 30));
    assert.ok(clothingFacts.some(fact => fact.value === 'steel breastplate' && fact.state === 'active'));
}

function testNarrativeAppearanceRetrievalAndSecrets() {
    const world = World.createStarterWorld('Tester', 'town_central');
    const face = narrativeFact({
        kind: 'appearance', predicate: 'appearance.face', canonicalKey: 'player:mat:appearance.face',
        value: 'pale face with a scar above the right eye', tags: ['appearance', 'identity']
    });
    const secret = narrativeFact({
        kind: 'secret', subject: { type: 'npc', id: 'npc:innkeeper' }, predicate: 'secret.allegiance',
        canonicalKey: 'npc:innkeeper:secret.allegiance', value: 'serves the enemy', knownBy: [], directorOnly: true
    });
    const unknownToPlayer = narrativeFact({
        subject: { type: 'npc', id: 'npc:innkeeper' }, predicate: 'knowledge.private_note',
        canonicalKey: 'npc:innkeeper:knowledge.private_note', value: 'The innkeeper recognizes the ring.', knownBy: ['npc:innkeeper']
    });
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch([face, secret, unknownToPlayer])).success, true);

    const ordinary = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', action: 'Idę na targ.', maxChars: 4000 });
    assert.ok(!ordinary.facts.some(fact => fact.predicate === 'appearance.face'));
    assert.strictEqual(ordinary.directorSecrets.length, 0);

    const mirror = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', action: 'Patrzę w lustro.', maxChars: 4000 });
    assert.ok(mirror.facts.some(fact => fact.predicate === 'appearance.face'));

    const director = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', action: 'Rozmawiam z karczmarzem.', includeDirectorSecrets: true, maxChars: 4000 });
    assert.strictEqual(director.directorSecrets.length, 1);
    const viewerSnapshot = world.toViewerJSON('player:mat');
    assert.ok(!viewerSnapshot.narrativeMemory.facts.some(fact => fact.directorOnly));
    assert.ok(!viewerSnapshot.narrativeMemory.facts.some(fact => fact.predicate === 'knowledge.private_note'));
}

function testNoncanonicalAppearanceFactsAreAlwaysSceneGated() {
    const world = World.createStarterWorld('Tester', 'town_central');
    const face = narrativeFact({
        kind: 'appearance', predicate: 'face_description', canonicalKey: 'player:mat:face_description',
        value: 'freckles and a narrow scar', tags: ['physical']
    });
    const clothing = narrativeFact({
        kind: 'appearance', predicate: 'wearing', canonicalKey: 'player:mat:wearing',
        value: 'a weathered green cloak', tags: ['garment']
    });
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch([face, clothing])).success, true);

    const ordinary = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', action: 'I walk to the market.', maxChars: 4000 });
    assert.ok(!ordinary.facts.some(fact => fact.kind === 'appearance'));

    const mirror = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', action: 'I look into a mirror.', maxChars: 4000 });
    assert.ok(mirror.facts.some(fact => fact.predicate === 'face_description'));
    assert.ok(!mirror.facts.some(fact => fact.predicate === 'wearing'));

    const clothingScene = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', action: 'I inspect my clothing.', maxChars: 4000 });
    assert.ok(clothingScene.facts.some(fact => fact.predicate === 'wearing'));
    assert.ok(!clothingScene.facts.some(fact => fact.predicate === 'face_description'));

    const combat = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', sceneType: 'combat', maxChars: 4000 });
    assert.ok(combat.facts.some(fact => fact.predicate === 'wearing'));
    assert.ok(!combat.facts.some(fact => fact.predicate === 'face_description'));
}

function testNarrativePatchValidationPendingTurnsAndBudget() {
    const world = World.createStarterWorld('Tester', 'town_central');
    for (let index = 1; index <= 6; index += 1) {
        assert.strictEqual(world.recordNarrativeTurn({
            id: `turn_${index}`, actorId: 'player:mat', userText: `Action ${index}`,
            narratorText: `Narration ${index}`, locationId: 'town_central'
        }).recorded, true);
    }
    assert.strictEqual(world.narrativeMemory.shouldConsolidate(), true);
    const invalid = world.applyNarrativeMemoryPatch(narrativePatch([
        narrativeFact({ predicate: 'hp', canonicalKey: 'player:mat:hp', value: 999 })
    ]));
    assert.strictEqual(invalid.success, false);
    assert.strictEqual(world.narrativeMemory.shouldConsolidate(), true);
    assert.strictEqual(world.buildMemoryConsolidationInput().turns.length, 6);

    const missingEpisode = world.applyNarrativeMemoryPatch(narrativePatch([]));
    assert.strictEqual(missingEpisode.success, false);
    assert.strictEqual(world.narrativeMemory.shouldConsolidate(), true);

    const valid = world.applyNarrativeMemoryPatch(narrativePatch([], {
        episode: {
            title: 'First six turns', summary: 'A short test episode.', turnIds: ['turn_1', 'turn_2', 'turn_3', 'turn_4', 'turn_5', 'turn_6'],
            importance: 0.5, tags: ['test'], entityIds: ['player:mat'], locationId: 'town_central'
        }
    }));
    assert.strictEqual(valid.success, true);
    assert.strictEqual(world.narrativeMemory.shouldConsolidate(), false);

    const facts = Array.from({ length: 5 }, (_, index) => narrativeFact({
        predicate: `knowledge.long_${index}`, canonicalKey: `player:mat:knowledge.long_${index}`,
        value: 'x'.repeat(220), importance: 0.2 + index / 10
    }));
    assert.strictEqual(world.applyNarrativeMemoryPatch(narrativePatch(facts)).success, true);
    const context = world.buildNarrativeContext({ viewerId: 'player:mat', playerId: 'player:mat', maxChars: 900 });
    assert.ok(context.charsUsed <= 900);
    assert.ok(context.facts.length < facts.length);
}

testTimeValidation();
testPlayerActionsAndRoundTrip();
testStatusEffectDuration();
testEventQueueCountersAndCancellation();
testTradeCombatAndQuestLoop();
testStructuredBlueprintWorld();
testNarrativeMemoryRoundTripAndLegacyMigration();
testNarrativeFactIdempotenceAndClothingHistory();
testNarrativeAppearanceRetrievalAndSecrets();
testNoncanonicalAppearanceFactsAreAlwaysSceneGated();
testNarrativePatchValidationPendingTurnsAndBudget();
console.log('engine tests passed');
