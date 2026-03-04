/**
 * AI RPG Engine - Phase 2: Event & Future Simulation Engine
 * 
 * Implementation of the specification:
 * - Phase 1: Global simulation clock (current_time_minutes)
 * - Phase 2: Event queue system with priority heap
 * - Event types: war_battle, war_declared, economic_crisis, npc_move, etc.
 * - Strategic AI: faction planning and event generation
 * - Throttling and hard limits
 */

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const IMPORTANCE_TABLE = {
    "player_death": 1.00,
    "faction_destroyed": 0.95,
    "capital_lost": 0.90,
    "war_declared": 0.80,
    "leader_assassinated": 0.75,
    "reputation_changed": 0.40,
    "conversation_happened": 0.05,
    "item_bought": 0.02,
    "npc_killed": 0.70,
    "location_control_changed": 0.60,
    "gold_changed": 0.25,
    "hp_changed": 0.30,
    "status_effect_added": 0.35,
    "status_effect_removed": 0.20,
    "trade_happened": 0.08,
    "travel_happened": 0.15,
    // Phase 2: Event-related changes
    "war_battle": 0.75,
    "war_ended": 0.65,
    "economic_crisis": 0.55,
    "npc_moved": 0.15,
    "assassination_failed": 0.30,
    "rebellion": 0.70,
    "famine": 0.65,
    "plague": 0.70,
    "faction_power_changed": 0.50,
    "faction_resources_changed": 0.45,
    "location_wealth_changed": 0.35,
    "location_stability_changed": 0.40
};

// Default regeneration rates (per minute)
const DEFAULT_REGEN = {
    hp: 1,
    stamina: 2,
    mana: 0.5
};

// Default consumption rates (per minute)
const DEFAULT_CONSUMPTION = {
    hunger: 0.5,
    thirst: 1.0,
    fatigue: 0.3
};

// Status effect thresholds
const STATUS_THRESHOLDS = {
    starving: 80,      // hunger >= 80
    dehydrated: 80,    // thirst >= 80
    exhausted: 80      // fatigue >= 80
};

// Phase 2: Event & Future Simulation Engine limits
const EVENT_LIMITS = {
    MAX_EVENTS_PER_WEEK_REAL_TIME: 180,      // ~25 per day
    MAX_ACTIVE_WARS: 5,
    MAX_QUEUED_EVENTS_HARD_CAP: 1200,
    MAX_PLANNED_EVENTS_PER_FACTION: 8,
    MAX_BATTLES_PER_MONTH: 40
};

const STRATEGIC_UPDATE_INTERVAL = 10080; // 7 days in minutes

// Phase 3: Goal types
const GOAL_TYPES = [
    "expand_territory",
    "destroy_faction",
    "economic_dominance",
    "survival",
    "religious_conversion",
    "alliance_formation",
    "cultural_dominance",
    "military_supremacy"
];

// Phase 3: Strategy names
const STRATEGY_NAMES = [
    "maintain_status_quo",
    "internal_stabilization",
    "expansion",
    "defensive",
    "economic_recovery",
    "covert_operations",
    "total_war",
    "diplomatic_coalition"
];

// Phase 4: Contextual Memory System constants
const MEMORY_CONFIG = {
    COMPRESSION_INTERVAL: 30,              // Actions before compression (20-40)
    MIN_COMPRESSION_INTERVAL: 20,
    MAX_COMPRESSION_INTERVAL: 40,
    MAX_LIVE_STATE_TOKENS: 1500,           // Max tokens for Live State
    MAX_HISTORY_TOKENS: 2500,              // Max tokens for history nodes
    MAX_CONTEXT_TOKENS: 4000,              // Total max context (Live State + History)
    MAX_NODES_PER_CONTEXT: 8,              // Max history nodes to include
    MIN_NODE_RELEVANCE: 0.15,              // Minimum relevance score to consider
    IMPORTANCE_THRESHOLD: 0.4,             // Threshold for "major events"
    MAX_WARS_IN_CONTEXT: 3,                // Max active wars in Live State
    MAX_REPUTATIONS_IN_CONTEXT: 5,         // Max reputations in Live State
    MAX_MAJOR_EVENTS_IN_CONTEXT: 5,        // Max recent major events
    NPC_MEMORY_DEPTH: 4                    // How many recent interactions to remember per NPC
};

// Scene types for context selection
const SCENE_TYPES = [
    "dialog",          // Conversation with NPC
    "combat",          // Battle/fighting
    "exploration",     // Exploring new area
    "trade",           // Buying/selling
    "rest",            // Resting/healing
    "travel",          // Moving between locations
    "default"          // Generic scene
];

// Scene tags for relevance scoring
const SCENE_TAGS = [
    "player_action",   // Player initiated
    "npc_interaction", // Involves NPC
    "combat",          // Combat related
    "political",       // Political intrigue
    "economic",        // Trade/money related
    "exploration",     // Discovery/travel
    "social",          // Social interaction
    "mystery",         // Mystery/clue
    "danger",          // Dangerous situation
    "peaceful",        // Calm/safe situation
    "major_event"      // World-changing event
];

// ============================================================================
// DATA STRUCTURES
// ============================================================================

/**
 * Represents a single world change that occurred during an action
 */
class WorldChange {
    constructor(type, targetId, delta, description, scope) {
        this.type = type;                    // "reputation_changed", "npc_killed", etc.
        this.targetId = targetId;            // faction_id, npc_id, location_id
        this.delta = delta;                  // int, float, bool, str
        this.description = description;      // Human-readable version
        this.scope = scope;                  // "local" | "regional" | "global"
        this.staticImportance = this._calculateImportance();
    }

    _calculateImportance() {
        if (this.type === "reputation_changed" && typeof this.delta === "number") {
            return Math.abs(this.delta) >= 30 ? 0.40 : 0.15;
        }
        return IMPORTANCE_TABLE[this.type] || 0.1;
    }

    toJSON() {
        return {
            type: this.type,
            targetId: this.targetId,
            delta: this.delta,
            description: this.description,
            scope: this.scope,
            staticImportance: this.staticImportance
        };
    }

    static fromJSON(json) {
        return new WorldChange(
            json.type,
            json.targetId,
            json.delta,
            json.description,
            json.scope
        );
    }
}

/**
 * Result of any player action
 */
class ActionResult {
    constructor(success, message, timeCostMinutes, worldChanges = []) {
        this.success = success;
        this.message = message;
        this.timeCostMinutes = Math.max(1, timeCostMinutes); // Minimum 1 minute
        this.worldChanges = worldChanges;
    }

    toJSON() {
        return {
            success: this.success,
            message: this.message,
            timeCostMinutes: this.timeCostMinutes,
            worldChanges: this.worldChanges.map(wc => wc.toJSON())
        };
    }

    static fromJSON(json) {
        const worldChanges = (json.worldChanges || []).map(wc => WorldChange.fromJSON(wc));
        return new ActionResult(
            json.success,
            json.message,
            json.timeCostMinutes,
            worldChanges
        );
    }
}

// ============================================================================
// PHASE 4: CONTEXTUAL MEMORY SYSTEM
// ============================================================================

/**
 * Phase 4: HistoryNode - compressed narrative memory unit
 * Used for LLM context summarization (Summaries layer)
 */
class HistoryNode {
    constructor() {
        this.nodeId = this._generateUUID();
        this.parentId = null;
        this.branchId = "main";                    // "main", "iron_war_1342", "player_betrayal"
        this.timeStartMinutes = 0;
        this.timeEndMinutes = 0;
        this.tags = new Set();                     // e.g., "player_action", "combat", "political"
        this.staticImportance = 0.0;
        this.dynamicImportance = 0.0;
        this.finalImportance = 0.0;
        this.persistent = false;
        this.relevanceScore = 1.0;
        this.lastReferencedTime = 0;
        this.causedBy = [];                        // nodeId[]
        this.causes = [];                          // nodeId[]
        this.summaryText = "";                     // 80–300 tokens (compressed)
        this.level = 1;                            // 1 = session/chapter, 2 = arc/month
    }

    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Calculate final importance score
     * Combines static importance with dynamic factors
     */
    calculateFinalImportance(currentTimeMinutes) {
        // Time decay factor: older events lose relevance
        const daysOld = (currentTimeMinutes - this.timeEndMinutes) / 1440;
        const timeDecay = Math.max(0.3, 1 - (daysOld * 0.02)); // Max 70% decay

        // Dynamic importance can increase if recently referenced
        const referenceBonus = this.lastReferencedTime > 0 
            ? Math.min(0.2, (currentTimeMinutes - this.lastReferencedTime) / 14400) // Max 0.2 for recent reference
            : 0;

        this.dynamicImportance = timeDecay + referenceBonus;
        this.finalImportance = (this.staticImportance * 0.6) + (this.dynamicImportance * 0.4);
        return this.finalImportance;
    }

    /**
     * Add a tag to this node
     */
    addTag(tag) {
        this.tags.add(tag);
    }

    /**
     * Check if node has any of the given tags
     */
    hasAnyTag(tagArray) {
        return tagArray.some(tag => this.tags.has(tag));
    }

    /**
     * Check if node has all given tags
     */
    hasAllTags(tagArray) {
        return tagArray.every(tag => this.tags.has(tag));
    }

    toJSON() {
        return {
            nodeId: this.nodeId,
            parentId: this.parentId,
            branchId: this.branchId,
            timeStartMinutes: this.timeStartMinutes,
            timeEndMinutes: this.timeEndMinutes,
            tags: Array.from(this.tags),
            staticImportance: this.staticImportance,
            dynamicImportance: this.dynamicImportance,
            finalImportance: this.finalImportance,
            persistent: this.persistent,
            relevanceScore: this.relevanceScore,
            lastReferencedTime: this.lastReferencedTime,
            causedBy: this.causedBy,
            causes: this.causes,
            summaryText: this.summaryText,
            level: this.level
        };
    }

    static fromJSON(json) {
        const node = new HistoryNode();
        node.nodeId = json.nodeId;
        node.parentId = json.parentId;
        node.branchId = json.branchId;
        node.timeStartMinutes = json.timeStartMinutes;
        node.timeEndMinutes = json.timeEndMinutes;
        node.tags = new Set(json.tags || []);
        node.staticImportance = json.staticImportance;
        node.dynamicImportance = json.dynamicImportance;
        node.finalImportance = json.finalImportance;
        node.persistent = json.persistent;
        node.relevanceScore = json.relevanceScore;
        node.lastReferencedTime = json.lastReferencedTime;
        node.causedBy = json.causedBy || [];
        node.causes = json.causes || [];
        node.summaryText = json.summaryText;
        node.level = json.level;
        return node;
    }
}

/**
 * Status effect applied to an entity
 */
class StatusEffect {
    constructor(name, durationMinutes, effectType, magnitude = 1.0) {
        this.name = name;
        this.remainingMinutes = durationMinutes;
        this.effectType = effectType;  // "hp_regen_modifier", "stamina_drain", etc.
        this.magnitude = magnitude;
    }

    tick(minutes) {
        this.remainingMinutes = Math.max(0, this.remainingMinutes - minutes);
        return this.remainingMinutes <= 0;
    }
}

/**
 * Phase 2: World Event - scheduled future event in the world
 */
class WorldEvent {
    constructor(
        eventId,
        type,
        executeAt,
        scope,
        data,
        priority = 100,
        hiddenFromPlayer = true,
        scheduledBy = null,
        importanceHint = 0.0
    ) {
        this.eventId = eventId;              // Unique identifier (UUID or timestamp + hash)
        this.type = type;                     // "war_battle", "economic_crisis", etc.
        this.executeAt = executeAt;           // current_time_minutes when event executes
        this.priority = priority;             // 1-1000, higher = earlier for same time
        this.scope = scope;                   // "local" | "regional" | "global"
        this.data = data;                     // Event-specific parameters
        this.hiddenFromPlayer = hiddenFromPlayer;
        this.scheduledBy = scheduledBy;       // faction_id | "player" | "system"
        this.importanceHint = importanceHint; // 0.0-1.0, used in Phase 5
    }

    toJSON() {
        return {
            eventId: this.eventId,
            type: this.type,
            executeAt: this.executeAt,
            priority: this.priority,
            scope: this.scope,
            data: this.data,
            hiddenFromPlayer: this.hiddenFromPlayer,
            scheduledBy: this.scheduledBy,
            importanceHint: this.importanceHint
        };
    }

    static fromJSON(json) {
        return new WorldEvent(
            json.eventId,
            json.type,
            json.executeAt,
            json.scope,
            json.data,
            json.priority,
            json.hiddenFromPlayer,
            json.scheduledBy,
            json.importanceHint
        );
    }
}

/**
 * Phase 2: MinHeap - priority queue for events
 */
class MinHeap {
    constructor() {
        this.heap = [];
    }

    push(item) {
        this.heap.push(item);
        this._bubbleUp(this.heap.length - 1);
    }

    pop() {
        if (this.heap.length === 0) return null;
        const result = this.heap[0];
        const last = this.heap.pop();
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this._bubbleDown(0);
        }
        return result;
    }

    peek() {
        return this.heap[0] || null;
    }

    get length() {
        return this.heap.length;
    }

    _bubbleUp(index) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (this._compare(this.heap[index], this.heap[parentIndex]) >= 0) break;
            [this.heap[index], this.heap[parentIndex]] = [this.heap[parentIndex], this.heap[index]];
            index = parentIndex;
        }
    }

    _bubbleDown(index) {
        while (true) {
            const leftChild = 2 * index + 1;
            const rightChild = 2 * index + 2;
            let smallest = index;

            if (leftChild < this.heap.length && 
                this._compare(this.heap[leftChild], this.heap[smallest]) < 0) {
                smallest = leftChild;
            }
            if (rightChild < this.heap.length && 
                this._compare(this.heap[rightChild], this.heap[smallest]) < 0) {
                smallest = rightChild;
            }
            if (smallest === index) break;
            [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
            index = smallest;
        }
    }

    _compare(a, b) {
        // Compare by executeAt first, then priority, then counter
        if (a[0] !== b[0]) return a[0] - b[0];
        if (a[1] !== b[1]) return a[1] - b[1];
        return a[2] - b[2];
    }
}

/**
 * Phase 2: EventQueue - manages scheduled world events
 */
class EventQueue {
    constructor() {
        this._heap = new MinHeap();
        this._counter = 0;
    }

    /**
     * Schedule an event
     * @param {WorldEvent} event 
     */
    schedule(event) {
        this._heap.push([
            event.executeAt,
            event.priority,
            this._counter,
            event
        ]);
        this._counter++;
    }

    /**
     * Peek at earliest event without removing
     * @returns {WorldEvent|null}
     */
    peek() {
        const entry = this._heap.peek();
        return entry ? entry[3] : null;
    }

    /**
     * Pop and return earliest event
     * @returns {WorldEvent}
     */
    popEarliest() {
        const entry = this._heap.pop();
        return entry ? entry[3] : null;
    }

    /**
     * Process all events up to target time
     * @param {World} world 
     * @param {number} targetTime 
     */
    processUpTo(world, targetTime) {
        while (this._heap.length > 0) {
            const entry = this._heap.peek();
            if (!entry || entry[0] > targetTime) break;
            
            const event = this.popEarliest();
            world.resolveEvent(event);
        }
    }

    /**
     * Get queue count
     * @returns {number}
     */
    count() {
        return this._heap.length;
    }

    /**
     * Count events by type
     * @param {string} eventType 
     * @returns {number}
     */
    countByType(eventType) {
        // Note: MinHeap doesn't support iteration, so we track counts separately
        return 0;
    }

    /**
     * Count events scheduled by a faction
     * @param {string} factionId 
     * @returns {number}
     */
    countByFaction(factionId) {
        return 0;
    }

    toJSON() {
        return {
            heap: this._heap.heap.map(entry => [
                entry[0],
                entry[1],
                entry[2],
                entry[3].toJSON()
            ]),
            counter: this._counter
        };
    }

    static fromJSON(json) {
        const queue = new EventQueue();
        queue._counter = json.counter;
        for (const entry of json.heap) {
            queue._heap.heap.push([
                entry[0],
                entry[1],
                entry[2],
                WorldEvent.fromJSON(entry[3])
            ]);
        }
        return queue;
    }
}

// ============================================================================
// ENTITY CLASSES
// ============================================================================

/**
 * Location in the game world
 */
class Location {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.controllingFactionId = null;
        this.population = 0;
        this.wealth = 50;        // 0-100
        this.stability = 50;     // 0-100
        this.dangerLevel = 0;    // 0-100
        this.description = "";
        
        // Optional: buildings, garrison, tradeRoutes (Phase 2+)
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            controllingFactionId: this.controllingFactionId,
            population: this.population,
            wealth: this.wealth,
            stability: this.stability,
            dangerLevel: this.dangerLevel,
            description: this.description
        };
    }

    static fromJSON(json) {
        const loc = new Location(json.id, json.name);
        loc.controllingFactionId = json.controllingFactionId;
        loc.population = json.population;
        loc.wealth = json.wealth;
        loc.stability = json.stability;
        loc.dangerLevel = json.dangerLevel;
        loc.description = json.description || "";
        return loc;
    }
}

/**
 * Faction in the game world
 */
class Faction {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.power = 50;         // 0-100
        this.resources = 50;     // 0-100
        this.aggression = 50;    // 0-100
        this.stability = 50;     // 0-100
        this.relations = new Map(); // factionId -> -100...+100
        this.description = "";
        
        // Phase 3: Long-term goals and strategy
        this.longTermGoals = [];        // array of Goal (1-3 primary goals)
        this.currentStrategy = null;    // Strategy object or null
        this.strategicState = {};       // cache of current situation assessment
        this.lastStrategicUpdate = 0;   // current_time_minutes of last update
    }

    getRelation(factionId) {
        return this.relations.get(factionId) || 0;
    }

    setRelation(factionId, value) {
        this.relations.set(factionId, Math.max(-100, Math.min(100, value)));
    }

    toJSON() {
        return {
            id: this.id,
            name: this.name,
            power: this.power,
            resources: this.resources,
            aggression: this.aggression,
            stability: this.stability,
            relations: Object.fromEntries(this.relations),
            description: this.description,
            // Phase 3: Goals and strategy
            longTermGoals: this.longTermGoals.map(g => g.toJSON ? g.toJSON() : g),
            currentStrategy: this.currentStrategy ? this.currentStrategy.toJSON() : null,
            strategicState: this.strategicState,
            lastStrategicUpdate: this.lastStrategicUpdate
        };
    }

    static fromJSON(json) {
        const faction = new Faction(json.id, json.name);
        faction.power = json.power;
        faction.resources = json.resources;
        faction.aggression = json.aggression;
        faction.stability = json.stability;
        faction.relations = new Map(json.relations || {});
        faction.description = json.description || "";
        
        // Phase 3: Goals and strategy
        faction.longTermGoals = (json.longTermGoals || []).map(g => Goal.fromJSON ? Goal.fromJSON(g) : g);
        faction.currentStrategy = json.currentStrategy ? Strategy.fromJSON(json.currentStrategy) : null;
        faction.strategicState = json.strategicState || {};
        faction.lastStrategicUpdate = json.lastStrategicUpdate || 0;
        
        return faction;
    }

    /**
     * Phase 3: Check if faction is active (not destroyed)
     * @returns {boolean}
     */
    isActive() {
        return this.power > 10 && this.stability > 10;
    }
}

/**
 * Phase 3: Long-term goal for a faction
 */
class Goal {
    constructor(type, target = null, priority = 50) {
        this.type = type;                 // string: "expand_territory", "destroy_faction", etc.
        this.target = target;             // factionId, locationId or null
        this.priority = priority;         // 0-100 - higher = more important
        this.progress = 0.0;              // 0.0-1.0 - optional, if goal has measurable progress
    }

    toJSON() {
        return {
            type: this.type,
            target: this.target,
            priority: this.priority,
            progress: this.progress
        };
    }

    static fromJSON(json) {
        return new Goal(json.type, json.target, json.priority);
    }
}

/**
 * Phase 3: Current strategy for a faction
 */
class Strategy {
    constructor(name, score = 0.0) {
        this.name = name;                     // "expansion", "defensive", etc.
        this.score = score;                   // 0.0-1.0 - how well it fits current situation
        this.startTime = 0;                   // when strategy was chosen
        this.expectedDurationDays = 30;       // estimated duration
    }

    toJSON() {
        return {
            name: this.name,
            score: this.score,
            startTime: this.startTime,
            expectedDurationDays: this.expectedDurationDays
        };
    }

    static fromJSON(json) {
        const strategy = new Strategy(json.name, json.score);
        strategy.startTime = json.startTime || 0;
        strategy.expectedDurationDays = json.expectedDurationDays || 30;
        return strategy;
    }
}

/**
 * Non-Player Character
 */
class NPC {
    constructor(id, locationId, factionId = null) {
        this.id = id;
        this.locationId = locationId;
        this.factionId = factionId;
        
        // Player relationships (0-100)
        this.trust = 50;
        this.fear = 0;
        this.respect = 50;
        this.ambition = 50;
        this.loyalty = 50;
        
        // Additional fields
        this.name = "";
        this.description = "";
        this.statusEffects = [];
        
        // Combat stats (optional for Phase 1)
        this.hp = 50;
        this.maxHp = 50;
    }

    addStatusEffect(effect) {
        this.statusEffects.push(effect);
    }

    removeStatusEffect(effectName) {
        this.statusEffects = this.statusEffects.filter(e => e.name !== effectName);
    }

    toJSON() {
        return {
            id: this.id,
            locationId: this.locationId,
            factionId: this.factionId,
            trust: this.trust,
            fear: this.fear,
            respect: this.respect,
            ambition: this.ambition,
            loyalty: this.loyalty,
            name: this.name,
            description: this.description,
            statusEffects: this.statusEffects.map(e => ({
                name: e.name,
                remainingMinutes: e.remainingMinutes,
                effectType: e.effectType,
                magnitude: e.magnitude
            })),
            hp: this.hp,
            maxHp: this.maxHp
        };
    }

    static fromJSON(json) {
        const npc = new NPC(json.id, json.locationId, json.factionId);
        npc.trust = json.trust;
        npc.fear = json.fear;
        npc.respect = json.respect;
        npc.ambition = json.ambition;
        npc.loyalty = json.loyalty;
        npc.name = json.name || "";
        npc.description = json.description || "";
        npc.statusEffects = (json.statusEffects || []).map(e => 
            new StatusEffect(e.name, e.remainingMinutes, e.effectType, e.magnitude)
        );
        npc.hp = json.hp;
        npc.maxHp = json.maxHp;
        return npc;
    }
}

/**
 * Player character
 */
class Player {
    constructor(name, locationId) {
        this.name = name;
        this.locationId = locationId;
        
        // Resources
        this.gold = 100;
        this.hp = 100;
        this.maxHp = 100;
        this.stamina = 100;
        this.maxStamina = 100;
        this.mana = 50;
        this.maxMana = 50;
        
        // Survival stats (0-100, higher = more depleted)
        this.hunger = 0;
        this.thirst = 0;
        this.fatigue = 0;
        
        // Faction reputation (factionId -> -100...+100)
        this.reputation = new Map();
        
        // Status effects
        this.statusEffects = [];
        
        // Story flags (strings like "killed_lord_v", "joined_cult_x")
        this.storyFlags = new Set();
        
        // Inventory (Phase 2+)
        this.inventory = [];
    }

    addStatusEffect(effect) {
        this.statusEffects.push(effect);
    }

    removeStatusEffect(effectName) {
        this.statusEffects = this.statusEffects.filter(e => e.name !== effectName);
    }

    hasFlag(flag) {
        return this.storyFlags.has(flag);
    }

    addFlag(flag) {
        this.storyFlags.add(flag);
    }

    getReputation(factionId) {
        return this.reputation.get(factionId) || 0;
    }

    setReputation(factionId, value) {
        this.reputation.set(factionId, Math.max(-100, Math.min(100, value)));
    }

    changeReputation(factionId, delta) {
        const current = this.getReputation(factionId);
        this.setReputation(factionId, current + delta);
    }

    toJSON() {
        return {
            name: this.name,
            locationId: this.locationId,
            gold: this.gold,
            hp: this.hp,
            maxHp: this.maxHp,
            stamina: this.stamina,
            maxStamina: this.maxStamina,
            mana: this.mana,
            maxMana: this.maxMana,
            hunger: this.hunger,
            thirst: this.thirst,
            fatigue: this.fatigue,
            reputation: Object.fromEntries(this.reputation),
            statusEffects: this.statusEffects.map(e => ({
                name: e.name,
                remainingMinutes: e.remainingMinutes,
                effectType: e.effectType,
                magnitude: e.magnitude
            })),
            storyFlags: Array.from(this.storyFlags),
            inventory: this.inventory
        };
    }

    static fromJSON(json) {
        const player = new Player(json.name, json.locationId);
        player.gold = json.gold;
        player.hp = json.hp;
        player.maxHp = json.maxHp;
        player.stamina = json.stamina;
        player.maxStamina = json.maxStamina;
        player.mana = json.mana;
        player.maxMana = json.maxMana;
        player.hunger = json.hunger;
        player.thirst = json.thirst;
        player.fatigue = json.fatigue;
        player.reputation = new Map(json.reputation || {});
        player.statusEffects = (json.statusEffects || []).map(e => 
            new StatusEffect(e.name, e.remainingMinutes, e.effectType, e.magnitude)
        );
        player.storyFlags = new Set(json.storyFlags || []);
        player.inventory = json.inventory || [];
        return player;
    }
}

// ============================================================================
// WORLD CLASS - MAIN ENGINE
// ============================================================================

/**
 * Main world engine - contains all game state and simulation logic
 */
class World {
    constructor() {
        // Global simulation clock - minutes from arbitrary epoch
        this.currentTimeMinutes = 0;
        
        // Entity storage
        this.locations = new Map();   // locationId -> Location
        this.factions = new Map();    // factionId -> Faction
        this.npcs = new Map();        // npcId -> NPC
        this.player = null;
        
        // Phase 2: Event queue
        this.eventQueue = new EventQueue();
        
        // Phase 2: Track active wars
        this.activeWars = new Map();  // attackerId -> Set of defenderIds
        
        // World log - all changes that occurred
        this.worldLog = [];
        
        // Phase 3: Strategic tracking
        this.lastGlobalStrategicUpdate = 0;  // last strategic update timestamp
        
        // Phase 4: Contextual Memory System
        this.historyNodes = [];              // HistoryNode[] (Summaries layer)
        this.rawChangeLog = [];              // WorldChange[] (Raw Archive layer)
        this.actionCountSinceLastCompression = 0;
        this.currentNpcMemory = new Map();   // npcId -> recent interactions
        
        // Configuration
        this.config = {
            regenRates: { ...DEFAULT_REGEN },
            consumptionRates: { ...DEFAULT_CONSUMPTION },
            statusThresholds: { ...STATUS_THRESHOLDS },
            eventLimits: { ...EVENT_LIMITS }
        };
        
        // RNG seed (optional)
        this.seed = null;
    }

    // ========================================================================
    // TIME MANAGEMENT
    // ========================================================================

    /**
     * Advance world time - THE ONLY LEGAL METHOD to change time
     * @param {number} minutes - Minutes to advance (must be >= 0)
     * @throws {Error} If minutes is negative
     */
    advanceWorldTime(minutes) {
        if (minutes < 0) {
            throw new Error("Cannot rewind time");
        }
        
        this.currentTimeMinutes += minutes;
        
        // Process time-dependent systems
        this.updateTimeDependentSystems(minutes);
        
        // Phase 2: Process events that should have executed
        if (this.eventQueue) {
            this.eventQueue.processUpTo(this, this.currentTimeMinutes);
        }
        
        // Phase 2: Strategic updates (every 7 days)
        this.strategicUpdate();
    }

    /**
     * Update all systems that depend on time passage
     * Called after every time advancement
     * @param {number} minutes - Minutes that passed
     */
    updateTimeDependentSystems(minutes) {
        if (!this.player) return;
        
        const player = this.player;
        const cfg = this.config;
        
        // 1. Regeneration of HP/Stamina/Mana
        this._updateResource(player, 'hp', cfg.regenRates.hp, minutes, player.maxHp);
        this._updateResource(player, 'stamina', cfg.regenRates.stamina, minutes, player.maxStamina);
        this._updateResource(player, 'mana', cfg.regenRates.mana, minutes, player.maxMana);
        
        // 2. Survival stats consumption
        this._updateSurvivalStats(player, minutes);
        
        // 3. Update status effects duration
        this._updateStatusEffects(player, minutes);
        
        // 4. Update NPC status effects
        for (const npc of this.npcs.values()) {
            this._updateStatusEffects(npc, minutes);
        }
        
        // 5. Natural economic refresh (optional - very small multiplier)
        this._updateEconomicState(minutes);
        
        // 6. Weather change (optional - if implemented)
        // this._updateWeather(minutes);
        
        // 7. NPC aging (optional - if age matters)
        // this._updateNPCAges(minutes);
    }

    /**
     * Update a single resource (HP/Stamina/Mana)
     */
    _updateResource(entity, resourceName, ratePerMinute, minutes, maxValue) {
        const current = entity[resourceName];
        const newValue = Math.min(maxValue, current + (ratePerMinute * minutes));
        entity[resourceName] = newValue;
        
        // Check for status effect modifications
        const statusMod = this._getStatusEffectModifier(entity, `${resourceName}_regen_modifier`);
        if (statusMod !== 1.0) {
            const modifiedValue = Math.min(maxValue, current + (ratePerMinute * minutes * statusMod));
            entity[resourceName] = modifiedValue;
        }
    }

    /**
     * Update hunger, thirst, fatigue
     */
    _updateSurvivalStats(player, minutes) {
        const cfg = this.config;
        
        // Hunger
        player.hunger = Math.min(100, player.hunger + (cfg.consumptionRates.hunger * minutes));
        
        // Thirst
        player.thirst = Math.min(100, player.thirst + (cfg.consumptionRates.thirst * minutes));
        
        // Fatigue
        player.fatigue = Math.min(100, player.fatigue + (cfg.consumptionRates.fatigue * minutes));
        
        // Check thresholds and apply status effects
        this._checkSurvivalThresholds(player);
    }

    /**
     * Check survival thresholds and apply/remove status effects
     */
    _checkSurvivalThresholds(player) {
        const thresholds = this.config.statusThresholds;
        
        // Starving
        if (player.hunger >= thresholds.starving) {
            if (!player.statusEffects.find(e => e.name === 'starving')) {
                player.addStatusEffect(new StatusEffect('starving', 60, 'hp_drain', 0.5));
            }
        } else {
            player.removeStatusEffect('starving');
        }
        
        // Dehydrated
        if (player.thirst >= thresholds.dehydrated) {
            if (!player.statusEffects.find(e => e.name === 'dehydrated')) {
                player.addStatusEffect(new StatusEffect('dehydrated', 60, 'stamina_drain', 0.5));
            }
        } else {
            player.removeStatusEffect('dehydrated');
        }
        
        // Exhausted
        if (player.fatigue >= thresholds.exhausted) {
            if (!player.statusEffects.find(e => e.name === 'exhausted')) {
                player.addStatusEffect(new StatusEffect('exhausted', 60, 'all_stats_drain', 0.7));
            }
        } else {
            player.removeStatusEffect('exhausted');
        }
    }

    /**
     * Update status effects - decrease duration and remove expired
     */
    _updateStatusEffects(entity, minutes) {
        const expired = [];
        
        for (const effect of entity.statusEffects) {
            const isExpired = effect.tick(minutes);
            if (isExpired) {
                expired.push(effect.name);
            }
            
            // Apply continuous effects
            this._applyStatusEffect(entity, effect);
        }
        
        // Remove expired effects
        for (const name of expired) {
            entity.removeStatusEffect(name);
        }
    }

    /**
     * Apply a status effect's continuous modifiers
     */
    _applyStatusEffect(entity, effect) {
        switch (effect.effectType) {
            case 'hp_drain':
                entity.hp = Math.max(0, entity.hp - (effect.magnitude * 0.1));
                break;
            case 'stamina_drain':
                entity.stamina = Math.max(0, entity.stamina - (effect.magnitude * 0.1));
                break;
            case 'all_stats_drain':
                entity.hp = Math.max(0, entity.hp - (effect.magnitude * 0.05));
                entity.stamina = Math.max(0, entity.stamina - (effect.magnitude * 0.05));
                break;
            // Add more effect types as needed
        }
    }

    /**
     * Get status effect modifier for a resource
     */
    _getStatusEffectModifier(entity, effectType) {
        for (const effect of entity.statusEffects) {
            if (effect.effectType === effectType) {
                return effect.magnitude;
            }
        }
        return 1.0;
    }

    /**
     * Update economic state (very slow natural changes)
     */
    _updateEconomicState(minutes) {
        // Very small multiplier - only matters over long play sessions
        const multiplier = minutes / (24 * 60); // Per in-game day
        
        for (const location of this.locations.values()) {
            // Small random wealth fluctuation
            location.wealth = Math.max(0, Math.min(100, 
                location.wealth + (Math.random() - 0.5) * 2 * multiplier
            ));
            
            // Small stability fluctuation
            location.stability = Math.max(0, Math.min(100,
                location.stability + (Math.random() - 0.5) * 1 * multiplier
            ));
        }
    }

    // ========================================================================
    // PHASE 2: EVENT SYSTEM
    // ========================================================================

    /**
     * Phase 2: Resolve a scheduled world event
     * This function NEVER calls LLM - pure deterministic logic
     * @param {WorldEvent} event 
     */
    resolveEvent(event) {
        const handlers = {
            "war_battle": this._resolveWarBattle.bind(this),
            "war_declared": this._resolveWarDeclared.bind(this),
            "war_ended": this._resolveWarEnded.bind(this),
            "economic_crisis": this._resolveEconomicCrisis.bind(this),
            "npc_move": this._resolveNpcMove.bind(this),
            "assassination_attempt": this._resolveAssassination.bind(this),
            "rebellion": this._resolveRebellion.bind(this),
            "famine": this._resolveFamine.bind(this),
            "plague": this._resolvePlague.bind(this)
        };

        const handler = handlers[event.type];
        if (handler) {
            const changes = handler(event);
            this._appendWorldChanges(changes);
            
            // Plan follow-up events if needed
            this._planFollowUpEvents(event);
        } else {
            console.warn(`Unhandled event type: ${event.type}`);
        }
    }

    /**
     * Phase 2: Resolve war battle event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveWarBattle(event) {
        const attacker = this.factions.get(event.data.attacker_faction_id);
        const defender = this.factions.get(event.data.defender_faction_id);
        const location = this.locations.get(event.data.location_id);

        if (!attacker || !defender) {
            console.warn(`Battle aborted: missing faction(s)`);
            return [];
        }

        const ratio = attacker.power / Math.max(defender.power, 1);
        let outcome;
        if (ratio > 1.25) outcome = "attacker_win";
        else if (ratio < 0.8) outcome = "defender_win";
        else outcome = "draw";

        const changes = [];

        if (outcome === "attacker_win") {
            defender.power = Math.max(0, defender.power * 0.82);
            attacker.power = Math.max(0, attacker.power * 0.94);

            if (location) {
                location.controllingFactionId = attacker.id;
                changes.push(new WorldChange(
                    "location_control_changed",
                    location.id,
                    attacker.id,
                    `${attacker.name} captures ${location.name}`,
                    "regional"
                ));
            }

            changes.push(new WorldChange(
                "faction_power_changed",
                defender.id,
                -18,
                `${defender.name} loses power after defeat`,
                "regional"
            ));
        } else if (outcome === "defender_win") {
            attacker.power = Math.max(0, attacker.power * 0.85);
            defender.power = Math.max(0, defender.power * 0.92);

            changes.push(new WorldChange(
                "faction_power_changed",
                attacker.id,
                -15,
                `${attacker.name} fails assault`,
                "regional"
            ));
        } else {
            // Draw - both sides weakened
            attacker.power = Math.max(0, attacker.power * 0.93);
            defender.power = Math.max(0, defender.power * 0.93);

            changes.push(new WorldChange(
                "faction_power_changed",
                attacker.id,
                -7,
                `Stalemate at ${location?.name || 'unknown'}`,
                "regional"
            ));
            changes.push(new WorldChange(
                "faction_power_changed",
                defender.id,
                -7,
                `Stalemate at ${location?.name || 'unknown'}`,
                "regional"
            ));
        }

        return changes;
    }

    /**
     * Phase 2: Resolve war declared event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveWarDeclared(event) {
        const attacker = this.factions.get(event.data.attacker_faction_id);
        const defender = this.factions.get(event.data.defender_faction_id);

        if (!attacker || !defender) return [];

        // Track active war
        if (!this.activeWars.has(attacker.id)) {
            this.activeWars.set(attacker.id, new Set());
        }
        this.activeWars.get(attacker.id).add(defender.id);

        // Set hostile relations
        attacker.setRelation(defender.id, -75);
        defender.setRelation(attacker.id, -75);

        return [
            new WorldChange(
                "war_declared",
                event.data.location_id || null,
                `${attacker.name} declares war on ${defender.name}`,
                "global"
            )
        ];
    }

    /**
     * Phase 2: Resolve war ended event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveWarEnded(event) {
        const attacker = this.factions.get(event.data.attacker_faction_id);
        const defender = this.factions.get(event.data.defender_faction_id);

        if (!attacker || !defender) return [];

        // Remove from active wars
        if (this.activeWars.has(attacker.id)) {
            this.activeWars.get(attacker.id).delete(defender.id);
        }

        // Improve relations slightly
        attacker.setRelation(defender.id, Math.min(0, attacker.getRelation(defender.id) + 20));
        defender.setRelation(attacker.id, Math.min(0, defender.getRelation(attacker.id) + 20));

        return [
            new WorldChange(
                "war_ended",
                null,
                `${attacker.name} and ${defender.name} end hostilities`,
                "global"
            )
        ];
    }

    /**
     * Phase 2: Resolve economic crisis event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveEconomicCrisis(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.wealth = Math.max(0, location.wealth - (severity * 40));
        location.stability = Math.max(0, location.stability - (severity * 30));

        const changes = [
            new WorldChange(
                "location_wealth_changed",
                location.id,
                -Math.round(severity * 40),
                `Economic crisis in ${location.name}`,
                "regional"
            )
        ];

        // Update controlling faction resources if applicable
        if (location.controllingFactionId) {
            const faction = this.factions.get(location.controllingFactionId);
            if (faction) {
                faction.resources = Math.max(0, faction.resources - (severity * 20));
                changes.push(new WorldChange(
                    "faction_resources_changed",
                    faction.id,
                    -Math.round(severity * 20),
                    `${faction.name} suffers from economic crisis`,
                    "regional"
                ));
            }
        }

        return changes;
    }

    /**
     * Phase 2: Resolve NPC movement event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveNpcMove(event) {
        const npc = this.npcs.get(event.data.npc_id);
        if (!npc) return [];

        const fromLocation = this.locations.get(event.data.from_location);
        const toLocation = this.locations.get(event.data.to_location);

        npc.locationId = event.data.to_location;

        return [
            new WorldChange(
                "npc_moved",
                npc.id,
                event.data.to_location,
                `${npc.name || npc.id} moves to ${toLocation?.name || event.data.to_location}`,
                "local"
            )
        ];
    }

    /**
     * Phase 2: Resolve assassination attempt
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveAssassination(event) {
        const target = this.npcs.get(event.data.target_npc_id);
        if (!target) return [];

        // 50% success chance
        const success = Math.random() < 0.5;

        if (success) {
            // NPC dies or is critically injured
            target.hp = Math.max(1, target.hp - 80);

            return [
                new WorldChange(
                    "npc_killed",
                    target.id,
                    true,
                    `${target.name || target.id} was assassinated`,
                    "regional"
                )
            ];
        } else {
            // Failed attempt - NPC becomes alert
            target.loyalty = Math.min(100, target.loyalty + 20);

            return [
                new WorldChange(
                    "assassination_failed",
                    target.id,
                    event.data.assassin_faction_id,
                    `Assassination attempt on ${target.name || target.id} failed`,
                    "regional"
                )
            ];
        }
    }

    /**
     * Phase 2: Resolve rebellion event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveRebellion(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.stability = Math.max(0, location.stability - (severity * 50));

        // Chance to change controlling faction
        if (severity > 0.6 && location.controllingFactionId) {
            const rebels = this.factions.get(event.data.rebel_faction_id);
            if (rebels && Math.random() < severity) {
                location.controllingFactionId = rebels.id;
                rebels.power = Math.min(100, rebels.power + 10);

                return [
                    new WorldChange(
                        "location_control_changed",
                        location.id,
                        rebels.id,
                        `Rebellion succeeds: ${rebels.name} takes ${location.name}`,
                        "regional"
                    )
                ];
            }
        }

        return [
            new WorldChange(
                "rebellion",
                location.id,
                -Math.round(severity * 50),
                `Rebellion in ${location.name}`,
                "regional"
            )
        ];
    }

    /**
     * Phase 2: Resolve famine event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolveFamine(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.population = Math.max(0, Math.floor(location.population * (1 - severity * 0.3)));
        location.wealth = Math.max(0, location.wealth - (severity * 30));
        location.stability = Math.max(0, location.stability - (severity * 40));

        return [
            new WorldChange(
                "famine",
                location.id,
                -Math.round(severity * 100),
                `Famine strikes ${location.name}`,
                "regional"
            )
        ];
    }

    /**
     * Phase 2: Resolve plague event
     * @param {WorldEvent} event 
     * @returns {WorldChange[]}
     */
    _resolvePlague(event) {
        const location = this.locations.get(event.data.location_id);
        if (!location) return [];

        const severity = event.data.severity / 100;
        location.population = Math.max(0, Math.floor(location.population * (1 - severity * 0.4)));
        location.stability = Math.max(0, location.stability - (severity * 35));

        return [
            new WorldChange(
                "plague",
                location.id,
                -Math.round(severity * 100),
                `Plague spreads in ${location.name}`,
                "regional"
            )
        ];
    }

    /**
     * Phase 3: Strategic update - called periodically to plan future events
     * Replaces Phase 2 implementation with explicit goal/strategy tracking
     */
    strategicUpdate() {
        if (this.currentTimeMinutes - this.lastGlobalStrategicUpdate < STRATEGIC_UPDATE_INTERVAL) {
            return;
        }
        this.lastGlobalStrategicUpdate = this.currentTimeMinutes;

        for (const faction of this.factions.values()) {
            if (!faction.isActive()) continue;

            const state = this.evaluateFactionState(faction);
            const strategy = this.selectStrategy(state, faction);
            
            // Check if strategy changed
            if (!faction.currentStrategy || strategy.name !== faction.currentStrategy.name) {
                // Strategy changed - cancel pending events and update
                this.cancelFactionPendingEvents(faction.id);
                faction.currentStrategy = strategy;
                faction.currentStrategy.startTime = this.currentTimeMinutes;
            }

            // Update strategic state cache
            faction.strategicState = state;
            faction.lastStrategicUpdate = this.currentTimeMinutes;

            const plan = this.generatePlan(strategy, faction, state);
            for (const event of plan) {
                this._safeSchedule(event);
            }
        }
    }

    /**
     * Phase 3: Evaluate current state of a faction
     * Returns key metrics for strategy selection
     * @param {Faction} faction 
     * @returns {Object}
     */
    evaluateFactionState(faction) {
        const strongestNeighbor = this.getStrongestNeighbor(faction);
        const militaryAdvantage = strongestNeighbor ? faction.power / strongestNeighbor.power : 1.0;
        
        return {
            militaryAdvantage,                    // >1.0 = advantage
            economicPressure: 100 - faction.resources,
            internalInstability: 100 - faction.stability,
            aggressionLevel: faction.aggression,
            enemyCount: this.countRelationsBelow(faction, -50),
            allyCount: this.countRelationsAbove(faction, 50),
            recentLosses: this.countRecentLosses(faction, 30 * 1440), // last 30 days
            controlledLocations: this._getControlledLocations(faction.id).length,
            totalFactions: this.factions.size
        };
    }

    /**
     * Phase 3: Get strongest neighboring faction
     * @param {Faction} faction 
     * @returns {Faction|null}
     */
    getStrongestNeighbor(faction) {
        let strongest = null;
        let maxPower = 0;

        for (const [id, other] of this.factions) {
            if (id === faction.id) continue;
            if (other.power > maxPower) {
                maxPower = other.power;
                strongest = other;
            }
        }

        return strongest;
    }

    /**
     * Phase 3: Count relations below threshold
     * @param {Faction} faction 
     * @param {number} threshold 
     * @returns {number}
     */
    countRelationsBelow(faction, threshold) {
        let count = 0;
        for (const relation of faction.relations.values()) {
            if (relation <= threshold) count++;
        }
        return count;
    }

    /**
     * Phase 3: Count relations above threshold
     * @param {Faction} faction 
     * @param {number} threshold 
     * @returns {number}
     */
    countRelationsAbove(faction, threshold) {
        let count = 0;
        for (const relation of faction.relations.values()) {
            if (relation >= threshold) count++;
        }
        return count;
    }

    /**
     * Phase 3: Count recent losses (battles/wars in last X minutes)
     * @param {Faction} faction 
     * @param {number} timeWindowMinutes 
     * @returns {number}
     */
    countRecentLosses(faction, timeWindowMinutes) {
        const cutoffTime = this.currentTimeMinutes - timeWindowMinutes;
        let losses = 0;
        
        // Check world log for recent war defeats
        for (const change of this.worldLog) {
            if (change.timestamp && change.timestamp < cutoffTime) continue;
            
            if (change.type === "war_battle" && 
                change.data && 
                change.data.defender_faction_id === faction.id &&
                change.data.victory === false) {
                losses++;
            }
        }
        
        return losses;
    }

    /**
     * Phase 3: Select strategy based on faction state
     * Simple threshold logic (can be replaced with weighted system)
     * @param {Object} state 
     * @param {Faction} faction 
     * @returns {Strategy}
     */
    selectStrategy(state, faction) {
        // Priority 1: Internal stability crisis
        if (state.internalInstability > 65) {
            return new Strategy("internal_stabilization", 0.92);
        }
        
        // Priority 2: Economic pressure
        if (state.economicPressure > 70) {
            return new Strategy("economic_recovery", 0.80);
        }
        
        // Priority 3: Multiple enemies and weak military
        if (state.enemyCount >= 3 && state.militaryAdvantage < 0.9) {
            return new Strategy("defensive", 0.85);
        }
        
        // Priority 4: Strong military, aggressive, no enemies - expansion
        if (state.militaryAdvantage > 1.35 && state.aggressionLevel > 60 && state.enemyCount === 0) {
            return new Strategy("expansion", 0.88);
        }
        
        // Priority 5: Many enemies - coalition
        if (state.enemyCount >= 2) {
            return new Strategy("diplomatic_coalition", 0.75);
        }
        
        // Priority 6: Low stability - covert operations
        if (state.internalInstability > 40 && Math.random() < 0.3) {
            return new Strategy("covert_operations", 0.65);
        }
        
        // Default: maintain status quo
        return new Strategy("maintain_status_quo", 0.70);
    }

    /**
     * Phase 3: Generate event plan based on selected strategy
     * @param {Strategy} strategy 
     * @param {Faction} faction 
     * @param {Object} state 
     * @returns {WorldEvent[]}
     */
    generatePlan(strategy, faction, state) {
        const plan = [];
        const now = this.currentTimeMinutes;

        switch (strategy.name) {
            case "expansion":
                plan.push(this.createEvent("troop_mobilization", now + 3 * 1440, { 
                    factionId: faction.id 
                }));
                plan.push(this.createEvent("war_declared", now + 6 * 1440, { 
                    attackerId: faction.id, 
                    targetFactionId: this.selectExpansionTarget(faction)
                }));
                plan.push(this.createEvent("war_battle", now + 12 * 1440, { 
                    attackerFactionId: faction.id,
                    defenderFactionId: this.selectExpansionTarget(faction),
                    locationId: this.selectExpansionLocation(faction)
                }));
                break;

            case "internal_stabilization":
                plan.push(this.createEvent("tax_increase", now + 2 * 1440, { 
                    locationId: this._getControlledLocations(faction.id)[0]?.id 
                }));
                plan.push(this.createEvent("propaganda_campaign", now + 5 * 1440, { 
                    factionId: faction.id 
                }));
                if (faction.stability < 30) {
                    plan.push(this.createEvent("rebellion", now + this._randomRange(1440, 4320), {
                        locationId: this._getControlledLocations(faction.id)[Math.floor(Math.random() * this._getControlledLocations(faction.id).length)]?.id,
                        severity: 50 + Math.random() * 30
                    }));
                }
                break;

            case "defensive":
                plan.push(this.createEvent("fortification", now + 2 * 1440, { 
                    factionId: faction.id 
                }));
                plan.push(this.createEvent("troop_repositioning", now + 4 * 1440, { 
                    factionId: faction.id 
                }));
                break;

            case "economic_recovery":
                plan.push(this.createEvent("trade_agreement", now + 3 * 1440, { 
                    factionId: faction.id 
                }));
                plan.push(this.createEvent("resource_boost", now + 7 * 1440, { 
                    factionId: faction.id 
                }));
                break;

            case "covert_operations":
                const targetLeader = this.selectKeyEnemyLeader(faction);
                if (targetLeader) {
                    plan.push(this.createEvent("assassination_attempt", now + this._randomRange(5, 15) * 1440, {
                        targetNpcId: targetLeader
                    }));
                }
                plan.push(this.createEvent("espionage", now + this._randomRange(3, 10) * 1440, {
                    factionId: faction.id
                }));
                break;

            case "diplomatic_coalition":
                const potentialAlly = this.selectPotentialAlly(faction);
                if (potentialAlly) {
                    plan.push(this.createEvent("alliance_proposal", now + 2 * 1440, {
                        requesterFactionId: faction.id,
                        targetFactionId: potentialAlly
                    }));
                }
                break;

            case "total_war":
                plan.push(this.createEvent("full_mobilization", now + 1 * 1440, { 
                    factionId: faction.id 
                }));
                const target = this.selectExpansionTarget(faction);
                if (target) {
                    plan.push(this.createEvent("war_declared", now + 2 * 1440, { 
                        attackerId: faction.id, 
                        targetFactionId: target
                    }));
                    plan.push(this.createEvent("war_battle", now + 5 * 1440, { 
                        attackerFactionId: faction.id,
                        defenderFactionId: target,
                        locationId: this.selectExpansionLocation(faction)
                    }));
                }
                break;

            case "maintain_status_quo":
            default:
                // Small random improvements
                if (Math.random() < 0.2) {
                    faction.resources = Math.min(100, faction.resources + 2);
                }
                if (Math.random() < 0.2) {
                    faction.stability = Math.min(100, faction.stability + 2);
                }
                // Occasional NPC movements
                if (Math.random() < 0.3) {
                    const factionNPCs = this._getFactionNPCs(faction.id);
                    if (factionNPCs.length > 0) {
                        const npc = factionNPCs[Math.floor(Math.random() * factionNPCs.length)];
                        const locations = Array.from(this.locations.values());
                        const targetLocation = locations[Math.floor(Math.random() * locations.length)];
                        if (targetLocation.id !== npc.locationId) {
                            plan.push(this.createEvent("npc_move", now + this._randomRange(1440, 7200), {
                                npc_id: npc.id,
                                from_location: npc.locationId,
                                to_location: targetLocation.id
                            }));
                        }
                    }
                }
                break;
        }

        return plan;
    }

    /**
     * Phase 3: Create and return a WorldEvent
     * @param {string} type 
     * @param {number} executeAt 
     * @param {Object} data 
     * @returns {WorldEvent}
     */
    createEvent(type, executeAt, data) {
        const priorityMap = {
            "war_declared": 300,
            "war_battle": 250,
            "rebellion": 200,
            "assassination_attempt": 180,
            "full_mobilization": 170,
            "troop_mobilization": 150,
            "economic_crisis": 150,
            "propaganda_campaign": 100,
            "trade_agreement": 80,
            "npc_move": 50,
            "espionage": 60,
            "fortification": 70,
            "tax_increase": 90,
            "resource_boost": 85,
            "alliance_proposal": 100,
            "troop_repositioning": 80
        };

        const importanceMap = {
            "war_declared": 0.80,
            "war_battle": 0.75,
            "rebellion": 0.70,
            "assassination_attempt": 0.65,
            "full_mobilization": 0.60,
            "troop_mobilization": 0.40,
            "economic_crisis": 0.55,
            "propaganda_campaign": 0.30,
            "trade_agreement": 0.35,
            "npc_move": 0.15,
            "espionage": 0.25,
            "fortification": 0.30,
            "tax_increase": 0.35,
            "resource_boost": 0.30,
            "alliance_proposal": 0.45,
            "troop_repositioning": 0.25
        };

        return new WorldEvent(
            this._generateEventId(),
            type,
            executeAt,
            "regional",
            data,
            priorityMap[type] || 100,
            false,
            "system",
            importanceMap[type] || 0.3
        );
    }

    /**
     * Phase 3: Select target for expansion
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectExpansionTarget(faction) {
        let weakest = null;
        let minPower = Infinity;

        for (const [id, other] of this.factions) {
            if (id === faction.id) continue;
            // Don't attack allies
            if (faction.getRelation(other.id) >= 50) continue;
            if (other.power < minPower) {
                minPower = other.power;
                weakest = other;
            }
        }

        return weakest ? weakest.id : null;
    }

    /**
     * Phase 3: Select location for expansion
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectExpansionLocation(faction) {
        const targetId = this.selectExpansionTarget(faction);
        if (!targetId) return null;
        
        const targetFaction = this.factions.get(targetId);
        if (!targetFaction) return null;

        // Find location controlled by target
        for (const location of this.locations.values()) {
            if (location.controllingFactionId === targetId) {
                return location.id;
            }
        }
        
        return null;
    }

    /**
     * Phase 3: Select key enemy leader for assassination
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectKeyEnemyLeader(faction) {
        const enemies = Array.from(this.factions.values()).filter(
            f => f.id !== faction.id && faction.getRelation(f.id) <= -50
        );
        
        if (enemies.length === 0) return null;
        
        // Find NPCs belonging to enemy factions
        for (const enemy of enemies) {
            const enemyNPCs = this._getFactionNPCs(enemy.id);
            if (enemyNPCs.length > 0) {
                return enemyNPCs[0].id;
            }
        }
        
        return null;
    }

    /**
     * Phase 3: Select potential ally for coalition
     * @param {Faction} faction 
     * @returns {string|null}
     */
    selectPotentialAlly(faction) {
        const potentialAllies = Array.from(this.factions.values()).filter(
            f => f.id !== faction.id && faction.getRelation(f.id) > -20 && faction.getRelation(f.id) < 50
        );
        
        if (potentialAllies.length === 0) return null;
        
        return potentialAllies[Math.floor(Math.random() * potentialAllies.length)].id;
    }

    /**
     * Phase 3: Cancel pending events for a faction when strategy changes
     * @param {string} factionId 
     */
    cancelFactionPendingEvents(factionId) {
        if (!this.eventQueue) return;
        
        // Remove future events scheduled by this faction
        const eventsToKeep = [];
        let removed = 0;
        
        while (this.eventQueue.heap && this.eventQueue.heap.length > 0) {
            const event = this.eventQueue.popEarliest();
            if (event && event.scheduledBy === factionId && event.executeAt > this.currentTimeMinutes) {
                removed++;
            } else if (event) {
                eventsToKeep.push(event);
            }
        }
        
        // Re-add kept events
        for (const event of eventsToKeep) {
            this.eventQueue.schedule(event);
        }
        
        // Also clean from any internal tracking arrays if they exist
        if (this.plannedEvents) {
            this.plannedEvents = this.plannedEvents.filter(e => e.scheduledBy !== factionId);
        }
    }

    // Legacy Phase 2 methods - kept for compatibility
    // These are now wrappers around Phase 3 implementations

    /**
     * Generate unique event ID
     * @returns {string}
     */
    _generateEventId() {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get random number in range
     * @param {number} min 
     * @param {number} max 
     * @returns {number}
     */
    _randomRange(min, max) {
        return Math.floor(min + Math.random() * (max - min));
    }

    /**
     * Get locations controlled by a faction
     * @param {string} factionId 
     * @returns {Location[]}
     */
    _getControlledLocations(factionId) {
        return Array.from(this.locations.values()).filter(
            loc => loc.controllingFactionId === factionId
        );
    }

    /**
     * Get NPCs belonging to a faction
     * @param {string} factionId 
     * @returns {NPC[]}
     */
    _getFactionNPCs(factionId) {
        return Array.from(this.npcs.values()).filter(
            npc => npc.factionId === factionId
        );
    }

    /**
     * Find a faction that might rebel
     * @param {Faction} excludingFaction 
     * @returns {Faction|null}
     */
    _findRebelFaction(excludingFaction) {
        const candidates = Array.from(this.factions.values()).filter(
            f => f.id !== excludingFaction.id && f.power < 40
        );
        return candidates.length > 0 ? candidates[0] : null;
    }

    /**
     * Find weak neighbor to attack
     * @param {Faction} faction 
     * @returns {Faction|null}
     */
    _findWeakNeighbor(faction) {
        let weakest = null;
        let minPower = Infinity;

        for (const [id, other] of this.factions) {
            if (id === faction.id) continue;
            if (other.power < minPower && faction.getRelation(other.id) < 30) {
                minPower = other.power;
                weakest = other;
            }
        }

        return weakest;
    }

    /**
     * Find neutral location between factions
     * @param {Faction} attacker 
     * @param {Faction} defender 
     * @returns {Location|null}
     */
    _findNeutralLocation(attacker, defender) {
        const candidates = Array.from(this.locations.values()).filter(
            loc => loc.controllingFactionId !== attacker.id && 
                   loc.controllingFactionId !== defender.id &&
                   loc.controllingFactionId !== null
        );
        return candidates.length > 0 ? candidates[Math.floor(Math.random() * candidates.length)] : null;
    }

    /**
     * Find potential allies for a faction
     * @param {Faction} faction 
     * @returns {Faction[]}
     */
    _findPotentialAllies(faction) {
        return Array.from(this.factions.values()).filter(
            f => f.id !== faction.id && faction.getRelation(f.id) > -20
        );
    }

    /**
     * Phase 3: Assign random long-term goals to a faction
     * Called during world initialization
     * @param {Faction} faction 
     */
    _assignRandomGoals(faction) {
        // Determine number of goals (1-3)
        const numGoals = 1 + Math.floor(Math.random() * 3);
        
        // Shuffle goal types and pick first numGoals
        const shuffledTypes = [...GOAL_TYPES].sort(() => Math.random() - 0.5);
        
        for (let i = 0; i < numGoals; i++) {
            const goalType = shuffledTypes[i];
            let target = null;
            let priority = 50 + Math.floor(Math.random() * 50); // 50-100
            
            // Assign specific targets based on goal type
            switch (goalType) {
                case "expand_territory":
                case "destroy_faction":
                    // Target a random other faction
                    const otherFactions = Array.from(this.factions.values()).filter(
                        f => f.id !== faction.id
                    );
                    if (otherFactions.length > 0) {
                        target = otherFactions[Math.floor(Math.random() * otherFactions.length)].id;
                    }
                    priority = 70 + Math.floor(Math.random() * 30); // Higher priority for aggressive goals
                    break;
                    
                case "alliance_formation":
                    // Target a faction to ally with
                    const potentialAllies = Array.from(this.factions.values()).filter(
                        f => f.id !== faction.id && faction.getRelation(f.id) > -30
                    );
                    if (potentialAllies.length > 0) {
                        target = potentialAllies[Math.floor(Math.random() * potentialAllies.length)].id;
                    }
                    break;
                    
                case "survival":
                    // No specific target - generic survival
                    priority = 80 + Math.floor(Math.random() * 20); // High priority
                    break;
                    
                default:
                    // Other goal types have no specific target
                    break;
            }
            
            const goal = new Goal(goalType, target, priority);
            faction.longTermGoals.push(goal);
        }
    }

    /**
     * Plan follow-up events after an event is resolved
     * @param {WorldEvent} event 
     */
    _planFollowUpEvents(event) {
        // For ongoing wars, schedule follow-up battles
        if (event.type === "war_battle") {
            const attacker = this.factions.get(event.data.attacker_faction_id);
            const defender = this.factions.get(event.data.defender_faction_id);

            if (attacker && defender && this._stillAtWar(attacker, defender)) {
                const nextBattle = new WorldEvent(
                    this._generateEventId(),
                    "war_battle",
                    this.currentTimeMinutes + this._randomRange(4320, 14400),
                    "regional",
                    {
                        attacker_faction_id: attacker.id,
                        defender_faction_id: defender.id,
                        location_id: event.data.location_id,
                        troop_ratio: attacker.power / Math.max(defender.power, 1)
                    },
                    100,
                    false,
                    "system",
                    0.5
                );
                this._safeSchedule(nextBattle);
            }
        }
    }

    /**
     * Check if two factions are still at war
     * @param {Faction} factionA 
     * @param {Faction} factionB 
     * @returns {boolean}
     */
    _stillAtWar(factionA, factionB) {
        return factionA.getRelation(factionB.id) <= -50;
    }

    /**
     * Append world changes to log
     * @param {WorldChange[]} changes 
     */
    _appendWorldChanges(changes) {
        for (const change of changes) {
            this.logWorldChange(change);
        }
    }

    /**
     * Safe schedule with throttling checks
     * @param {WorldEvent} event 
     * @returns {boolean} - true if scheduled, false if rejected
     */
    _safeSchedule(event) {
        const limits = this.config.eventLimits;

        // Check hard cap
        if (this.eventQueue.count() >= limits.MAX_QUEUED_EVENTS_HARD_CAP) {
            console.warn(`Event rejected: Queue hard cap reached (${this.eventQueue.count()})`);
            return false;
        }

        // Check active wars limit
        if (event.type === "war_declared") {
            const activeWars = this._countActiveWars();
            if (activeWars >= limits.MAX_ACTIVE_WARS) {
                console.warn(`Event rejected: Max active wars reached (${activeWars})`);
                return false;
            }
        }

        // Throttle battle events
        if (event.type.startsWith("war_")) {
            const recentBattles = this._countRecentBattles();
            if (recentBattles > limits.MAX_BATTLES_PER_MONTH) {
                // Weaken instead of reject
                if (event.data.strength) {
                    event.data.strength *= 0.6;
                }
            }
        }

        // Check per-faction limit
        if (event.scheduledBy) {
            // Simplified check - in production would track per-faction counts
        }

        this.eventQueue.schedule(event);
        return true;
    }

    /**
     * Count active wars
     * @returns {number}
     */
    _countActiveWars() {
        let count = 0;
        for (const defenders of this.activeWars.values()) {
            count += defenders.size;
        }
        return count;
    }

    /**
     * Count recent battles (simplified)
     * @returns {number}
     */
    _countRecentBattles() {
        // Simplified - count war_battle events in queue
        return this.eventQueue.countByType("war_battle");
    }

    // ========================================================================
    // WORLD MODIFICATION METHODS
    // ========================================================================

    /**
     * Add a location to the world
     */
    addLocation(location) {
        this.locations.set(location.id, location);
    }

    /**
     * Add a faction to the world
     */
    addFaction(faction) {
        this.factions.set(faction.id, faction);
    }

    /**
     * Add an NPC to the world
     */
    addNPC(npc) {
        this.npcs.set(npc.id, npc);
    }

    /**
     * Set the player
     */
    setPlayer(player) {
        this.player = player;
    }

    /**
     * Log a world change
     */
    logWorldChange(worldChange) {
        this.worldLog.push({
            timestamp: this.currentTimeMinutes,
            change: worldChange.toJSON()
        });
    }

    /**
     * Get location by ID
     */
    getLocation(locationId) {
        return this.locations.get(locationId);
    }

    /**
     * Get NPC by ID
     */
    getNPC(npcId) {
        return this.npcs.get(npcId);
    }

    /**
     * Get faction by ID
     */
    getFaction(factionId) {
        return this.factions.get(factionId);
    }

    // ========================================================================
    // SERIALIZATION
    // ========================================================================

    /**
     * Serialize world to JSON
     */
    toJSON() {
        return {
            currentTimeMinutes: this.currentTimeMinutes,
            locations: Array.from(this.locations.values()).map(l => l.toJSON()),
            factions: Array.from(this.factions.values()).map(f => f.toJSON()),
            npcs: Array.from(this.npcs.values()).map(n => n.toJSON()),
            player: this.player ? this.player.toJSON() : null,
            worldLog: this.worldLog,
            config: this.config,
            seed: this.seed,
            // Phase 2: Serialize event queue
            eventQueue: this.eventQueue ? this.eventQueue.toJSON() : null,
            activeWars: Array.from(this.activeWars.entries()).map(([k, v]) => [k, Array.from(v)]),
            // Phase 4: Contextual Memory System
            historyNodes: this.historyNodes.map(node => node.toJSON()),
            rawChangeLog: this.rawChangeLog.map(wc => wc.toJSON ? wc.toJSON() : wc),
            actionCountSinceLastCompression: this.actionCountSinceLastCompression,
            currentNpcMemory: Object.fromEntries(this.currentNpcMemory)
        };
    }

    /**
     * Deserialize world from JSON
     */
    static fromJSON(json) {
        const world = new World();
        
        world.currentTimeMinutes = json.currentTimeMinutes || 0;
        world.seed = json.seed;
        
        // Restore locations
        if (json.locations) {
            for (const locData of json.locations) {
                world.locations.set(locData.id, Location.fromJSON(locData));
            }
        }
        
        // Restore factions
        if (json.factions) {
            for (const factionData of json.factions) {
                world.factions.set(factionData.id, Faction.fromJSON(factionData));
            }
        }
        
        // Restore NPCs
        if (json.npcs) {
            for (const npcData of json.npcs) {
                world.npcs.set(npcData.id, NPC.fromJSON(npcData));
            }
        }
        
        // Restore player
        if (json.player) {
            world.player = Player.fromJSON(json.player);
        }
        
        // Restore config
        if (json.config) {
            world.config = { ...world.config, ...json.config };
        }
        
        // Restore world log
        world.worldLog = json.worldLog || [];
        
        // Phase 2: Restore event queue
        if (json.eventQueue) {
            world.eventQueue = EventQueue.fromJSON(json.eventQueue);
        }
        
        // Phase 2: Restore active wars
        if (json.activeWars) {
            world.activeWars = new Map(json.activeWars.map(([k, v]) => [k, new Set(v)]));
        }
        
        // Phase 4: Contextual Memory System
        if (json.historyNodes) {
            world.historyNodes = json.historyNodes.map(nodeData => HistoryNode.fromJSON(nodeData));
        }
        if (json.rawChangeLog) {
            world.rawChangeLog = json.rawChangeLog.map(wc => 
                wc instanceof WorldChange ? wc : WorldChange.fromJSON(wc)
            );
        }
        world.actionCountSinceLastCompression = json.actionCountSinceLastCompression || 0;
        if (json.currentNpcMemory) {
            world.currentNpcMemory = new Map(Object.entries(json.currentNpcMemory));
        }
        
        return world;
    }

    // ========================================================================
    // PHASE 4: CONTEXTUAL MEMORY SYSTEM - LIVE STATE
    // ========================================================================

    /**
     * Phase 4: Get Live State - current snapshot of world for LLM context
     * Target: ~800-1500 tokens
     * @returns {Object} Live State data structure
     */
    getLiveState() {
        return {
            currentTime: {
                day: this.getDayNumber(),
                time: this.getFormattedTime(),
                period: this.getTimeOfDay(),
                totalMinutes: this.currentTimeMinutes
            },
            player: this._getPlayerLiveState(),
            location: this._getCurrentLocationLiveState(),
            activeWars: this.getActiveWarsSummary(),
            topReputations: this.getTopPlayerReputations(),
            recentMajorEvents: this.getRecentMajorChanges(),
            npcInteractions: this._getRecentNpcInteractions()
        };
    }

    /**
     * Get player info for Live State
     * @returns {Object}
     */
    _getPlayerLiveState() {
        if (!this.player) return null;
        
        return {
            name: this.player.name,
            locationId: this.player.locationId,
            hp: this.player.hp,
            maxHp: this.player.maxHp,
            gold: this.player.gold,
            hunger: this.player.hunger,
            thirst: this.player.thirst,
            fatigue: this.player.fatigue,
            statusEffects: this.player.statusEffects.map(e => e.name)
        };
    }

    /**
     * Get current location info for Live State
     * @returns {Object}
     */
    _getCurrentLocationLiveState() {
        if (!this.player) return null;
        
        const location = this.locations.get(this.player.locationId);
        if (!location) return null;
        
        return {
            id: location.id,
            name: location.name,
            controllingFaction: location.controllingFactionId,
            population: location.population,
            wealth: location.wealth,
            stability: location.stability,
            dangerLevel: location.dangerLevel
        };
    }

    /**
     * Phase 4: Get summary of active wars
     * @returns {Array}
     */
    getActiveWarsSummary() {
        const wars = [];
        const maxWars = MEMORY_CONFIG.MAX_WARS_IN_CONTEXT;
        
        for (const [attackerId, defenders] of this.activeWars) {
            const attacker = this.factions.get(attackerId);
            if (!attacker) continue;
            
            for (const defenderId of defenders) {
                const defender = this.factions.get(defenderId);
                if (!defender) continue;
                
                wars.push({
                    attacker: attacker.name,
                    defender: defender.name,
                    attackerPower: attacker.power,
                    defenderPower: defender.power
                });
                
                if (wars.length >= maxWars) break;
            }
            if (wars.length >= maxWars) break;
        }
        
        return wars;
    }

    /**
     * Phase 4: Get player's top faction reputations
     * @returns {Array}
     */
    getTopPlayerReputations() {
        if (!this.player) return [];
        
        const reputations = [];
        const maxReps = MEMORY_CONFIG.MAX_REPUTATIONS_IN_CONTEXT;
        
        // Convert Map to array and sort by absolute value
        const repArray = Array.from(this.player.reputation.entries())
            .map(([factionId, value]) => {
                const faction = this.factions.get(factionId);
                return {
                    factionId,
                    factionName: faction ? faction.name : factionId,
                    value
                };
            })
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        
        return repArray.slice(0, maxReps);
    }

    /**
     * Phase 4: Get recent major world changes
     * @returns {Array}
     */
    getRecentMajorChanges() {
        const changes = [];
        const maxEvents = MEMORY_CONFIG.MAX_MAJOR_EVENTS_IN_CONTEXT;
        const threshold = MEMORY_CONFIG.IMPORTANCE_THRESHOLD;
        
        // Check rawChangeLog first
        for (let i = this.rawChangeLog.length - 1; i >= 0; i--) {
            const change = this.rawChangeLog[i];
            const importance = change.staticImportance || 0;
            
            if (importance >= threshold) {
                changes.push({
                    type: change.type,
                    description: change.description,
                    scope: change.scope,
                    importance
                });
            }
            
            if (changes.length >= maxEvents) break;
        }
        
        // Also check worldLog
        for (const logEntry of this.worldLog) {
            if (changes.length >= maxEvents) break;
            
            const change = logEntry.change || logEntry;
            const importance = change.staticImportance || IMPORTANCE_TABLE[change.type] || 0;
            
            if (importance >= threshold) {
                // Avoid duplicates
                const exists = changes.some(c => c.description === change.description);
                if (!exists) {
                    changes.push({
                        type: change.type,
                        description: change.description,
                        scope: change.scope,
                        importance
                    });
                }
            }
        }
        
        return changes;
    }

    /**
     * Get recent NPC interactions for current location
     * @returns {Array}
     */
    _getRecentNpcInteractions() {
        if (!this.player) return [];
        
        const locationNpcs = Array.from(this.npcs.values())
            .filter(npc => npc.locationId === this.player.locationId)
            .slice(0, 5);
        
        return locationNpcs.map(npc => ({
            id: npc.id,
            name: npc.name || npc.id,
            factionId: npc.factionId,
            trust: npc.trust,
            respect: npc.respect
        }));
    }

    // ========================================================================
    // PHASE 4: CONTEXTUAL MEMORY SYSTEM - COMPRESSION
    // ========================================================================

    /**
     * Phase 4: Compress history if needed
     * Called after player actions
     */
    compressHistoryIfNeeded() {
        this.actionCountSinceLastCompression++;
        
        if (this.actionCountSinceLastCompression >= MEMORY_CONFIG.COMPRESSION_INTERVAL) {
            this._performCompression();
            this.actionCountSinceLastCompression = 0;
        }
    }

    /**
     * Phase 4: Perform history compression
     * Creates a new HistoryNode from recent changes
     */
    _performCompression() {
        // Gather changes since last compression
        const recentChanges = [...this.rawChangeLog];
        
        if (recentChanges.length === 0) return;
        
        // Calculate static importance from changes
        let totalImportance = 0;
        const tags = new Set();
        
        for (const change of recentChanges) {
            totalImportance += change.staticImportance || 0;
            
            // Infer tags from change type
            if (change.type.includes("war") || change.type.includes("battle")) {
                tags.add("combat");
                tags.add("political");
            } else if (change.type.includes("reputation")) {
                tags.add("social");
            } else if (change.type.includes("economic") || change.type.includes("trade")) {
                tags.add("economic");
            } else if (change.type.includes("move") || change.type.includes("travel")) {
                tags.add("exploration");
            }
        }
        
        // Average importance
        const avgImportance = recentChanges.length > 0 
            ? totalImportance / recentChanges.length 
            : 0;
        
        // Determine time range
        const timeStart = recentChanges[0].timestamp || (this.currentTimeMinutes - MEMORY_CONFIG.COMPRESSION_INTERVAL * 10);
        const timeEnd = this.currentTimeMinutes;
        
        // Generate summary text (placeholder - would be LLM-generated in production)
        const summaryText = this._generateCompressionSummary(recentChanges);
        
        // Create new history node
        const node = new HistoryNode();
        node.timeStartMinutes = timeStart;
        node.timeEndMinutes = timeEnd;
        node.staticImportance = avgImportance;
        node.tags = tags;
        node.summaryText = summaryText;
        node.level = 1;
        
        // Set parent if exists
        if (this.historyNodes.length > 0) {
            node.parentId = this.historyNodes[this.historyNodes.length - 1].nodeId;
        }
        
        // Add to history
        this.historyNodes.push(node);
        
        // Clear raw change log (or keep last portion)
        const keepCount = MEMORY_CONFIG.COMPRESSION_INTERVAL * 2;
        this.rawChangeLog = this.rawChangeLog.slice(-keepCount);
    }

    /**
     * Phase 4: Generate summary text for compression
     * In production, this would use LLM
     * @param {Array} changes 
     * @returns {string}
     */
    _generateCompressionSummary(changes) {
        // Simple placeholder summary
        const changeTypes = {};
        for (const change of changes) {
            changeTypes[change.type] = (changeTypes[change.type] || 0) + 1;
        }
        
        const typeSummary = Object.entries(changeTypes)
            .map(([type, count]) => `${count}x ${type}`)
            .join(", ");
        
        return `Period summary: ${changes.length} changes occurred. ${typeSummary}`;
    }

    /**
     * Phase 4: Build compression prompt for LLM
     * @returns {string}
     */
    buildCompressionPrompt() {
        const recentChanges = this.rawChangeLog.slice(-MEMORY_CONFIG.COMPRESSION_INTERVAL * 2);
        
        let prompt = "Compress the following world changes into a concise narrative summary (80-300 tokens):\n\n";
        
        for (const change of recentChanges) {
            prompt += `- ${change.description}\n`;
        }
        
        prompt += "\nProvide a single paragraph summary that captures the key events and their significance.";
        
        return prompt;
    }

    // ========================================================================
    // PHASE 4: CONTEXTUAL MEMORY SYSTEM - CONTEXT BUILDING
    // ========================================================================

    /**
     * Phase 4: Build context for a specific scene
     * Combines Live State + relevant HistoryNodes
     * @param {string} sceneType - Type of scene (dialog, combat, exploration, etc.)
     * @param {Array} sceneTags - Tags describing the scene
     * @returns {Object} Context object with liveState and historyNodes
     */
    buildContextForScene(sceneType, sceneTags = []) {
        // Get Live State
        const liveState = this.getLiveState();
        
        // Score and select relevant history nodes
        const relevantNodes = this._selectRelevantNodes(sceneType, sceneTags);
        
        return {
            liveState,
            historyNodes: relevantNodes,
            metadata: {
                sceneType,
                sceneTags,
                nodeCount: relevantNodes.length,
                totalTokens: this._estimateContextTokens(liveState, relevantNodes)
            }
        };
    }

    /**
     * Phase 4: Select relevant history nodes for scene
     * @param {string} sceneType 
     * @param {Array} sceneTags 
     * @returns {Array}
     */
    _selectRelevantNodes(sceneType, sceneTags) {
        const scoredNodes = [];
        
        for (const node of this.historyNodes) {
            const score = this.scoreNodeForScene(node, sceneType, sceneTags);
            if (score >= MEMORY_CONFIG.MIN_NODE_RELEVANCE) {
                scoredNodes.push({ node, score });
            }
        }
        
        // Sort by score descending
        scoredNodes.sort((a, b) => b.score - a.score);
        
        // Take top N nodes
        const maxNodes = MEMORY_CONFIG.MAX_NODES_PER_CONTEXT;
        return scoredNodes.slice(0, maxNodes).map(sn => sn.node);
    }

    /**
     * Phase 4: Score a history node for relevance to current scene
     * @param {HistoryNode} node 
     * @param {string} sceneType 
     * @param {Array} sceneTags 
     * @returns {number} Relevance score 0-1
     */
    scoreNodeForScene(node, sceneType, sceneTags) {
        let score = 0;
        
        // Base: final importance (already calculated)
        score += node.finalImportance * 0.4;
        
        // Tag matching
        if (sceneTags.length > 0 && node.tags.size > 0) {
            const matchingTags = sceneTags.filter(tag => node.tags.has(tag));
            const tagScore = matchingTags.length / sceneTags.length;
            score += tagScore * 0.3;
        }
        
        // Recency bonus
        const daysSince = (this.currentTimeMinutes - node.timeEndMinutes) / 1440;
        if (daysSince < 7) {
            score += 0.2;
        } else if (daysSince < 30) {
            score += 0.1;
        }
        
        // Player involvement bonus
        if (node.causedBy.includes("player") || node.summaryText.toLowerCase().includes(this.player?.name?.toLowerCase() || "")) {
            score += 0.1;
        }
        
        return Math.min(1.0, score);
    }

    /**
     * Phase 4: Estimate token count for context
     * @param {Object} liveState 
     * @param {Array} historyNodes 
     * @returns {number} Estimated tokens
     */
    _estimateContextTokens(liveState, historyNodes) {
        // Rough estimation: ~4 characters per token
        const liveStateStr = JSON.stringify(liveState);
        const liveStateTokens = liveStateStr.length / 4;
        
        let historyTokens = 0;
        for (const node of historyNodes) {
            historyTokens += node.summaryText.length / 4;
        }
        
        return Math.round(liveStateTokens + historyTokens);
    }

    /**
     * Phase 4: Record a player action for memory system
     * @param {string} actionType - Type of action
     * @param {Object} actionData - Action details
     */
    recordPlayerAction(actionType, actionData = {}) {
        // Add to raw change log
        const change = new WorldChange(
            actionType,
            actionData.targetId || null,
            actionData.delta || null,
            actionData.description || `Player performed ${actionType}`,
            actionData.scope || "local"
        );
        
        this.rawChangeLog.push(change);
        
        // Check for compression
        this.compressHistoryIfNeeded();
    }

    /**
     * Phase 4: Update NPC memory for interaction tracking
     * @param {string} npcId 
     * @param {Object} interaction 
     */
    updateNpcMemory(npcId, interaction) {
        if (!this.currentNpcMemory.has(npcId)) {
            this.currentNpcMemory.set(npcId, []);
        }
        
        const memory = this.currentNpcMemory.get(npcId);
        memory.push({
            timestamp: this.currentTimeMinutes,
            type: interaction.type,
            summary: interaction.summary
        });
        
        // Keep only recent interactions
        const maxDepth = MEMORY_CONFIG.NPC_MEMORY_DEPTH;
        while (memory.length > maxDepth) {
            memory.shift();
        }
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    /**
     * Get formatted time string (e.g., "12:30")
     */
    getFormattedTime() {
        const hours = Math.floor(this.currentTimeMinutes / 60);
        const minutes = this.currentTimeMinutes % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }

    /**
     * Get time description (e.g., "Morning", "Afternoon", "Night")
     */
    getTimeOfDay() {
        const hour = this.currentTimeMinutes % (24 * 60) / 60;
        
        if (hour >= 6 && hour < 12) return "Morning";
        if (hour >= 12 && hour < 17) return "Afternoon";
        if (hour >= 17 && hour < 21) return "Evening";
        return "Night";
    }

    /**
     * Get day number (1-based)
     */
    getDayNumber() {
        return Math.floor(this.currentTimeMinutes / (24 * 60)) + 1;
    }

    /**
     * Create a simple starter world with default locations
     */
    static createStarterWorld(playerName, playerLocationId = "town_central") {
        const world = new World();
        
        // Create default locations
        const locations = [
            { id: "town_central", name: "Central Town", population: 500, wealth: 60, stability: 70, dangerLevel: 10 },
            { id: "tavern_golden_dragon", name: "Golden Dragon Tavern", population: 50, wealth: 40, stability: 60, dangerLevel: 5 },
            { id: "market_square", name: "Market Square", population: 200, wealth: 80, stability: 75, dangerLevel: 15 },
            { id: "city_gate_north", name: "North City Gate", population: 100, wealth: 30, stability: 50, dangerLevel: 25 },
            { id: "forest_entrance", name: "Forest Entrance", population: 0, wealth: 10, stability: 40, dangerLevel: 40 },
            { id: "dungeon_entrance", name: "Ancient Ruins", population: 0, wealth: 20, stability: 30, dangerLevel: 60 }
        ];
        
        for (const locData of locations) {
            const loc = new Location(locData.id, locData.name);
            loc.population = locData.population;
            loc.wealth = locData.wealth;
            loc.stability = locData.stability;
            loc.dangerLevel = locData.dangerLevel;
            world.addLocation(loc);
        }
        
        // Create default factions
        const factions = [
            { id: "kingdom", name: "Kingdom of Valdoria", power: 80, resources: 70, aggression: 30 },
            { id: "merchants_guild", name: "Merchants Guild", power: 50, resources: 90, aggression: 10 },
            { id: "thieves_guild", name: "Shadow Brotherhood", power: 30, resources: 50, aggression: 80 }
        ];
        
        for (const factData of factions) {
            const faction = new Faction(factData.id, factData.name);
            faction.power = factData.power;
            faction.resources = factData.resources;
            faction.aggression = factData.aggression;
            
            // Phase 3: Assign random long-term goals
            world._assignRandomGoals(faction);
            
            world.addFaction(faction);
        }
        
        // Set controlling faction for main town
        const centralTown = world.getLocation("town_central");
        if (centralTown) {
            centralTown.controllingFactionId = "kingdom";
        }
        
        // Create player
        const player = new Player(playerName, playerLocationId);
        world.setPlayer(player);
        
        // Set initial reputation
        player.setReputation("kingdom", 10);
        player.setReputation("merchants_guild", 0);
        player.setReputation("thieves_guild", -10);
        
        return world;
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Export all classes for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        World,
        Location,
        Faction,
        NPC,
        Player,
        StatusEffect,
        WorldChange,
        ActionResult,
        WorldEvent,
        EventQueue,
        MinHeap,
        IMPORTANCE_TABLE,
        DEFAULT_REGEN,
        DEFAULT_CONSUMPTION,
        STATUS_THRESHOLDS,
        EVENT_LIMITS,
        STRATEGIC_UPDATE_INTERVAL
    };
}

// Also make available globally for browser
if (typeof window !== 'undefined') {
    window.RPGEngine = {
        World,
        Location,
        Faction,
        NPC,
        Player,
        StatusEffect,
        WorldChange,
        ActionResult,
        WorldEvent,
        EventQueue,
        MinHeap,
        IMPORTANCE_TABLE,
        DEFAULT_REGEN,
        DEFAULT_CONSUMPTION,
        STATUS_THRESHOLDS,
        EVENT_LIMITS,
        STRATEGIC_UPDATE_INTERVAL
    };
}