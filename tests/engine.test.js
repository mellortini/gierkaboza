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

function testPlayerStatsAndD20Resolution() {
    const world = World.createStarterWorld('D20 Tester', 'town_central');
    const player = world.player;

    assert.strictEqual(player.unspentStatPoints, 27);
    assert.strictEqual(player.getAbilityModifier('strength'), 0);
    assert.strictEqual(player.spendStatPoint('strength'), true);
    assert.strictEqual(player.stats.strength, 11);
    assert.strictEqual(player.unspentStatPoints, 26);
    assert.strictEqual(player.gainXp(100), 1);
    assert.strictEqual(player.level, 2);
    assert.strictEqual(player.unspentStatPoints, 28);
    assert.strictEqual(player.proficiencyBonus, 2);

    const savedPlayer = Player.fromJSON(JSON.parse(JSON.stringify(player.toJSON())));
    assert.strictEqual(savedPlayer.stats.strength, 11);
    assert.strictEqual(savedPlayer.unspentStatPoints, 28);
    assert.strictEqual(savedPlayer.level, 2);

    const beforeTime = world.currentTimeMinutes;
    const check = world.resolveD20Action('przeszukuję ślady', player, {
        kind: 'check', label: 'Test percepcji', difficulty: 15, modifier: 4
    }, 11);
    assert.strictEqual(check.success, true);
    assert.match(check.message, /sukcesem/);
    assert.strictEqual(world.currentTimeMinutes, beforeTime + 5);
    assert.ok(check.worldChanges.some(change => change.type === 'd20_rolled'));
    assert.ok(check.worldChanges.some(change => change.type === 'd20_check_resolved'));

    world.performPlayerAction('idz do city_gate_north', player);
    world.performPlayerAction('idz do forest_entrance', player);
    const target = world.getNPC('npc_forest_bandit');
    const attack = world.resolveD20Action('atak npc_forest_bandit', player, {
        kind: 'attack', label: 'Atak', targetId: target.id, targetName: target.name,
        difficulty: 25, modifier: 2
    }, 1);
    assert.strictEqual(attack.success, false);
    assert.match(attack.message, /Nie trafiasz/);
    assert.ok(attack.worldChanges.some(change => change.type === 'player_damaged'));
}

function testEquipmentAndItemPersistence() {
    const world = World.createStarterWorld('Equipment Tester', 'town_central');
    const player = world.player;
    player.addItem('iron_sword');
    player.addItem('leather_armor');
    player.addItem('moon_amulet');

    const sword = world.performPlayerAction('zakładam miecz', player);
    const armor = world.performPlayerAction('zakładam zbroję', player);
    const amulet = world.performPlayerAction('zakładam amulet', player);
    assert.strictEqual(sword.success, true);
    assert.strictEqual(armor.success, true);
    assert.strictEqual(amulet.success, true);
    assert.strictEqual(player.equipment.weapon, 'iron_sword');
    assert.strictEqual(player.equipment.armor, 'leather_armor');
    assert.strictEqual(player.equipment.accessory, 'moon_amulet');
    assert.strictEqual(player.getAttackPower(), 13);
    assert.strictEqual(player.getDefensePower(), 3);
    assert.strictEqual(player.getAbilityModifier('wisdom'), 0);

    const snapshot = JSON.parse(JSON.stringify(player.toJSON()));
    const restored = Player.fromJSON(snapshot);
    assert.strictEqual(restored.equipment.weapon, 'iron_sword');
    assert.strictEqual(restored.equipment.armor, 'leather_armor');
    assert.strictEqual(restored.equipment.accessory, 'moon_amulet');
    assert.strictEqual(restored.getAttackPower(), 13);

    const removed = world.performPlayerAction('zdejmuję miecz', player);
    assert.strictEqual(removed.success, true);
    assert.strictEqual(player.equipment.weapon, null);
    assert.strictEqual(player.getAttackPower(), 8);
}

function testMerchantGoldWeightAndRoundTrip() {
    const world = World.createStarterWorld('Merchant Tester', 'town_central');
    const player = world.player;
    const merchant = world.getNPC('npc_market_merchant');
    assert.strictEqual(merchant.gold, 500);
    world.performPlayerAction('idz do market_square', player);

    const beforeWeight = player.getInventoryWeight();
    const purchase = world.performPlayerAction('kupuje miecz', player);
    assert.strictEqual(purchase.success, true);
    assert.strictEqual(player.getItemQuantity('iron_sword'), 1);
    assert.strictEqual(merchant.gold, 575);
    assert.ok(player.getInventoryWeight() > beforeWeight);

    const sale = world.performPlayerAction('sprzedaje chleb', player);
    assert.strictEqual(sale.success, true);
    assert.strictEqual(player.getItemQuantity('bread'), 1);
    assert.strictEqual(merchant.gold, 573);

    const saved = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(saved.getNPC('npc_market_merchant').gold, 573);
    assert.strictEqual(saved.getNPC('npc_market_merchant').inventory.find(item => item.id === 'iron_sword')?.quantity || 0, 0);
    assert.strictEqual(saved.getNPC('npc_market_merchant').inventory.find(item => item.id === 'bread').quantity, 11);
}

function testNaturalTravelFormsAndUnknownDestination() {
    const world = World.createStarterWorld('Natural Travel Tester', 'town_central');
    const player = world.player;

    const naturalTravel = world.performPlayerAction('idziemy do city_gate_north', player);
    assert.strictEqual(naturalTravel.success, true);
    assert.strictEqual(player.locationId, 'city_gate_north');

    const beforeUnknownTravel = player.locationId;
    const unknownTravel = world.performPlayerAction('idziemy do karczmy', player);
    assert.strictEqual(unknownTravel.success, false);
    assert.strictEqual(player.locationId, beforeUnknownTravel);
    assert.match(unknownTravel.message, /celu podróży|celu podróży/i);
}

function testSandboxCreatesAndPersistsFreeformLocations() {
    const world = World.createSandboxWorld('Sandbox Tester');
    assert.strictEqual(world.isSandbox, true);
    assert.strictEqual(world.scenario, null);
    assert.strictEqual(world.locations.size, 1);
    assert.strictEqual(world.npcs.size, 0);

    const firstTrip = world.performPlayerAction('ide do karczmy', world.player);
    assert.strictEqual(firstTrip.success, true);
    assert.strictEqual(world.player.locationId, 'sandbox_karczmy');
    assert.strictEqual(world.locations.size, 2);

    const saved = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(saved.isSandbox, true);
    assert.strictEqual(saved.locations.size, 2);
    assert.strictEqual(saved.player.locationId, 'sandbox_karczmy');

    const returnTrip = saved.performPlayerAction('ide do sandbox_start', saved.player);
    assert.strictEqual(returnTrip.success, true);
    assert.strictEqual(saved.player.locationId, 'sandbox_start');

    const typo = saved.performPlayerAction('ide d osklepu', saved.player);
    assert.strictEqual(typo.success, true);
    assert.strictEqual(saved.getLocation(saved.player.locationId).name, 'Sklepu');

    const natural = saved.performPlayerAction('na rynek', saved.player);
    assert.strictEqual(natural.success, true);
    assert.strictEqual(saved.getLocation(saved.player.locationId).name, 'Rynek');

    const conversation = saved.performPlayerAction('rozmawiam z handlarzem', saved.player);
    assert.strictEqual(conversation.success, true);
    const merchant = Array.from(saved.npcs.values()).find(npc => npc.isMerchant);
    assert.ok(merchant);
    assert.strictEqual(merchant.locationId, saved.player.locationId);

    const purchase = saved.performPlayerAction('kupuje pochodnie', saved.player);
    assert.strictEqual(purchase.success, true);
    assert.strictEqual(saved.player.getItemQuantity('torch'), 1);
}

function testNpcNameDiscoveryAndPersistence() {
    const world = World.createFromBlueprint({
        world: { name: 'Name Knowledge', description: 'NPC test world' },
        startLocationId: 'village',
        locations: [{ id: 'village', name: 'Village', connections: [] }],
        npcs: [
            { id: 'npc_mira', name: 'Mira Wrona', role: 'sołtyska', description: 'Praktyczna kobieta przy studni.', locationId: 'village' },
            { id: 'npc_orwan', name: 'Orwan Żelazny', role: 'kowal', locationId: 'village' }
        ]
    }, 'Name Tester');

    const initialNpcs = world.getLiveState().npcInteractions;
    assert.strictEqual(initialNpcs[0].name, 'Nieznana postać');
    assert.strictEqual(initialNpcs[1].name, 'Nieznana postać #2');

    const ordinaryConversation = world.revealNpcNamesFromDialogue(
        'Rozmawiam z kobietą przy studni.',
        'Kobieta odpowiada spokojnie, ale nie przedstawia się.'
    );
    assert.deepStrictEqual(ordinaryConversation, []);

    const revealed = world.revealNpcNamesFromDialogue(
        'Pytam kobietę: jak masz na imię?',
        '„Nazywam się Mira Wrona” — odpowiada.'
    );
    assert.deepStrictEqual(revealed, ['npc_mira']);
    assert.strictEqual(world.getLiveState().npcInteractions[0].name, 'Mira Wrona');
    assert.deepStrictEqual(world.getKnownNpcIdsMentionedInText('Piotr, to Mira Wrona.', world.player), ['npc_mira']);
    assert.deepStrictEqual(world.getKnownNpcIdsMentionedInText('Piotr, to Mira.', world.player), ['npc_mira']);
    assert.deepStrictEqual(world.getKnownNpcIdsMentionedInText('Mira Wrona', new Player('Piotr', 'village')), []);

    const restored = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(restored.player.knowsNpcName('npc_mira'), true);
    assert.strictEqual(restored.player.knowsNpcName('npc_orwan'), false);
    assert.strictEqual(restored.getLiveState().npcInteractions[1].name, 'Nieznana postać #2');
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

    player.addItem('iron_sword');
    assert.strictEqual(world.performPlayerAction('zakładam miecz', player).success, true);

    world.performPlayerAction('idz do town_central', player);
    world.performPlayerAction('idz do city_gate_north', player);
    world.performPlayerAction('idz do forest_entrance', player);
    let combat;
    for (let i = 0; i < 10 && world.getNPC('npc_forest_bandit').isAlive; i += 1) {
        combat = world.performPlayerAction('atak npc_forest_bandit', player);
    }
    assert.strictEqual(combat.success, true);
    assert.strictEqual(world.getNPC('npc_forest_bandit').isAlive, false);
    assert.strictEqual(player.getQuest('forest_threat').status, 'completed');
    assert.strictEqual(player.gold, 155);
}

function testCombatDiceDownedAndLoot() {
    const world = World.createStarterWorld('Combat Tester', 'town_central');
    world.config.regenRates.hp = 0;
    world.config.regenRates.stamina = 0;
    const player = world.player;
    const target = world.getNPC('npc_forest_bandit');
    player.addItem('iron_sword');
    player.equipItem('iron_sword');
    player.locationId = 'forest_entrance';
    target.hp = 1000;
    target.maxHp = 1000;
    target.defense = 0;
    target.armorClass = 11;
    target.damageDice = '1d6';

    const critical = world.resolveD20Action('atak npc_forest_bandit', player, {
        kind: 'attack', label: 'Atak', targetId: target.id, targetName: target.name,
        difficulty: target.armorClass, modifier: 2
    }, 20);
    assert.strictEqual(critical.success, true);
    assert.ok(critical.worldChanges.some(change => /2d8/.test(change.description)));
    assert.ok(target.hp < 1000);

    target.attack = 500;
    player.hp = 1;
    player.isDowned = false;
    const knockedDown = world.resolveD20Action('atak npc_forest_bandit', player, {
        kind: 'attack', label: 'Atak', targetId: target.id, targetName: target.name,
        difficulty: target.armorClass, modifier: 2
    }, 1);
    assert.strictEqual(knockedDown.success, false);
    assert.strictEqual(player.hp, 0);
    assert.strictEqual(player.isDowned, true);
    assert.ok(knockedDown.worldChanges.some(change => change.type === 'player_downed'));

    player.addItem('healing_potion');
    assert.strictEqual(world.performPlayerAction('uzyj healing_potion', player).success, true);
    assert.strictEqual(player.isDowned, false);

    target.attack = 0;
    target.hp = 1;
    target.loot = [{ id: 'iron_key', quantity: 1 }];
    const finishing = world.resolveD20Action('atak npc_forest_bandit', player, {
        kind: 'attack', label: 'Atak', targetId: target.id, targetName: target.name,
        difficulty: target.armorClass, modifier: 2
    }, 20);
    assert.strictEqual(finishing.success, true);
    assert.strictEqual(target.isAlive, false);
    assert.strictEqual(player.getItemQuantity('iron_key'), 1);

    const restored = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(restored.getNPC('npc_forest_bandit').damageDice, '1d6');
    assert.strictEqual(restored.player.isDowned, false);
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

function testScenarioMetadataNormalizationPersistenceAndChoices() {
    const blueprint = {
        version: 1,
        world: { name: 'Scenario World', description: 'A bounded test world' },
        startLocationId: 'harbor',
        locations: [{ id: 'harbor', name: 'Harbor' }],
        scenario: {
            id: ' ash-coast ', title: 'Ash Coast', pitch: 'A city on the edge of war.', tone: 'tense',
            directorBrief: 'Keep consequences visible. Guide Name is a hidden contact.',
            acts: [{ id: 'act_1', title: 'Arrival' }],
            mainArc: [{ id: 'arc_1', text: 'Find the cause.' }], sideQuests: [{ id: 'side_1', title: 'A favor' }],
            npcs: [{ id: 'npc_guide', role: 'guide' }], factions: [{ id: 'guild', goal: 'survive' }],
            choices: [
                { id: 'choice_1', prompt: 'Choose', options: [{ id: 'help', nextAct: 'act_2', flagsAdd: ['met_guide', 'opened_gate'], flagsRemove: ['fearful'], variables: { trust: 1 }, note: 'The guide opens the gate.' }, { id: 'leave' }] },
                { id: 'choice_2', prompt: 'Continue', options: [{ id: 'stay', activeAct: 'act_3', note: 'The party stays.' }] }
            ],
            multiplayerHooks: ['shared rumor'], endings: [{ id: 'end_1', text: 'Dawn' }], antiRailroadingRules: ['Allow retreat'],
            ignoredRootField: 'must not be copied', unsafe: () => 'drop me'
        },
        npcs: [{ id: 'npc_guide', name: 'Guide Name', role: 'guide', description: 'A cautious contact.' }]
    };
    const world = World.createFromBlueprint(blueprint, 'Scenario Player');
    assert.strictEqual(world.scenario.title, 'Ash Coast');
    assert.strictEqual(world.scenario.ignoredRootField, undefined);
    assert.strictEqual(world.scenarioState.activeAct, 'act_1');
    const prompt = world.getScenarioPrompt(1200);
    assert.ok(prompt.includes('Ash Coast'));
    assert.ok(prompt.includes('A city on the edge of war.'));
    assert.ok(prompt.length <= 1200);
    const maskedPrompt = world.getScenarioPrompt(5000, { maskNpcNames: true });
    assert.strictEqual(maskedPrompt.includes('Guide Name'), false);
    assert.ok(world.getScenarioPrompt(5000).includes('Guide Name'));

    const before = JSON.stringify({ hp: world.player.hp, gold: world.player.gold, items: world.player.inventory });
    const result = world.recordScenarioChoice({ choiceId: 'choice_1', optionId: 'help', flagsAdd: ['met_guide'], variables: { trust: 2 }, note: 'Player helped.' });
    assert.strictEqual(result.success, true);
    assert.strictEqual(world.scenarioState.activeAct, 'act_2');
    assert.deepStrictEqual(world.scenarioState.flags, ['met_guide', 'opened_gate']);
    assert.strictEqual(world.scenarioState.variables.trust, 2);
    assert.deepStrictEqual(world.scenarioState.choiceHistory[0].consequence.flagsAdd, ['met_guide', 'opened_gate']);
    assert.strictEqual(world.scenarioState.choiceHistory[0].note, 'Player helped.');
    const historyBeforeDuplicate = JSON.stringify(world.scenarioState.choiceHistory);
    const stateBeforeDuplicate = JSON.stringify(world.scenarioState);
    const duplicate = world.recordScenarioChoice({ choiceId: 'choice_1', optionId: 'help', flagsAdd: ['new_flag'], variables: { trust: 99 }, note: 'Should be ignored.' });
    assert.strictEqual(duplicate.success, true);
    assert.strictEqual(duplicate.duplicate, true);
    assert.strictEqual(duplicate.changed, false);
    assert.strictEqual(JSON.stringify(world.scenarioState.choiceHistory), historyBeforeDuplicate);
    assert.strictEqual(JSON.stringify(world.scenarioState), stateBeforeDuplicate);
    const activeActChoice = world.recordScenarioChoice({ choiceId: 'choice_2', optionId: 'stay' });
    assert.strictEqual(activeActChoice.success, true);
    assert.strictEqual(world.scenarioState.activeAct, 'act_3');
    assert.strictEqual(JSON.stringify({ hp: world.player.hp, gold: world.player.gold, items: world.player.inventory }), before);

    const restored = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.deepStrictEqual(restored.scenario, world.scenario);
    assert.deepStrictEqual(restored.scenarioState, world.scenarioState);
    assert.ok(restored.getScenarioPrompt().includes('CURRENT_SCENARIO_STATE'));
}

function testInvalidScenarioChoiceAndLegacyStarter() {
    const world = World.createStarterWorld('Legacy Player', 'town_central');
    assert.strictEqual(world.scenario, null);
    assert.strictEqual(world.getScenarioPrompt(), '');
    const before = JSON.stringify(world.scenarioState);
    const result = world.recordScenarioChoice({ choiceId: 'missing', optionId: 'missing', flagsAdd: ['should_not_apply'] });
    assert.strictEqual(result.success, false);
    assert.strictEqual(JSON.stringify(world.scenarioState), before);
    const restored = World.fromJSON(world.toJSON());
    assert.strictEqual(restored.scenario, null);
    assert.deepStrictEqual(restored.scenarioState, world.scenarioState);
}

function testBlueprintQuestDefinitionsAndExploreCompletion() {
    const blueprint = {
        world: { name: 'Quest Coast' }, startLocationId: 'town',
        locations: [
            { id: 'town', name: 'Town', connections: ['ruins'] },
            { id: 'ruins', name: 'Ruins', connections: ['town'] }
        ],
        npcs: [
            { id: 'warden', name: 'Warden', role: 'quest giver', locationId: 'town', isQuestGiver: true },
            { id: 'scribe', name: 'Scribe', role: 'quest giver', locationId: 'town', isQuestGiver: true }
        ],
        questDefinitions: [
            { id: 'visit_ruins', title: 'Visit the Ruins', giverId: 'warden', giverLocationId: 'town', objective: { type: 'explore', targetId: 'ruins' }, reward: { gold: 17, xp: 9 } },
            { id: 'second_mission', title: 'Second Mission', giverId: 'scribe', giverLocationId: 'town', objective: { type: 'explore', targetId: 'town' }, reward: { gold: 3, xp: 2 } }
        ]
    };
    const world = World.createFromBlueprint(blueprint, 'Quest Player');
    assert.strictEqual(world.questDefinitions.length, 2);
    assert.strictEqual(world.questDefinitions[0].giverId, 'warden');
    assert.strictEqual(world.questDefinitions[0].giverLocationId, 'town');

    const first = world.performPlayerAction('accept Visit the Ruins');
    assert.strictEqual(first.success, true);
    assert.strictEqual(world.player.getQuest('visit_ruins').status, 'active');
    const second = world.performPlayerAction('accept second_mission');
    assert.strictEqual(second.success, true);
    assert.strictEqual(world.player.getQuest('second_mission').status, 'completed');
    assert.strictEqual(world.player.gold, 103);

    const travel = world.performPlayerAction('idz do ruins');
    assert.strictEqual(travel.success, true);
    assert.strictEqual(world.player.getQuest('visit_ruins').status, 'completed');
    assert.strictEqual(world.player.gold, 120);
    assert.strictEqual(travel.worldChanges.filter(change => change.type === 'quest_completed').length, 1);
    const repeat = world.performPlayerAction('idz do town');
    assert.strictEqual(repeat.success, true);
    assert.strictEqual(world.player.gold, 120);
    assert.strictEqual(world.player.quests.filter(quest => quest.status === 'completed').length, 2);
    assert.ok(world.performPlayerAction('accept').message.includes('Visit the Ruins'));
    const restored = World.fromJSON(JSON.parse(JSON.stringify(world.toJSON())));
    assert.strictEqual(restored.questDefinitions[0].giverId, 'warden');
    assert.strictEqual(restored.questDefinitions[1].giverLocationId, 'town');
}

function testQuestNoGiverAndInvalidSelection() {
    const world = World.createFromBlueprint({
        world: { name: 'No Giver' }, locations: [{ id: 'camp', name: 'Camp' }], startLocationId: 'camp',
        questDefinitions: [{ id: 'q1', title: 'Lost Task', objective: { type: 'explore', targetId: 'camp' }, reward: { gold: 10, xp: 1 } }]
    }, 'No Giver Player');
    const result = world.performPlayerAction('accept q1');
    assert.strictEqual(result.success, false);
    assert.strictEqual(world.player.quests.length, 0);

    const withGiver = World.createFromBlueprint({
        world: { name: 'Invalid Quest' }, locations: [{ id: 'camp', name: 'Camp' }], startLocationId: 'camp',
        npcs: [{ id: 'giver', name: 'Giver', locationId: 'camp', isQuestGiver: true }],
        questDefinitions: [{ id: 'q1', title: 'Known Task', objective: { type: 'explore', targetId: 'camp' }, reward: { gold: 10, xp: 1 } }]
    }, 'Invalid Player');
    const invalid = withGiver.performPlayerAction('accept unknown_task');
    assert.strictEqual(invalid.success, true);
    assert.strictEqual(withGiver.player.quests.length, 1);
    assert.strictEqual(withGiver.player.quests[0].id, 'q1');
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
testPlayerStatsAndD20Resolution();
testEquipmentAndItemPersistence();
testMerchantGoldWeightAndRoundTrip();
testCombatDiceDownedAndLoot();
testNaturalTravelFormsAndUnknownDestination();
testSandboxCreatesAndPersistsFreeformLocations();
testNpcNameDiscoveryAndPersistence();
testStatusEffectDuration();
testEventQueueCountersAndCancellation();
testTradeCombatAndQuestLoop();
testStructuredBlueprintWorld();
testScenarioMetadataNormalizationPersistenceAndChoices();
testInvalidScenarioChoiceAndLegacyStarter();
testBlueprintQuestDefinitionsAndExploreCompletion();
testQuestNoGiverAndInvalidSelection();
testNarrativeMemoryRoundTripAndLegacyMigration();
testNarrativeFactIdempotenceAndClothingHistory();
testNarrativeAppearanceRetrievalAndSecrets();
testNoncanonicalAppearanceFactsAreAlwaysSceneGated();
testNarrativePatchValidationPendingTurnsAndBudget();
console.log('engine tests passed');
