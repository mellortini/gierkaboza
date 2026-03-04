# 🎮 Engine API Reference - Phase 3

Quick reference for using the RPG Engine in your code.

---

## 🌍 World Class

### Constructor
```javascript
const world = new World();
```

### Properties
```javascript
world.currentTimeMinutes           // int - Current game time in minutes
world.lastGlobalStrategicUpdate    // int - Phase 3: last strategic update timestamp
world.locations                    // Map<string, Location>
world.factions                     // Map<string, Faction>
world.npcs                         // Map<string, NPC>
world.player                       // Player
world.worldLog                     // Array<{timestamp, change}>
world.config                       // Configuration object
```

### Methods

#### Time Management
```javascript
// Advance time (ONLY legal way to change time)
world.advanceWorldTime(minutes)  // throws Error if minutes < 0

// Get formatted time
world.getFormattedTime()         // Returns "12:30"
world.getTimeOfDay()             // Returns "Morning", "Afternoon", "Evening", "Night"
world.getDayNumber()             // Returns 1, 2, 3, ...
```

#### Entity Management
```javascript
world.addLocation(location)
world.addFaction(faction)
world.addNPC(npc)
world.setPlayer(player)

world.getLocation(locationId)    // Returns Location or undefined
world.getNPC(npcId)              // Returns NPC or undefined
world.getFaction(factionId)      // Returns Faction or undefined
```

#### Logging
```javascript
world.logWorldChange(worldChange)  // Add to world log
```

#### Serialization
```javascript
const json = world.toJSON()                    // Serialize to JSON
const world2 = World.fromJSON(json)            // Deserialize from JSON
```

#### Factory
```javascript
const world = World.createStarterWorld(playerName, startLocationId)
// Creates world with 6 default locations, 3 factions, and player
```

#### Phase 3: Strategic Planning
```javascript
// Evaluate faction's current strategic situation
world.evaluateFactionState(faction)  // Returns { militaryAdvantage, economicPressure, internalInstability, ... }

// Select best strategy based on state
world.selectStrategy(state, faction)  // Returns Strategy object

// Generate event plan for a strategy
world.generatePlan(strategy, faction, state)  // Returns WorldEvent[]

// Select expansion target
world.selectExpansionTarget(faction)  // Returns factionId or null

// Select potential ally
world.selectPotentialAlly(faction)  // Returns factionId or null

// Cancel pending events when strategy changes
world.cancelFactionPendingEvents(factionId)
```

---

## 👤 Player Class

### Constructor
```javascript
const player = new Player(name, locationId);
```

### Properties
```javascript
player.name                    // string
player.locationId              // string
player.gold                    // int
player.hp, player.maxHp        // int
player.stamina, player.maxStamina  // int
player.mana, player.maxMana    // int
player.hunger                  // float (0-100)
player.thirst                  // float (0-100)
player.fatigue                 // float (0-100)
player.reputation              // Map<factionId, int>
player.statusEffects           // Array<StatusEffect>
player.storyFlags              // Set<string>
player.inventory               // Array (Phase 2)
```

### Methods
```javascript
// Reputation
player.getReputation(factionId)        // Returns -100...+100
player.setReputation(factionId, value) // Sets -100...+100
player.changeReputation(factionId, delta)  // Adds delta

// Status Effects
player.addStatusEffect(effect)
player.removeStatusEffect(effectName)

// Story Flags
player.hasFlag(flag)           // Returns boolean
player.addFlag(flag)

// Serialization
const json = player.toJSON()
const player2 = Player.fromJSON(json)
```

---

## 📍 Location Class

### Constructor
```javascript
const location = new Location(id, name);
```

### Properties
```javascript
location.id                    // string
location.name                  // string
location.controllingFactionId  // string | null
location.population            // int
location.wealth                // float (0-100)
location.stability             // float (0-100)
location.dangerLevel           // float (0-100)
location.description           // string
```

### Methods
```javascript
const json = location.toJSON()
const loc2 = Location.fromJSON(json)
```

---

## 🏰 Faction Class

### Constructor
```javascript
const faction = new Faction(id, name);
```

### Properties
```javascript
faction.id                     // string
faction.name                   // string
faction.power                  // float (0-100)
faction.resources              // float (0-100)
faction.aggression             // float (0-100)
faction.stability              // float (0-100)
faction.relations              // Map<factionId, int>
faction.description            // string

// Phase 3: Long-term Goals & Strategy
faction.longTermGoals          // Array<Goal> - 1-3 primary goals
faction.currentStrategy        // Strategy | null - current active strategy
faction.strategicState         // Object - cached situation assessment
faction.lastStrategicUpdate    // int - timestamp of last strategic update
```

### Methods
```javascript
// Relations
faction.getRelation(factionId)         // Returns -100...+100
faction.setRelation(factionId, value)  // Sets -100...+100

// Phase 3
faction.isActive()                     // Returns true if power > 10 && stability > 10

// Serialization
const json = faction.toJSON()
const faction2 = Faction.fromJSON(json)
```

---

## 🎯 Goal Class (Phase 3)

### Constructor
```javascript
const goal = new Goal(type, target, priority);
```

### Properties
```javascript
goal.type       // string: "expand_territory", "destroy_faction", "economic_dominance", "survival", etc.
goal.target     // string | null - factionId or locationId
goal.priority   // int (0-100) - higher = more important
goal.progress   // float (0.0-1.0) - optional progress tracking
```

### Methods
```javascript
const json = goal.toJSON()
const goal2 = Goal.fromJSON(json)
```

---

## ⚔️ Strategy Class (Phase 3)

### Constructor
```javascript
const strategy = new Strategy(name, score);
```

### Properties
```javascript
strategy.name                     // string: "expansion", "defensive", "economic_recovery", etc.
strategy.score                    // float (0.0-1.0) - how well it fits current situation
strategy.startTime                // int - timestamp when strategy was chosen
strategy.expectedDurationDays     // int - estimated duration in days
```

### Methods
```javascript
const json = strategy.toJSON()
const strategy2 = Strategy.fromJSON(json)
```

---

## 🧙 NPC Class

### Constructor
```javascript
const npc = new NPC(id, locationId, factionId);
```

### Properties
```javascript
npc.id                         // string
npc.locationId                 // string
npc.factionId                  // string | null
npc.name                       // string
npc.description                // string
npc.trust                      // int (0-100)
npc.fear                       // int (0-100)
npc.respect                    // int (0-100)
npc.ambition                   // int (0-100)
npc.loyalty                    // int (0-100)
npc.statusEffects              // Array<StatusEffect>
npc.hp, npc.maxHp              // int
```

### Methods
```javascript
npc.addStatusEffect(effect)
npc.removeStatusEffect(effectName)

const json = npc.toJSON()
const npc2 = NPC.fromJSON(json)
```

---

## ⚡ StatusEffect Class

### Constructor
```javascript
const effect = new StatusEffect(name, durationMinutes, effectType, magnitude);
// Example:
const starving = new StatusEffect('starving', 60, 'hp_drain', 0.5);
```

### Properties
```javascript
effect.name                    // string
effect.remainingMinutes        // float
effect.effectType              // string
effect.magnitude               // float
```

### Methods
```javascript
// Decrease duration by minutes, returns true if expired
const isExpired = effect.tick(minutes);
```

### Effect Types
```javascript
'hp_regen_modifier'
'stamina_drain'
'hp_drain'
'all_stats_drain'
// Add more as needed
```

---

## 🔄 ActionResult Class

### Constructor
```javascript
const result = new ActionResult(success, message, timeCostMinutes, worldChanges);
// Example:
const result = new ActionResult(
    true,
    "You successfully talked to the merchant",
    15,
    [new WorldChange('reputation_changed', 'merchants_guild', +10, '...', 'local')]
);
```

### Properties
```javascript
result.success                 // boolean
result.message                 // string
result.timeCostMinutes         // int (minimum 1)
result.worldChanges            // Array<WorldChange>
```

### Methods
```javascript
const json = result.toJSON()
const result2 = ActionResult.fromJSON(json)
```

---

## 🌍 WorldChange Class

### Constructor
```javascript
const change = new WorldChange(type, targetId, delta, description, scope);
// Example:
const change = new WorldChange(
    'reputation_changed',
    'kingdom',
    +25,
    'King appreciates your heroism',
    'regional'
);
```

### Properties
```javascript
change.type                    // string
change.targetId                // string | null
change.delta                   // any
change.description             // string
change.scope                   // "local" | "regional" | "global"
change.staticImportance        // float (0.0-1.0) - auto-calculated
```

### Change Types
```javascript
'player_death'                 // 1.00
'faction_destroyed'            // 0.95
'capital_lost'                 // 0.90
'war_declared'                 // 0.80
'leader_assassinated'          // 0.75
'reputation_changed'           // 0.40 or 0.15
'npc_killed'                   // 0.70
'location_control_changed'     // 0.60
'gold_changed'                 // 0.25
'hp_changed'                   // 0.30
'status_effect_added'          // 0.35
'status_effect_removed'        // 0.20
'trade_happened'               // 0.08
'travel_happened'              // 0.15
'conversation_happened'        // 0.05
'item_bought'                  // 0.02
```

### Methods
```javascript
const json = change.toJSON()
const change2 = WorldChange.fromJSON(json)
```

---

## 🎯 Common Usage Patterns

### Initialize Game
```javascript
// Create world
state.world = World.createStarterWorld(playerName, 'town_central');

// Update UI
updateGameHUD();
```

### Process Player Action
```javascript
// Advance time
state.world.advanceWorldTime(10);  // 10 minutes

// Log change
const change = new WorldChange(
    'conversation_happened',
    null,
    true,
    'Player talked to NPC',
    'local'
);
state.world.logWorldChange(change);

// Update UI
updateGameHUD();
```

### Save Game
```javascript
const saveData = {
    character: characterData,
    world: state.world.toJSON(),
    gameState: state.gameState,
    story: elements.gameStory.innerHTML,
    timestamp: new Date().toISOString(),
    version: '1.1'
};
localStorage.setItem('rpg_save', JSON.stringify(saveData));
```

### Load Game
```javascript
const saveData = JSON.parse(localStorage.getItem('rpg_save'));
state.world = World.fromJSON(saveData.world);
updateGameHUD();
```

### Check Survival Status
```javascript
const player = state.world.player;
if (player.hunger >= 80) {
    console.log('Player is starving!');
}
if (player.thirst >= 80) {
    console.log('Player is dehydrated!');
}
if (player.fatigue >= 80) {
    console.log('Player is exhausted!');
}
```

### Get World Context for AI
```javascript
const context = buildWorldContext();
// Returns formatted string with all world state
```

---

## 📊 Default Configuration

```javascript
DEFAULT_REGEN = {
    hp: 1,           // per minute
    stamina: 2,      // per minute
    mana: 0.5        // per minute
};

DEFAULT_CONSUMPTION = {
    hunger: 0.5,     // per minute
    thirst: 1.0,     // per minute
    fatigue: 0.3     // per minute
};

STATUS_THRESHOLDS = {
    starving: 80,    // hunger >= 80
    dehydrated: 80,  // thirst >= 80
    exhausted: 80    // fatigue >= 80
};
```

---

## 🔍 Debugging

### Check World State
```javascript
console.log(state.world);
console.log(state.world.currentTimeMinutes);
console.log(state.world.player);
console.log(state.world.locations);
console.log(state.world.factions);
console.log(state.world.npcs);
console.log(state.world.worldLog);
```

### Check Player Status
```javascript
const p = state.world.player;
console.log(`HP: ${p.hp}/${p.maxHp}`);
console.log(`Hunger: ${p.hunger}%`);
console.log(`Reputation: ${p.reputation}`);
console.log(`Status Effects: ${p.statusEffects.map(e => e.name)}`);
```

### Validate Serialization
```javascript
const json = state.world.toJSON();
const restored = World.fromJSON(json);
console.log(restored.currentTimeMinutes === state.world.currentTimeMinutes);
```

---

## ⚠️ Important Notes

1. **Time is Sacred**: Only use `advanceWorldTime()` to change time
2. **Minimum Time Cost**: Actions must cost at least 1 minute
3. **No Negative Time**: System will throw error if you try
4. **Serialization**: Always use `toJSON()`/`fromJSON()` for save/load
5. **Status Effects**: Automatically removed when duration reaches 0
6. **Survival Stats**: Automatically trigger status effects at 80%
7. **Phase 3 Strategy**: Strategic updates run every 7 days automatically

---

## 🚀 Next Steps

- Phase 4: Combat System
- Phase 5: Inventory System
- Phase 6: Quest System

All built on top of this solid Phase 1-3 foundation!

---

**Last Updated**: March 4, 2026  
**Version**: 3.0  
**Status**: ✅ Phase 3 Complete
