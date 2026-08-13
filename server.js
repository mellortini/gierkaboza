/**
 * Multiplayer RPG Server with Socket.io
 * Handles real-time game synchronization between players
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);

// Global CORS - must be first
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'false');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

app.use(express.json({ limit: '10mb' }));

// Socket.io configuration for Railway - optimized for free tier limits
const io = new Server(server, {
    transports: ['polling'],
    pingTimeout: 20000,        // Reduced from 30000 to free up connections faster
    pingInterval: 15000,       // Increased from 10000 to reduce traffic
    allowEIO3: true,
    perMessageDeflate: false,
    cookie: false,
    serveClient: true,
    maxHttpBufferSize: 1e6,
    connectTimeout: 10000,     // 10s timeout for new connections
    // Cleanup settings to prevent connection buildup
    cleanupEmptyChildNamespaces: true
});

// Log all Socket.io errors
io.engine.on('connection_error', (err) => {
    console.log('Connection error:', err.req, err.code, err.message, err.context);
});

// Limit connections to prevent Railway backend.max_conn errors
const MAX_CONNECTIONS = 25;
io.use((socket, next) => {
    const currentConnections = io.engine.clientsCount;
    if (currentConnections >= MAX_CONNECTIONS) {
        console.log(`Connection rejected: max connections (${MAX_CONNECTIONS}) reached`);
        return next(new Error('Server is full. Please try again later.'));
    }
    const token = socket.handshake?.auth?.token || '';
    socket.authUser = token ? authUserFromToken(token) : null;
    if (token && !socket.authUser) {
        return next(new Error('Sesja konta wygasła. Zaloguj się ponownie.'));
    }
    next();
});

// Trust proxy for Railway
app.set('trust proxy', 1);

// Serve static files from root directory
const rootDir = __dirname;
app.use(express.static(rootDir, {
    index: ['index.html', 'index.htm']
}));

// Serve index.html for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

// Also serve index.html at /index.html
app.get('/index.html', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', rooms: rooms.size, players: io.engine.clientsCount });
});

// ============================================================================
// GAME STATE
// ============================================================================

// Active game worlds - keyed by room ID
const rooms = new Map();

// Player sessions - keyed by socket ID
const players = new Map();
const actionRateLimits = new Map();
const accountSockets = new Map();
const authLoginAttempts = new Map();

// ====================== PEŁNY SILNIK (fazy 1-5) ======================
let World;
let Player;
try {
    const engineModule = require('./engine.js');
    World = engineModule.World;
    Player = engineModule.Player;
    console.log('✅ PEŁNY SILNIK RPG (fazy 1-5) ZAŁADOWANY POMYŚLNIE');
} catch (err) {
    console.error('❌ BŁĄD ŁADOWANIA ENGINE.JS:');
    console.error(err.message);
    console.error(err.stack);
    process.exit(1); // zatrzymujemy serwer, bo bez silnika nie ma sensu
}

// Prototype persistence. For Railway, mount a volume or replace this adapter
// with a real database before running multiple replicas.
// Railway's filesystem is ephemeral unless a Volume is mounted. Allow the
// deployment to point persistence at a mounted directory without changing
// the local development default.
const DATA_DIR = process.env.RPG_DATA_DIR
    ? path.resolve(process.env.RPG_DATA_DIR)
    : path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const AUTH_SEED_FILE = path.join(__dirname, 'auth', 'seed-users.example.json');
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');
const rejoinSessions = new Map();
const scenarioCatalog = new Map();

const AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
let authState = {
    users: {},
    friendships: [],
    invites: [],
    sessions: {}
};

function safeAuthText(value, max = 120) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function friendshipUsers(userA, userB) {
    return [String(userA || ''), String(userB || '')].sort();
}

function friendshipKey(userA, userB) {
    return friendshipUsers(userA, userB).join(':');
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function verifyPassword(password, encodedHash) {
    if (typeof password !== 'string' || typeof encodedHash !== 'string') return false;
    const parts = encodedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = parts[4];
    const expectedHex = parts[5];
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || !salt || !/^[a-f0-9]+$/i.test(expectedHex)) return false;
    try {
        const actual = crypto.scryptSync(password, salt, expectedHex.length / 2, { N, r, p });
        const expected = Buffer.from(expectedHex, 'hex');
        return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
    } catch (error) {
        return false;
    }
}

function createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const N = 16384;
    const r = 8;
    const p = 1;
    const derived = crypto.scryptSync(String(password), salt, 64, { N, r, p }).toString('hex');
    return `scrypt$${N}$${r}$${p}$${salt}$${derived}`;
}

function publicUser(userId) {
    const user = authState.users[userId];
    if (!user) return null;
    return {
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        online: accountSockets.has(user.id)
    };
}

function persistAuthState() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const tempFile = `${AUTH_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(authState, null, 2), 'utf8');
        fs.renameSync(tempFile, AUTH_FILE);
    } catch (error) {
        console.error('Could not persist auth state:', error.message);
    }
}

function loadAuthState() {
    let changed = false;
    try {
        if (fs.existsSync(AUTH_FILE)) {
            const stored = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
            if (stored && typeof stored === 'object') {
                authState = {
                    users: stored.users && typeof stored.users === 'object' ? stored.users : {},
                    friendships: Array.isArray(stored.friendships) ? stored.friendships : [],
                    invites: Array.isArray(stored.invites) ? stored.invites : [],
                    sessions: stored.sessions && typeof stored.sessions === 'object' ? stored.sessions : {}
                };
            }
        }
    } catch (error) {
        console.error('Could not load auth state:', error.message);
    }

    try {
        if (fs.existsSync(AUTH_SEED_FILE)) {
            const seed = JSON.parse(fs.readFileSync(AUTH_SEED_FILE, 'utf8'));
            for (const user of Array.isArray(seed.users) ? seed.users : []) {
                const password = user?.passwordEnv ? process.env[user.passwordEnv] : '';
                if (!user?.id || !user?.username || !password) continue;
                if (!authState.users[user.id]) {
                    authState.users[user.id] = {
                        id: user.id,
                        username: String(user.username).toLowerCase(),
                        displayName: user.displayName || user.username,
                        passwordHash: createPasswordHash(password),
                        createdAt: Date.now()
                    };
                    changed = true;
                }
            }
            for (const friendship of Array.isArray(seed.friendships) ? seed.friendships : []) {
                const key = friendshipKey(friendship.userA, friendship.userB);
                if (!key || authState.friendships.some(item => friendshipKey(item.userA, item.userB) === key)) continue;
                authState.friendships.push({
                    id: friendship.id || `friendship_${key}`,
                    userA: friendship.userA,
                    userB: friendship.userB,
                    status: friendship.status === 'accepted' ? 'accepted' : 'pending',
                    requestedBy: friendship.requestedBy || friendship.userA,
                    createdAt: Date.now(),
                    updatedAt: Date.now()
                });
                changed = true;
            }
        }
    } catch (error) {
        console.error('Could not load auth seed:', error.message);
    }

    const now = Date.now();
    for (const [hash, session] of Object.entries(authState.sessions)) {
        if (!session || Number(session.expiresAt) <= now || !authState.users[session.userId]) {
            delete authState.sessions[hash];
            changed = true;
        }
    }
    if (changed || !fs.existsSync(AUTH_FILE)) persistAuthState();
}

function createAuthSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + AUTH_SESSION_TTL_MS;
    authState.sessions[hashSessionToken(token)] = { userId, expiresAt, createdAt: Date.now() };
    persistAuthState();
    return { token, expiresAt };
}

function authUserFromToken(token) {
    const normalized = safeAuthText(token, 300);
    if (!normalized) return null;
    const hash = hashSessionToken(normalized);
    const session = authState.sessions[hash];
    if (!session || Number(session.expiresAt) <= Date.now()) {
        if (session) {
            delete authState.sessions[hash];
            persistAuthState();
        }
        return null;
    }
    return authState.users[session.userId] || null;
}

function requestAuthUser(req) {
    const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    return authUserFromToken(token);
}

function requireAuth(req, res, next) {
    const user = requestAuthUser(req);
    if (!user) return res.status(401).json({ error: 'auth_required', message: 'Zaloguj się, aby korzystać z konta.' });
    req.authUser = user;
    next();
}

function findUserByUsername(username) {
    const normalized = safeAuthText(username, 80).toLowerCase();
    return Object.values(authState.users).find(user => user.username === normalized) || null;
}

function getFriendship(userA, userB) {
    const key = friendshipKey(userA, userB);
    return authState.friendships.find(item => friendshipKey(item.userA, item.userB) === key) || null;
}

function accountSnapshot(userId) {
    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const friendship of authState.friendships) {
        const isParticipant = friendship.userA === userId || friendship.userB === userId;
        if (!isParticipant) continue;
        const otherId = friendship.userA === userId ? friendship.userB : friendship.userA;
        if (friendship.status === 'accepted') {
            const user = publicUser(otherId);
            if (user) friends.push(user);
        } else if (friendship.requestedBy === userId) {
            const user = publicUser(otherId);
            if (user) outgoing.push(user);
        } else {
            const user = publicUser(otherId);
            if (user) incoming.push(user);
        }
    }
    const invites = authState.invites
        .filter(invite => invite.toUserId === userId && invite.status === 'pending' && Number(invite.expiresAt) > Date.now())
        .map(publicInvite)
        .filter(Boolean);
    return { user: publicUser(userId), friends, incoming, outgoing, invites };
}

function publicInvite(invite) {
    if (!invite) return null;
    const from = publicUser(invite.fromUserId);
    const to = publicUser(invite.toUserId);
    return {
        id: invite.id,
        roomId: invite.roomId,
        roomName: invite.roomName || invite.roomId,
        from: from ? { id: from.id, username: from.username, displayName: from.displayName } : null,
        to: to ? { id: to.id, username: to.username, displayName: to.displayName } : null,
        status: invite.status,
        createdAt: invite.createdAt,
        expiresAt: invite.expiresAt
    };
}

function emitAccountEvent(userId, event, payload) {
    const sockets = accountSockets.get(userId);
    if (!sockets) return;
    for (const socketId of sockets) io.to(socketId).emit(event, payload);
}

loadAuthState();

function normalizeScenarioId(value) {
    return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function publicScenarioSummary(record) {
    const scenario = record?.blueprint?.scenario || {};
    const world = record?.blueprint?.world || {};
    return {
        id: record.id,
        file: record.fileName,
        title: boundedText(scenario.title, 240) || boundedText(world.name, 240) || record.id,
        name: boundedText(world.name, 240) || null,
        description: boundedText(world.description, 2000) || null,
        pitch: boundedText(scenario.pitch, 2000) || null,
        tone: boundedText(scenario.tone, 240) || null,
        acts: Array.isArray(scenario.acts)
            ? scenario.acts.map(act => boundedText(act?.title, 240)).filter(Boolean).slice(0, 50)
            : []
    };
}

function loadScenarioCatalog() {
    scenarioCatalog.clear();
    if (!fs.existsSync(SCENARIOS_DIR)) return;
    for (const fileName of fs.readdirSync(SCENARIOS_DIR)) {
        if (!fileName.toLowerCase().endsWith('.json')) continue;
        const filePath = path.join(SCENARIOS_DIR, fileName);
        try {
            const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const sourceBlueprint = payload?.blueprint || payload?.worldBlueprint || payload;
            const validatedBlueprint = World.validateBlueprint(sourceBlueprint);
            const blueprint = {
                ...sourceBlueprint,
                ...validatedBlueprint,
                ...(payload?.scenario ? { scenario: payload.scenario } : {}),
                ...(payload?.scenarioState ? { scenarioState: payload.scenarioState } : {})
            };
            const id = normalizeScenarioId(blueprint?.scenario?.id)
                || normalizeScenarioId(payload?.id)
                || path.basename(fileName, '.json');
            if (id) scenarioCatalog.set(id, { id, fileName, blueprint });
        } catch (error) {
            console.warn(`Skipping invalid scenario ${fileName}:`, error.message);
        }
    }
}

loadScenarioCatalog();

function createRoom(roomId, world = null, persisted = {}) {
    return {
        id: roomId,
        world,
        players: new Map(),
        savedPlayers: new Map(Object.entries(persisted.savedPlayers || {})),
        savedPlayerOwners: new Map(Object.entries(persisted.savedPlayerOwners || {})),
        createdAt: persisted.createdAt || Date.now(),
        lastActiveAt: persisted.lastActiveAt || Date.now(),
        hostId: null,
        hostPlayerId: persisted.hostPlayerId || null,
        lobby: createLobbyState(persisted.lobby || {}, world),
        chatHistory: Array.isArray(persisted.chatHistory) ? persisted.chatHistory.slice(-50) : [],
        playerHistories: persisted.playerHistories || {},
        actionHistory: Array.isArray(persisted.actionHistory) ? persisted.actionHistory.slice(-120) : [],
        actionQueue: Promise.resolve(),
        narrativeConsolidationPromise: null,
        narrativeConsolidationNextAttemptAt: 0
    };
}

function boundedText(value, max = 2000) {
    return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

const PUBLIC_SENSITIVE_KEY_RE = /(director|secret|private|api.?key|token|password|authorization|credential|plan)/i;

function publicSafeValue(value, depth = 0) {
    if (depth > 6 || value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return value.slice(0, 2000);
    if (Array.isArray(value)) {
        return value.slice(0, 100).map(item => publicSafeValue(item, depth + 1)).filter(item => item !== undefined);
    }
    if (typeof value === 'object') {
        const output = {};
        for (const key of Object.keys(value).slice(0, 100)) {
            if (PUBLIC_SENSITIVE_KEY_RE.test(key)) continue;
            const safe = publicSafeValue(value[key], depth + 1);
            if (safe !== undefined) output[String(key).slice(0, 100)] = safe;
        }
        return output;
    }
    return undefined;
}

function curatedCampaignSnapshot(metadata = {}, rawScenario = null) {
    const scenario = rawScenario && typeof rawScenario === 'object' ? {
        id: boundedText(rawScenario.id, 120) || null,
        title: boundedText(rawScenario.title, 240) || null,
        pitch: boundedText(rawScenario.pitch, 2000) || null,
        tone: boundedText(rawScenario.tone, 240) || null,
        acts: Array.isArray(rawScenario.acts) ? {
            count: rawScenario.acts.length,
            titles: rawScenario.acts.map(act => boundedText(act?.title, 240)).filter(Boolean).slice(0, 50)
        } : { count: 0, titles: [] }
    } : null;
    return {
        name: typeof metadata.name === 'string' ? metadata.name : null,
        description: typeof metadata.description === 'string' ? metadata.description : null,
        scenario
    };
}

function publicCampaignSnapshot(world) {
    if (!world) return null;
    const metadata = world.worldMetadata && typeof world.worldMetadata === 'object' ? world.worldMetadata : {};
    return curatedCampaignSnapshot(metadata, world.scenario || metadata.scenario || null);
}

function curatePersistedCampaign(campaign) {
    if (!campaign || typeof campaign !== 'object') return null;
    return curatedCampaignSnapshot(campaign, campaign.scenario || null);
}

function publicCharacterData(characterData) {
    return publicSafeValue(characterData && typeof characterData === 'object' ? characterData : {}) || {};
}

function createLobbyState(persisted = {}, world = null) {
    const hasPersistedLobby = persisted && typeof persisted === 'object' && persisted.status;
    const status = persisted.status === 'started' || (!hasPersistedLobby && world) ? 'started' : 'lobby';
    const characters = persisted.characters && typeof persisted.characters === 'object' ? publicSafeValue(persisted.characters) : {};
    const participants = persisted.participants && typeof persisted.participants === 'object' ? publicSafeValue(persisted.participants) : {};
    const selections = persisted.selections && typeof persisted.selections === 'object' ? publicSafeValue(persisted.selections) : {};
    const ready = persisted.ready && typeof persisted.ready === 'object' ? publicSafeValue(persisted.ready) : {};
    return {
        status,
        campaign: world ? publicCampaignSnapshot(world) : curatePersistedCampaign(persisted.campaign),
        characters: characters && typeof characters === 'object' && !Array.isArray(characters) ? characters : {},
        participants: participants && typeof participants === 'object' && !Array.isArray(participants) ? participants : {},
        selections: selections && typeof selections === 'object' && !Array.isArray(selections) ? selections : {},
        ready: ready && typeof ready === 'object' && !Array.isArray(ready) ? ready : {}
    };
}

function lobbySnapshot(room) {
    if (!room) return null;
    const lobby = room.lobby || createLobbyState({}, room.world);
    return {
        roomId: room.id,
        status: lobby.status,
        hostPlayerId: room.hostPlayerId || null,
        campaign: curatePersistedCampaign(lobby.campaign),
        characters: Object.values(lobby.characters || {}).map(character => ({
            id: character.id,
            ownerId: character.ownerId,
            ownerName: boundedText(lobby.participants?.[character.ownerId]?.name || character.name, 80),
            name: character.name,
            data: publicCharacterData(character.data),
            connected: character.connected === true,
            selected: lobby.selections?.[character.ownerId] === character.id,
            ready: lobby.ready?.[character.ownerId] === true
        })),
        participants: Object.values(lobby.participants || {}).map(participant => ({
            playerId: participant.playerId,
            name: participant.name,
            isHost: room.hostPlayerId === participant.playerId,
            connected: participant.connected === true,
            characterId: lobby.selections?.[participant.playerId] || null,
            selectedCharacterId: lobby.selections?.[participant.playerId] || null,
            ready: lobby.ready?.[participant.playerId] === true
        }))
    };
}

function selectedLobbyPlayers(room) {
    if (!room) return [];
    const lobby = room.lobby || createLobbyState({}, room.world);
    return Array.from(room.players.values()).map(player => {
        const characterId = lobby.selections?.[player.id] || null;
        const character = characterId ? lobby.characters?.[characterId] : null;
        return {
            playerId: player.id,
            name: boundedText(character?.name || player.name, 80),
            characterId,
            ready: lobby.ready?.[player.id] === true
        };
    });
}

function emitGameStarted(socketId, room, player, options = {}) {
    if (!room || !player) return;
    io.to(socketId).emit('gameStarted', {
        roomId: room.id,
        playerId: player.id,
        playerName: boundedText(player.name, 80),
        players: selectedLobbyPlayers(room),
        lobby: lobbySnapshot(room),
        timeline: room.actionHistory.slice(-60),
        chatHistory: room.chatHistory.slice(-50),
        worldState: serializeWorld(room.world, player.player, player.id),
        options: publicSafeValue(options || {})
    });
}

function lobbyError(socket, message, code = 'lobby_error') {
    socket.emit('lobbyError', { code, message: boundedText(message, 500) || 'Nieprawidłowa operacja lobby.' });
}

function emitLobbyUpdate(room) {
    if (room) io.to(room.id).emit('lobbyUpdate', lobbySnapshot(room));
}

function activePlayerForSocket(socket) {
    const session = players.get(socket.id);
    if (!session || !rooms.has(session.roomId)) return null;
    const room = rooms.get(session.roomId);
    const player = room.players.get(socket.id);
    return player ? { session, room, player } : null;
}

function registerLobbyParticipant(room, playerId, playerName, characterData) {
    if (!room.lobby) room.lobby = createLobbyState({}, room.world);
    const safeName = boundedText(playerName, 80) || 'Player';
    room.lobby.participants[playerId] = { playerId, name: safeName, connected: true };
    const existingCharacter = room.lobby.characters[playerId];
    if (!existingCharacter) {
        room.lobby.characters[playerId] = {
            id: playerId,
            ownerId: playerId,
            name: safeName,
            data: publicCharacterData(characterData),
            connected: true
        };
    } else {
        existingCharacter.name = safeName;
        existingCharacter.connected = true;
    }
    if (!room.lobby.selections[playerId]) room.lobby.selections[playerId] = playerId;
    if (room.lobby.ready[playerId] !== true) room.lobby.ready[playerId] = false;
}

function markLobbyDisconnected(room, playerId) {
    if (!room?.lobby) return;
    if (room.lobby.participants[playerId]) room.lobby.participants[playerId].connected = false;
    for (const character of Object.values(room.lobby.characters || {})) {
        if (character.ownerId === playerId) character.connected = false;
    }
}

function validateLobbyParticipant(socket, requireLobby = true) {
    const context = activePlayerForSocket(socket);
    if (!context) {
        lobbyError(socket, 'Nie jesteś w pokoju.', 'not_in_room');
        return null;
    }
    if (requireLobby && context.room.lobby?.status === 'started') {
        lobbyError(socket, 'Lobby zostało już zamknięte.', 'game_started');
        return null;
    }
    return context;
}

function handleLobbyReady(socket, data) {
    const context = validateLobbyParticipant(socket);
    if (!context) return;
    const { session, room } = context;
    if (typeof data?.ready !== 'boolean') {
        lobbyError(socket, 'Ready musi mieć wartość true albo false.', 'invalid_ready');
        return;
    }
    const selectedId = room.lobby.selections[session.playerId];
    const selected = selectedId && room.lobby.characters[selectedId];
    if (!selected || selected.ownerId !== session.playerId) {
        lobbyError(socket, 'Najpierw wybierz własną postać.', 'character_not_selected');
        return;
    }
    room.lobby.ready[session.playerId] = data.ready;
    persistRooms();
    emitLobbyUpdate(room);
}

const SCENARIO_CHOICE_MARKER_RE = /\[\[SCENARIO_CHOICE:\s*(\{[\s\S]{0,4000}?\})\s*\]\]/g;

function extractScenarioChoiceMarkers(text) {
    let markerCount = 0;
    const choices = [];
    const cleanText = String(text || '').replace(SCENARIO_CHOICE_MARKER_RE, (marker, payload) => {
        markerCount += 1;
        if (markerCount <= 8) {
            try {
                const parsed = JSON.parse(payload);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
                    typeof parsed.choiceId === 'string' && parsed.choiceId.trim() &&
                    typeof parsed.optionId === 'string' && parsed.optionId.trim() &&
                    parsed.choiceId.length <= 160 && parsed.optionId.length <= 160) {
                    choices.push({ choiceId: parsed.choiceId.trim(), optionId: parsed.optionId.trim() });
                }
            } catch (error) {
                // Invalid hidden markers are deliberately ignored after removal.
            }
        }
        return '';
    });
    return { text: cleanText.trim(), choices };
}

function applyScenarioChoices(world, choices) {
    if (!world || typeof world.recordScenarioChoice !== 'function') return;
    for (const choice of Array.isArray(choices) ? choices : []) {
        try {
            // Only IDs from the marker are accepted; flags/variables never come from model output.
            world.recordScenarioChoice({ choiceId: choice.choiceId, optionId: choice.optionId });
        } catch (error) {
            console.warn('Scenario choice marker ignored:', error.message);
        }
    }
}

function getPlayerHistory(room, playerId, socketId = null) {
    if (!room.playerHistories) room.playerHistories = {};
    const stableId = boundedText(playerId, 120);
    const legacyId = boundedText(socketId, 120);
    if (!room.playerHistories[stableId] && legacyId && Array.isArray(room.playerHistories[legacyId])) {
        room.playerHistories[stableId] = room.playerHistories[legacyId];
        delete room.playerHistories[legacyId];
    }
    if (!Array.isArray(room.playerHistories[stableId])) room.playerHistories[stableId] = [];
    return room.playerHistories[stableId];
}

function restoreWorldSnapshot(snapshot, playerName) {
    if (!snapshot || !Array.isArray(snapshot.locations) || !Array.isArray(snapshot.factions)) {
        throw new Error('Incomplete world snapshot');
    }
    const world = World.fromJSON(snapshot);
    if (world.locations.size === 0) throw new Error('World snapshot has no locations');
    if (!world.player) world.setPlayer(new Player(playerName, 'town_central'));
    return world;
}

function allowAction(socketId) {
    const now = Date.now();
    const current = actionRateLimits.get(socketId);
    if (!current || now - current.startedAt >= 60000) {
        actionRateLimits.set(socketId, { startedAt: now, count: 1 });
        return true;
    }
    if (current.count >= 20) return false;
    current.count += 1;
    return true;
}

function persistRooms() {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const data = Array.from(rooms.values()).map(room => ({
            id: room.id,
            world: room.world ? room.world.toJSON() : null,
            savedPlayers: Object.fromEntries(room.savedPlayers || []),
            savedPlayerOwners: Object.fromEntries(room.savedPlayerOwners || []),
            createdAt: room.createdAt,
            lastActiveAt: room.lastActiveAt,
            hostPlayerId: room.hostPlayerId || null,
            lobby: publicSafeValue(room.lobby || createLobbyState({}, room.world)),
            chatHistory: room.chatHistory.slice(-50),
            actionHistory: room.actionHistory.slice(-120),
            playerHistories: Object.fromEntries(
                Object.entries(room.playerHistories || {}).map(([id, history]) => [id, history.slice(-100)])
            )
        }));
        const tempFile = `${ROOMS_FILE}.tmp`;
        fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tempFile, ROOMS_FILE);
    } catch (error) {
        console.error('Could not persist rooms:', error.message);
    }
}

function loadPersistedRooms() {
    if (!fs.existsSync(ROOMS_FILE)) return;
    try {
        const data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8'));
        for (const savedRoom of Array.isArray(data) ? data : []) {
            if (!savedRoom.id || !savedRoom.world) continue;
            rooms.set(savedRoom.id, createRoom(savedRoom.id, World.fromJSON(savedRoom.world), savedRoom));
        }
        console.log(`Loaded ${rooms.size} persisted room(s)`);
    } catch (error) {
        console.error('Could not load persisted rooms:', error.message);
    }
}

loadPersistedRooms();

// ============================================================================
// SOCKET.IO HANDLERS
// ============================================================================

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}, transport: ${socket.conn.transport.name}`);
    if (socket.authUser) {
        if (!accountSockets.has(socket.authUser.id)) accountSockets.set(socket.authUser.id, new Set());
        accountSockets.get(socket.authUser.id).add(socket.id);
        emitAccountEvent(socket.authUser.id, 'accountPresence', { userId: socket.authUser.id, online: true });
    }

    // Handle transport upgrade
    socket.conn.on('upgrade', (transport) => {
        console.log(`Transport upgraded for ${socket.id}: ${transport.name}`);
    });

    // Handle connection errors
    socket.conn.on('error', (err) => {
        console.error(`Connection error for ${socket.id}:`, err.message);
    });

    // Create or join a game room
    socket.on('joinRoom', (data) => {
        try {
            const {
                roomId: rawRoomId,
                playerName: rawPlayerName,
                characterData,
                worldData,
                worldBlueprint,
                worldOption,
                scenarioId: rawScenarioId,
                createRoom: createRoomRequest,
                playerId: requestedPlayerId
            } = data || {};
            const roomId = String(rawRoomId || '').trim();
            const playerName = String(rawPlayerName || '').trim();
            const scenarioId = normalizeScenarioId(rawScenarioId);
            const roomAlreadyExists = rooms.has(roomId);

            if (!socket.authUser) {
                socket.emit('joinError', { code: 'auth_required', message: 'Zaloguj się na konto, zanim dołączysz do multiplayera.' });
                return;
            }

            console.log(`Join room request: ${roomId}, player: ${playerName}, worldOption: ${worldOption}, scenarioId: ${scenarioId || 'none'}, createRoom: ${createRoomRequest === true}`);
            
            // Validate data
            if (!roomId || !playerName || roomId.length > 64 || playerName.length > 80) {
                socket.emit('joinError', { message: 'Podaj poprawne ID pokoju i nazwę gracza (maks. 64/80 znaków).' });
                return;
            }

            if (createRoomRequest === true && roomAlreadyExists) {
                socket.emit('joinError', { message: 'Pokój o tym ID już istnieje. Wybierz inne ID albo użyj przycisku „Dołącz do pokoju”.' });
                return;
            }
            if (createRoomRequest === false && !roomAlreadyExists) {
                socket.emit('joinError', { message: 'Nie znaleziono takiego pokoju. Host musi najpierw utworzyć pokój.' });
                return;
            }
            if (!roomAlreadyExists && scenarioId && !scenarioCatalog.has(scenarioId)) {
                socket.emit('joinError', { message: `Wybrany scenariusz nie jest dostępny na serwerze: ${scenarioId}` });
                return;
            }
            
            // Create room if it doesn't exist
            if (!rooms.has(roomId)) {
            rooms.set(roomId, createRoom(roomId));
                /* id: roomId,
                world: null,          // Will be created when first player joins
                players: new Map(),   // playerId -> player data
                createdAt: Date.now(),
                hostId: socket.id,
                chatHistory: [],      // Historia czatu graczy (dla kontekstu AI)
                playerHistories: {}   // Historia narracji dla KAŻDEGO gracza osobno
            }); */
        }

        const room = rooms.get(roomId);
        room.lastActiveAt = Date.now();
        const incomingWorld = worldData && worldData.world ? worldData.world : worldData;
        
        // Create or load world based on option
        if (!room.world) {
            if (scenarioId) {
                const scenarioRecord = scenarioCatalog.get(scenarioId);
                try {
                    room.world = World.createFromBlueprint(scenarioRecord.blueprint, playerName);
                    console.log(`World created from server scenario: ${scenarioId}`);
                } catch (e) {
                    console.error('Error creating world from server scenario:', e);
                    socket.emit('joinError', { message: 'Nie udało się uruchomić wybranego scenariusza.' });
                    return;
                }
            } else if (worldOption === 'sandbox') {
                room.world = World.createSandboxWorld(playerName);
                console.log('Sandbox world created without a predefined map');
            } else if (worldBlueprint && worldOption !== 'current' && worldOption !== 'saved') {
                try {
                    room.world = World.createFromBlueprint(worldBlueprint, playerName);
                    console.log('World created from structured blueprint');
                } catch (e) {
                    console.error('Error creating world from blueprint:', e);
                    socket.emit('joinError', { message: 'Nie udało się utworzyć świata z wybranej kampanii.' });
                    return;
                }
            } else if (incomingWorld && worldOption === 'current') {
                // Load world from client data
                try {
                    room.world = restoreWorldSnapshot(incomingWorld, playerName);
                    console.log('World loaded from client data');
                } catch (e) {
                    console.error('Error loading world from client:', e);
                    room.world = World.createStarterWorld(playerName, 'town_central');
                }
            } else if (worldOption === 'saved' && incomingWorld) {
                try {
                    room.world = restoreWorldSnapshot(incomingWorld, playerName);
                    console.log('World loaded from saved game');
                } catch (e) {
                    console.error('Error loading saved world:', e);
                    room.world = World.createStarterWorld(playerName, 'town_central');
                }
            } else {
                // No scenario/blueprint means true freeform sandbox, not the old starter map.
                room.world = World.createSandboxWorld(playerName);
                console.log('Sandbox world created as the default no-scenario mode');
            }
        }
        if (!room.lobby) room.lobby = createLobbyState({}, room.world);
        room.lobby.campaign = publicCampaignSnapshot(room.world);
        // Add or restore a player. The world remains shared, while character state is per socket/player.
        const savedPlayerOwner = requestedPlayerId ? room.savedPlayerOwners.get(requestedPlayerId) : null;
        const canRestoreRequestedPlayer = requestedPlayerId && room.savedPlayers.has(requestedPlayerId)
            && (!savedPlayerOwner || savedPlayerOwner === socket.authUser.id);
        const playerId = canRestoreRequestedPlayer
            ? requestedPlayerId
            : `player_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        const savedPlayer = room.savedPlayers.get(playerId);
        const isFirstActivePlayer = room.players.size === 0;
        const gamePlayer = savedPlayer
            ? Player.fromJSON(savedPlayer)
            : (isFirstActivePlayer && room.world.player
                ? room.world.player
                : new Player(playerName, room.world.player?.locationId || 'town_central'));
        gamePlayer.name = playerName;
        room.savedPlayers.delete(playerId);
        room.savedPlayerOwners.delete(playerId);
        const activeHost = room.hostId && room.players.has(room.hostId);
        if (!activeHost && (!room.hostPlayerId || room.hostPlayerId === playerId || room.lobby.participants?.[room.hostPlayerId]?.connected !== true)) {
            room.hostId = socket.id;
            room.hostPlayerId = playerId;
        }
        if (!room.world.player) room.world.player = gamePlayer;
        room.players.set(socket.id, {
            id: playerId,
            socketId: socket.id,
            authUserId: socket.authUser.id,
            name: playerName,
            characterData: characterData || {},
            player: gamePlayer,
            joinedAt: Date.now(),
            isHost: room.hostId === socket.id
        });
        registerLobbyParticipant(room, playerId, playerName, characterData);
        room.lobby.characters[playerId].connected = true;

        // Join socket room
        socket.join(roomId);
        socket.roomId = roomId;

        // Store player info
        players.set(socket.id, {
            roomId,
            playerId,
            playerName,
            authUserId: socket.authUser.id,
            characterData: characterData || {}
        });

        // Send room info to player
        socket.emit('roomJoined', {
            success: true,
            roomId,
            playerId,
            playerName: playerName,
            isHost: room.hostId === socket.id,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            })),
            lobby: lobbySnapshot(room),
            worldState: serializeWorld(room.world, gamePlayer, playerId)
        });

        // Notify other players
        socket.to(roomId).emit('playerJoined', {
            playerId,
            playerName,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            }))
        });
        emitLobbyUpdate(room);
        if (room.lobby.status === 'started') {
            emitGameStarted(socket.id, room, room.players.get(socket.id));
        }

        room.lastActiveAt = Date.now();
        persistRooms();
        console.log(`${playerName} joined room ${roomId}`);
        } catch (err) {
            console.error('Error in joinRoom:', err);
            socket.emit('joinError', { message: 'Błąd serwera: ' + err.message });
        }
    });

    socket.on('addCharacter', (data) => {
        const context = validateLobbyParticipant(socket);
        if (!context) return;
        const { session, room } = context;
        const input = data?.characterData && typeof data.characterData === 'object' ? data.characterData : (data?.character || {});
        const requestedId = boundedText(data?.characterId || input.characterId || input.id, 80);
        const characterId = requestedId || `character_${session.playerId}_${Date.now().toString(36)}`;
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(characterId)) {
            lobbyError(socket, 'Nieprawidłowe ID postaci.', 'invalid_character_id');
            return;
        }
        if (room.lobby.characters[characterId]) {
            lobbyError(socket, 'Postać o takim ID już istnieje.', 'character_exists');
            return;
        }
        const name = boundedText(data?.name || input.name || session.playerName, 80) || 'Character';
        room.lobby.characters[characterId] = {
            id: characterId,
            ownerId: session.playerId,
            name,
            data: publicCharacterData(input),
            connected: true
        };
        if (!room.lobby.selections[session.playerId]) room.lobby.selections[session.playerId] = characterId;
        room.lobby.ready[session.playerId] = false;
        room.lastActiveAt = Date.now();
        persistRooms();
        emitLobbyUpdate(room);
    });

    socket.on('selectCharacter', (data) => {
        const context = validateLobbyParticipant(socket);
        if (!context) return;
        const { session, room } = context;
        const characterId = boundedText(data?.characterId || data?.id, 80);
        const character = room.lobby.characters[characterId];
        if (!character) {
            lobbyError(socket, 'Wybrana postać nie istnieje.', 'character_not_found');
            return;
        }
        if (character.ownerId !== session.playerId) {
            lobbyError(socket, 'Możesz wybrać tylko własną postać.', 'character_owner_required');
            return;
        }
        room.lobby.selections[session.playerId] = characterId;
        room.lobby.ready[session.playerId] = false;
        persistRooms();
        emitLobbyUpdate(room);
    });

    socket.on('removeCharacter', (data) => {
        const context = validateLobbyParticipant(socket);
        if (!context) return;
        const { session, room } = context;
        const characterId = boundedText(data?.characterId || data?.id, 80);
        const character = room.lobby.characters[characterId];
        if (!character) {
            lobbyError(socket, 'Postać nie istnieje.', 'character_not_found');
            return;
        }
        if (character.ownerId !== session.playerId) {
            lobbyError(socket, 'Możesz usunąć tylko własną postać.', 'character_owner_required');
            return;
        }
        delete room.lobby.characters[characterId];
        if (room.lobby.selections[session.playerId] === characterId) {
            const replacement = Object.values(room.lobby.characters).find(item => item.ownerId === session.playerId);
            if (replacement) room.lobby.selections[session.playerId] = replacement.id;
            else delete room.lobby.selections[session.playerId];
        }
        room.lobby.ready[session.playerId] = false;
        persistRooms();
        emitLobbyUpdate(room);
    });

    socket.on('setReady', (data) => handleLobbyReady(socket, data));
    socket.on('ready', (data) => handleLobbyReady(socket, data));

    socket.on('startGame', (data) => {
        const context = validateLobbyParticipant(socket);
        if (!context) return;
        const { session, room } = context;
        if (room.hostId !== socket.id && room.hostPlayerId !== session.playerId) {
            lobbyError(socket, 'Tylko host może rozpocząć grę.', 'host_required');
            return;
        }
        const activePlayers = Array.from(room.players.values());
        const missing = activePlayers.filter(player => {
            const selectedId = room.lobby.selections[player.id];
            return !selectedId || !room.lobby.characters[selectedId] || room.lobby.characters[selectedId].ownerId !== player.id || room.lobby.ready[player.id] !== true;
        });
        if (missing.length > 0) {
            lobbyError(socket, `Nie wszyscy gracze są gotowi: ${missing.map(player => player.name).join(', ')}.`, 'players_not_ready');
            return;
        }
        room.lobby.status = 'started';
        for (const player of activePlayers) {
            const selected = room.lobby.characters[room.lobby.selections[player.id]];
            if (selected && selected.data) {
                player.characterData = { ...player.characterData, ...selected.data };
                player.name = selected.name || player.name;
                const session = players.get(player.socketId);
                if (session) {
                    session.playerName = player.name;
                    session.characterData = player.characterData;
                }
            }
        }
        room.lastActiveAt = Date.now();
        persistRooms();
        emitLobbyUpdate(room);
        for (const [socketId, player] of room.players.entries()) {
            emitGameStarted(socketId, room, player, data?.options || {});
        }
    });

    // Serialize actions per room so simultaneous requests cannot overwrite world state.
    socket.on('playerAction', (data) => {
        const player = players.get(socket.id);
        if (!player || !rooms.has(player.roomId)) {
            socket.emit('actionError', { message: 'Not in a room' });
            return;
        }
        if (!allowAction(socket.id)) {
            socket.emit('actionError', { message: 'Za dużo akcji. Odczekaj chwilę.' });
            return;
        }
        const room = rooms.get(player.roomId);
        room.actionQueue = (room.actionQueue || Promise.resolve())
            .then(() => processPlayerAction(socket, data))
            .catch((err) => {
                console.error('Error processing player action:', err);
                socket.emit('actionError', { message: 'Nie udało się wykonać akcji.' });
            });
    });

    async function processPlayerAction(socket, data) {
        const { action: rawAction, sceneType, sceneTags, model: actionModel } = data || {};
        const action = typeof rawAction === 'string' ? rawAction.trim() : '';
        const player = players.get(socket.id);
        if (!player || !rooms.has(player.roomId)) {
            socket.emit('actionError', { message: 'Not in a room' });
            return;
        }
        if (!action || action.length > 2000) {
            socket.emit('actionError', { message: 'Akcja musi mieć od 1 do 2000 znaków.' });
            return;
        }

        const room = rooms.get(player.roomId);
        const world = room.world;
        const playerData = room.players.get(socket.id);
        if (!playerData || !playerData.player) {
            socket.emit('actionError', { message: 'Stan gracza nie jest dostępny.' });
            return;
        }

        const currentPlayer = playerData.player;
        // Context builders use World.player as the viewpoint; switch it to the actor
        // for this serialized turn while the character sheet remains per player.
        world.player = currentPlayer;
        const mechanicalResult = world.performPlayerAction
            ? world.performPlayerAction(action, currentPlayer)
            : null;

        // Build context for the action
        let context = '';
        if (world.buildContextForScene) {
            try {
                const memoryContext = world.buildContextForScene(sceneType || 'default', sceneTags || []);
                if (memoryContext && memoryContext.historyNodes && memoryContext.historyNodes.length > 0) {
                    context = '\n\n## KONTEKST HISTORYCZNY:\n';
                    for (const node of memoryContext.historyNodes) {
                        context += `- ${node.summaryText}\n`;
                    }
                }
            } catch (e) {
                console.warn("Error building context:", e);
            }
        }

        // Get current player state for context
        const location = world.getLocation(currentPlayer.locationId);
        const worldChanges = Array.isArray(mechanicalResult?.worldChanges)
            ? mechanicalResult.worldChanges
            : Array.isArray(mechanicalResult?.changes)
                ? mechanicalResult.changes
                : [];
        const mechanicStatus = mechanicalResult
            ? mechanicalResult.success && worldChanges.length > 0
                ? 'akcja wykonana i stan świata zmieniony'
                : mechanicalResult.success
                    ? 'akcja zarejestrowana, ale stan świata nie został zmieniony'
                    : 'akcja odrzucona — stan świata nie został zmieniony'
            : '';
        const mechanicsContext = mechanicalResult
            ? `Mechanika: ${mechanicStatus} — ${mechanicalResult.message}. `
            : '';
        const availableExits = Array.isArray(location?.connections)
            ? location.connections
                .map(connectionId => world.getLocation(connectionId))
                .filter(Boolean)
                .map(exit => exit.name)
            : [];

        // Build action context - be brief, don't describe location every time
        let actionContext = `Jesteś ${playerData.name}. `;
        actionContext += `Akcja: "${action}". `;
        actionContext += mechanicsContext;
        actionContext += `To dzieje się w ${location ? location.name : currentPlayer.locationId}. `;
        actionContext += `Jest ${world.getFormattedTime()}, dzień ${world.getDayNumber()}. `;
        actionContext += availableExits.length > 0
            ? `Bezpośrednio dostępne przejścia: ${availableExits.join(', ')}. `
            : 'Brak zdefiniowanych bezpośrednich przejść z tej lokacji. ';
        actionContext += world.isSandbox
            ? 'Tryb SANDBOX: świat nie ma zamkniętej mapy. Jeśli gracz opisuje podróż do nowego, sensownego miejsca, mechanika utworzy tę lokację. Nie zastępuj celu innym miejscem i nie ograniczaj gracza do listy istniejących lokacji. '
            : 'Mechaniczny stan świata jest nadrzędny: narrator nie może przenieść postaci do innej lokacji, jeśli mechanika nie zgłosiła udanej podróży. Nie zastępuj nieznanego lub niedostępnego celu inną lokacją; opisz brak możliwości i poproś o poprawny cel. ';
        
        const narrativeEntityIds = [currentPlayer.locationId];
        for (const npc of world.npcs?.values?.() || []) {
            if (npc.locationId === currentPlayer.locationId) narrativeEntityIds.push(npc.id);
        }
        const narrativeContext = world.buildNarrativeContext({
            action,
            sceneType: sceneType || 'default',
            tags: sceneTags || [],
            playerId: playerData.id,
            // The narrator response is broadcast to the whole room, so only public
            // facts may enter this shared prompt. Keep playerId for relevance only.
            viewerId: 'public',
            locationId: currentPlayer.locationId,
            entityIds: narrativeEntityIds,
            includeDirectorSecrets: false,
            maxChars: 6000
        });
        const formattedNarrativeContext = formatNarrativeContext(narrativeContext, 6000);
        if (formattedNarrativeContext) {
            actionContext += `\n\n## WYBRANA PAMIEC FABULARNA:\n${formattedNarrativeContext}`;
        }
        if (context) actionContext += trimPreserveEnds(context, 4000);

        let scenarioDirectorContext = '';
        if (world && typeof world.getScenarioPrompt === 'function') {
            try {
                scenarioDirectorContext = trimPreserveEnds(
                    world.getScenarioPrompt(5000, { maskNpcNames: true }),
                    5000
                );
            } catch (error) {
                console.warn('Scenario director context unavailable:', error.message);
            }
        }
        if (scenarioDirectorContext) {
            actionContext += `\n\n## KONTEKST REŻYSERA SCENARIUSZA (TAJNE):\n${scenarioDirectorContext}\n`;
            actionContext += 'Traktuj ten brief jako instrukcję wewnętrzną: nigdy nie ujawniaj jego sekretów bezpośrednio ani nie sugeruj ich jako wiedzy narratora; ujawniaj je tylko przez wiarygodne odkrycia graczy.\n';
        }

        if (room.players.size > 1) {
            const others = Array.from(room.players.values())
                .filter(p => p.socketId !== socket.id)
                .map(p => p.name)
                .join(', ');
            actionContext += `Obok ciebie jest: ${others}. `;
        }

        const nameQuestion = /\b(imie|nazywasz|nazywam|przedstaw|kim jestes|kto ty|twoje imie)\b/i.test(action);
        const localNpcView = Array.from(world.npcs?.values?.() || [])
            .filter(npc => npc && npc.locationId === currentPlayer.locationId && npc.isAlive !== false)
            .slice(0, 8)
            .map((npc, index) => {
                const known = currentPlayer.knowsNpcName?.(npc.id) || currentPlayer.knownNpcIds?.has(npc.id);
                const displayName = known || nameQuestion
                    ? npc.name
                    : `Nieznana postać${index > 0 ? ` #${index + 1}` : ''}`;
                return `- ${displayName} | rola: ${boundedText(npc.role, 80) || 'nieznana'} | id: ${npc.id}`;
            });
        if (localNpcView.length > 0) {
            actionContext += `\n\n## NPC W AKTUALNEJ LOKACJI:\n${localNpcView.join('\n')}\n`;
            actionContext += nameQuestion
                ? 'Jeśli NPC podaje imię, użyj imienia z tej listy i nie ujawniaj imion innych NPC bez powodu.\n'
                : 'Przed pytaniem o imię używaj wyłącznie roli lub opisu „Nieznanej postaci”.\n';
        }
        
        // Keep a personal history for saves and backwards compatibility. The
        // shared action timeline below is the narrator's primary continuity
        // source, so every player can follow the party's latest decisions.
        const playerHistory = getPlayerHistory(room, playerData.id, socket.id);

        // Dołącz historię czatu graczy do kontekstu AI
        if (room.chatHistory && room.chatHistory.length > 0) {
            const recentChat = room.chatHistory.slice(-10); // ostatnie 10 wiadomości
            actionContext += `\n\n## OSTATNI CZAT MIĘDZY GRACZAMI:\n`;
            for (const msg of recentChat) {
                const tag = msg.type === 'in_character' ? '[IC]' : '[OOC]';
                actionContext += `${tag} ${msg.playerName}: ${msg.message}\n`;
            }
        }
        
        if (room.actionHistory.length > 0) {
            actionContext += `\n\n## OSTATNIE WSPÓLNE TURY (skrót):\n`;
            for (const turn of room.actionHistory.slice(-6)) {
                actionContext += `- ${turn.playerName}: ${boundedText(turn.action, 180)}\n`;
            }
        }

        // Sprawdź czy gracz prosi o szczegółowy opis
        const wantsDetailed = /szczeg[oó]łowo|opisz dokładnie|rozwiń|detale|wiecej szczeg[oó][lł]ow|bardziej szczeg[oó]łowo/i.test(action);
        
        // Dodaj ustawienia suwaków gracza do kontekstu
        const sliders = playerData.characterData?.sliders;
        if (sliders) {
            actionContext += `\n\n## USTAWIENIA TREŚCI (skala 1-10) - STOSUJ SIĘ DO TEGO!\n`;
            actionContext += `💀 Brutalność: ${sliders.violence}/10 ${getSliderDescription('violence', sliders.violence)}\n`;
            actionContext += `🔞 Erotyka: ${sliders.sexual}/10 ${getSliderDescription('sexual', sliders.sexual)}\n`;
            actionContext += `🌑 Mroczność: ${sliders.darkness}/10 ${getSliderDescription('darkness', sliders.darkness)}\n`;
            actionContext += `🎭 Realizm: ${sliders.realism}/10 ${getSliderDescription('realism', sliders.realism)}\n`;
            actionContext += `🗣️ Język: ${sliders.language}/10 ${getSliderDescription('language', sliders.language)}\n`;
            actionContext += `🧠 Psychologia: ${sliders.psychological}/10 ${getSliderDescription('psychological', sliders.psychological)}\n`;
        }
        
        actionContext += `\n\nINSTRUKCJE DLA NARRATORA:
- Opisz SZCZEGÓŁOWO co się dzieje w tej scenie
- POKAŻ konkretne działania postaci, nie ogólniki
- UWZGLĘDNIJ reakcje NPC w czasie rzeczywistym (jęki, słowa, ruchy)
- Imię NPC jest wiedzą osobistą gracza. Dopóki NPC nie przedstawi się po pytaniu o imię, używaj wyłącznie opisu lub roli, nigdy jego prawdziwego imienia.
- Jeśli gracz pyta NPC o imię, odpowiedź musi jasno zawierać imię tylko wtedy, gdy NPC rzeczywiście decyduje się je podać.
- Nie zmieniaj lokacji, pozycji ani dostępnych przejść w samym opisie. Traktuj komunikat „stan świata nie został zmieniony” dosłownie.
${world.isSandbox
    ? '- TRYB SANDBOX: gracz może wybrać dowolny kierunek i miejsce; jeśli podróż została zaakceptowana mechanicznie, opisz odkrywanie nowej lokacji.'
    : '- Jeśli gracz podał cel podróży, którego nie ma na liście lokacji lub nie ma go w bezpośrednich przejściach, nie kieruj go do młyna ani żadnego innego miejsca zastępczego.'}
- NIE używaj szablonowych zakończeń typu "Czy ta decyzja..."
- NIE pisz o przyszłych konsekwencjach - opisuj TYLKO teraz`;
        
        if (wantsDetailed) {
            actionContext += `\n- ⚠️ GRACZ CHCE SZCZEGÓŁOWEGO OPISU - NAPISZ DŁUGI, ROZBUDOWANY TEKST (min. 5-8 zdań) z detalami, opisami zmysłowymi, dialogiem!`;
        } else {
            actionContext += `\n- 2-4 zdania konkretnego opisu, potem KONIEC`;
        }

        // Emit to all players in room that action is processing
        io.to(player.roomId).emit('actionStarted', {
            playerId: playerData.id,
            playerName: playerData.name,
            action: action.substring(0, 50)
        });

        // Call LLM with player's API key and model (użyj modelu z akcji lub fallback do characterData)
        const playerApiKey = playerData.characterData?.apiKey || '';
        const playerModel = actionModel || playerData.characterData?.model || 'openai/gpt-3.5-turbo';
        console.log(`Using model: ${playerModel} for player: ${playerData.name}`);
        
        const sharedNarratorHistory = room.actionHistory.flatMap(turn => ([
            { role: 'user', content: `[${turn.playerName}] ${turn.action}` },
            { role: 'assistant', content: turn.response }
        ]));
        const rawResponse = await callLLM(
            actionContext,
            playerData.name,
            playerApiKey,
            playerModel,
            sharedNarratorHistory.length > 0 ? sharedNarratorHistory : trimNarratorHistory(playerHistory),
            wantsDetailed
        );
        const parsedNarration = extractScenarioChoiceMarkers(rawResponse);
        const response = parsedNarration.text;
        applyScenarioChoices(world, parsedNarration.choices);
        if (typeof world.revealNpcNamesFromDialogue === 'function') {
            world.revealNpcNamesFromDialogue(action, response, currentPlayer);
        }

        // Zapisz akcję gracza i odpowiedź AI do jego osobistej historii (maks. 100 wpisów)
        playerHistory.push({ role: 'user', content: action });
        playerHistory.push({ role: 'assistant', content: response });
        room.playerHistories[playerData.id] = playerHistory.slice(-100);
        room.actionHistory.push({
            id: `${room.id}:${playerData.id}:${Date.now()}`,
            playerId: playerData.id,
            playerName: playerData.name,
            action: boundedText(action, 2000),
            response: boundedText(response, 12000),
            locationId: currentPlayer.locationId,
            timestamp: Date.now()
        });
        if (room.actionHistory.length > 120) room.actionHistory = room.actionHistory.slice(-120);
        // Starsze wpisy pozostają w zapisach gry, ale nie są wysyłane do kolejnego promptu.

        // Phase 1-2: Przesuwamy czas i przetwarzamy wydarzenia

        // Phase 4: Zapisujemy akcję do pamięci kontekstowej
        if (world.recordPlayerAction) {
            world.recordPlayerAction('player_action', {
                description: action.substring(0, 100),
                scope: 'local'
            });
        }

        const participantIds = new Set([
            playerData.id,
            ...Array.from(room.players.values()).map(roomPlayer => roomPlayer.id)
        ]);
        for (const entityId of narrativeEntityIds) {
            if (entityId && entityId !== currentPlayer.locationId) participantIds.add(entityId);
        }
        const narrativeTurn = world.recordNarrativeTurn({
            id: `${room.id}:${playerData.id}:${Date.now()}`,
            actorId: playerData.id,
            userText: action,
            narratorText: response,
            locationId: currentPlayer.locationId,
            participantIds: Array.from(participantIds),
            gameTime: world.currentTimeMinutes
        });
        if (narrativeTurn?.recorded && world.narrativeMemory?.shouldConsolidate()) {
            scheduleNarrativeConsolidation(room, playerData, playerModel, playerApiKey);
        }

        // Each client receives the shared world with its own player snapshot.
        for (const [socketId, roomPlayer] of room.players.entries()) {
            io.to(socketId).emit('actionResult', {
                playerId: playerData.id,
                playerName: playerData.name,
                action,
                response,
                mechanics: mechanicalResult?.toJSON ? mechanicalResult.toJSON() : mechanicalResult,
                worldState: serializeWorld(world, roomPlayer.player, roomPlayer.id)
            });
        }
        room.lastActiveAt = Date.now();
        persistRooms();
    }

    // Handle chat message
    socket.on('chatMessage', (data) => {
        const message = typeof data?.message === 'string' ? data.message.trim() : '';
        const player = players.get(socket.id);
        
        if (!player || !rooms.has(player.roomId) || !message || message.length > 1000) return;

        const room = rooms.get(player.roomId);
        const playerData = room.players.get(socket.id);

        io.to(player.roomId).emit('chatMessage', {
            playerId: playerData.id,
            playerName: playerData.name,
            message,
            timestamp: Date.now()
        });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        const player = players.get(socket.id);
        
        if (player && rooms.has(player.roomId)) {
            const room = rooms.get(player.roomId);
            const playerData = room.players.get(socket.id);
            const roomId = player.roomId;
            const playerName = player.playerName;
            const playerId = player.playerId;
            const wasHost = room.hostId === socket.id;
            const characterData = playerData?.characterData;

            if (playerData?.player) {
                room.savedPlayers.set(playerId, playerData.player.toJSON());
                room.savedPlayerOwners.set(playerId, player.authUserId || playerData.authUserId || socket.authUser?.id || null);
                rejoinSessions.set(`${roomId}:${playerId}`, {
                    roomId,
                    playerId,
                    authUserId: player.authUserId || playerData.authUserId || socket.authUser?.id || null,
                    playerName,
                    characterData: characterData || {},
                    player: playerData.player.toJSON(),
                    isHost: wasHost,
                    expiresAt: Date.now() + 60000
                });
            }

            // Remove active socket while preserving the player's saved state.
            room.players.delete(socket.id);
            markLobbyDisconnected(room, playerId);
            room.lastActiveAt = Date.now();

            // Notify others
            io.to(roomId).emit('playerLeft', {
                playerId: player.playerId,
                playerName: player.playerName,
                players: Array.from(room.players.values()).map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost
                }))
            });

            // Keep empty rooms persisted so players can reconnect and continue later.
            if (wasHost && room.players.size > 0) {
                // Transfer host to next player
                const newHost = room.players.keys().next().value;
                room.hostId = newHost;
                room.hostPlayerId = room.players.get(newHost).id;
                room.players.get(newHost).isHost = true;
                
                io.to(roomId).emit('hostChanged', {
                    newHostId: room.players.get(newHost).id,
                    newHostName: room.players.get(newHost).name
                });
            } else {
                room.hostId = null;
            }

            emitLobbyUpdate(room);
            persistRooms();

            console.log(`${playerName} left room ${roomId}`);
            
            // Store reconnection data for 60 seconds
            const rejoinData = {
                roomId,
                playerId,
                playerName,
                characterData,
                isHost: wasHost,
                expiresAt: Date.now() + 60000
            };
            socket.rejoinData = rejoinData;
            
            // Tell client to reconnect
            socket.emit('connectionLost', {
                roomId,
                message: 'Połączenie zostało przerwane. Spróbuj ponownie dołączyć do pokoju.'
            });
        }

        players.delete(socket.id);
        actionRateLimits.delete(socket.id);
        if (socket.authUser) {
            const sockets = accountSockets.get(socket.authUser.id);
            sockets?.delete(socket.id);
            if (sockets && sockets.size === 0) accountSockets.delete(socket.authUser.id);
            emitAccountEvent(socket.authUser.id, 'accountPresence', { userId: socket.authUser.id, online: accountSockets.has(socket.authUser.id) });
        }
        console.log(`Player disconnected: ${socket.id}`);
    });

    // Rejoin room after reconnect
    socket.on('legacyRejoinRoom', (data) => {
        if (!socket.authUser) {
            socket.emit('joinError', { message: 'Zaloguj się ponownie, aby wrócić do pokoju.' });
            return;
        }
        const { roomId } = data;
        
        // Sprawdź czy są dane do ponownego dołączenia
        if (!socket.rejoinData || socket.rejoinData.roomId !== roomId) {
            socket.emit('joinError', { message: 'Nie można ponownie dołączyć - dane wygasły. Dołącz ponownie ręcznie.' });
            return;
        }
        
        if (socket.rejoinData.expiresAt < Date.now()) {
            socket.emit('joinError', { message: 'Czas na ponowne dołączenie wygasł. Dołącz ponownie ręcznie.' });
            delete socket.rejoinData;
            return;
        }
        
        if (!rooms.has(roomId)) {
            socket.emit('joinError', { message: 'Pokój już nie istnieje.' });
            delete socket.rejoinData;
            return;
        }
        
        const room = rooms.get(roomId);
        const rejoinData = socket.rejoinData;
        if (rejoinData.authUserId && rejoinData.authUserId !== socket.authUser.id) {
            socket.emit('joinError', { message: 'Ta sesja należy do innego konta.' });
            return;
        }
        const savedPlayer = room.savedPlayers.get(rejoinData.playerId) || rejoinData.player;
        const restoredPlayer = savedPlayer ? Player.fromJSON(savedPlayer) : new Player(rejoinData.playerName, room.world?.player?.locationId || 'town_central');
        room.savedPlayers.delete(rejoinData.playerId);
        room.savedPlayerOwners.delete(rejoinData.playerId);
        if (!room.hostId || !room.players.has(room.hostId) || room.hostPlayerId === rejoinData.playerId) {
            room.hostId = socket.id;
            room.hostPlayerId = rejoinData.playerId;
        }
        
        // Dodaj gracza z powrotem do pokoju
        room.players.set(socket.id, {
            id: rejoinData.playerId,
            socketId: socket.id,
            authUserId: socket.authUser.id,
            name: rejoinData.playerName,
            characterData: rejoinData.characterData,
            player: restoredPlayer,
            joinedAt: Date.now(),
            isHost: room.hostId === socket.id
        });
        registerLobbyParticipant(room, rejoinData.playerId, rejoinData.playerName, rejoinData.characterData);
        
        // Zaktualizuj hosta jeśli trzeba
        // Join socket room
        socket.join(roomId);
        socket.roomId = roomId;
        
        // Zaktualizuj players map
        players.set(socket.id, {
            roomId,
            playerId: rejoinData.playerId,
            playerName: rejoinData.playerName,
            authUserId: socket.authUser.id,
            characterData: rejoinData.characterData || {}
        });
        
        // Wyślij potwierdzenie
        socket.emit('roomRejoined', {
            success: true,
            roomId,
            playerId: rejoinData.playerId,
            playerName: rejoinData.playerName,
            isHost: room.hostId === socket.id,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            })),
            lobby: lobbySnapshot(room),
            timeline: room.actionHistory.slice(-60),
            chatHistory: room.chatHistory.slice(-50),
            worldState: serializeWorld(room.world, restoredPlayer, rejoinData.playerId)
        });
        if (room.lobby.status === 'started') {
            emitGameStarted(socket.id, room, room.players.get(socket.id));
        }
        
        // Powiadom innych
        socket.to(roomId).emit('playerRejoined', {
            playerId: rejoinData.playerId,
            playerName: rejoinData.playerName,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            }))
        });
        
        console.log(`${rejoinData.playerName} reconnected to room ${roomId}`);
        emitLobbyUpdate(room);
        persistRooms();
        delete socket.rejoinData;
    });

    // Rejoin using the persisted session key, since a new socket cannot carry old socket properties.
    socket.on('rejoinRoom', (data) => {
        if (!socket.authUser) {
            socket.emit('joinError', { message: 'Zaloguj się ponownie, aby wrócić do pokoju.' });
            return;
        }
        const roomId = String(data?.roomId || '').trim();
        const playerId = String(data?.playerId || '').trim();
        const key = `${roomId}:${playerId}`;
        const rejoinData = rejoinSessions.get(key);
        if (!roomId || !playerId || !rejoinData || rejoinData.expiresAt < Date.now() || !rooms.has(roomId)) {
            rejoinSessions.delete(key);
            socket.emit('joinError', { message: 'Nie można ponownie dołączyć — sesja wygasła albo pokój nie istnieje.' });
            return;
        }

        const room = rooms.get(roomId);
        if (rejoinData.authUserId && rejoinData.authUserId !== socket.authUser.id) {
            socket.emit('joinError', { message: 'Ta sesja należy do innego konta.' });
            return;
        }
        const savedPlayer = room.savedPlayers.get(playerId) || rejoinData.player;
        const restoredPlayer = Player.fromJSON(savedPlayer);
        room.savedPlayers.delete(playerId);
        room.savedPlayerOwners.delete(playerId);
        if (!room.hostId || !room.players.has(room.hostId)) {
            room.hostId = socket.id;
            room.hostPlayerId = playerId;
        }
        room.players.set(socket.id, {
            id: playerId,
            socketId: socket.id,
            authUserId: socket.authUser.id,
            name: rejoinData.playerName,
            characterData: rejoinData.characterData || {},
            player: restoredPlayer,
            joinedAt: Date.now(),
            isHost: room.hostId === socket.id
        });
        registerLobbyParticipant(room, playerId, rejoinData.playerName, rejoinData.characterData || {});
        room.lastActiveAt = Date.now();
        socket.join(roomId);
        socket.roomId = roomId;
        players.set(socket.id, {
            roomId,
            playerId,
            playerName: rejoinData.playerName,
            authUserId: socket.authUser.id,
            characterData: rejoinData.characterData || {}
        });

        const playerList = Array.from(room.players.values()).map(p => ({ id: p.id, name: p.name, isHost: p.isHost }));
        socket.emit('roomRejoined', {
            success: true,
            roomId,
            playerId,
            playerName: rejoinData.playerName,
            isHost: room.hostId === socket.id,
            players: playerList,
            lobby: lobbySnapshot(room),
            timeline: room.actionHistory.slice(-60),
            chatHistory: room.chatHistory.slice(-50),
            worldState: serializeWorld(room.world, restoredPlayer, playerId)
        });
        if (room.lobby.status === 'started') {
            emitGameStarted(socket.id, room, room.players.get(socket.id));
        }
        socket.to(roomId).emit('playerRejoined', {
            playerId,
            playerName: rejoinData.playerName,
            players: playerList
        });
        rejoinSessions.delete(key);
        persistRooms();
        emitLobbyUpdate(room);
        console.log(`${rejoinData.playerName} reconnected to room ${roomId}`);
    });

    // Player-to-player chat (AI sees but doesn't respond)
    socket.on('playerChat', (data) => {
        try {
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const type = typeof data?.type === 'string' ? data.type.slice(0, 32) : 'player_dialogue';
            const player = players.get(socket.id);
            
            if (!player || !rooms.has(player.roomId) || !message || message.length > 1000) {
                socket.emit('chatError', { message: 'Not in a room' });
                return;
            }

            const room = rooms.get(player.roomId);
            const playerData = room.players.get(socket.id);

            console.log(`playerChat: socket.id=${socket.id}, playerData.id=${playerData.id}, playerData.name=${playerData.name}`);

            // Zapisz wiadomość w historii czatu pokoju (dla kontekstu AI)
            if (!room.chatHistory) room.chatHistory = [];
            room.chatHistory.push({
                playerName: playerData.name,
                message: message,
                type: type || 'player_dialogue',
                timestamp: Date.now()
            });
            // Ogranicz historię do ostatnich 50 wiadomości
            if (room.chatHistory.length > 50) {
                room.chatHistory = room.chatHistory.slice(-50);
            }

            const mentionedNpcIds = typeof room.world?.getKnownNpcIdsMentionedInText === 'function'
                ? room.world.getKnownNpcIdsMentionedInText(message, playerData.player)
                : [];
            // A player-to-player message is visible to every other player in
            // the room. Share only names the sender already knows, and send a
            // viewer-specific world snapshot to recipients whose knowledge changed.
            for (const [recipientSocketId, recipientData] of room.players.entries()) {
                if (recipientSocketId === socket.id) continue;
                let knowledgeChanged = false;
                for (const npcId of mentionedNpcIds) {
                    if (recipientData.player?.revealNpcName?.(npcId)) knowledgeChanged = true;
                }
                const payload = {
                    playerId: playerData.id,
                    playerName: playerData.name,
                    message: message,
                    type: type || 'player_dialogue',
                    timestamp: Date.now()
                };
                if (knowledgeChanged) {
                    payload.worldState = serializeWorld(room.world, recipientData.player, recipientData.id);
                }
                io.to(recipientSocketId).emit('playerChatMessage', payload);
            }

            console.log(`Player chat from ${playerData.name}: ${message.substring(0, 50)}`); 
        } catch (err) {
            console.error('Error in playerChat:', err);
        }
    });

    // Actions autosave the room, but a visible checkpoint is useful before a
    // group closes the browser or changes devices.
    socket.on('saveRoom', () => {
        const player = players.get(socket.id);
        if (!player || !rooms.has(player.roomId)) {
            socket.emit('roomSaveError', { message: 'Nie jesteś w pokoju.' });
            return;
        }
        const room = rooms.get(player.roomId);
        try {
            room.lastActiveAt = Date.now();
            persistRooms();
            socket.emit('roomSaved', {
                roomId: room.id,
                timestamp: new Date().toISOString(),
                memoryStatus: typeof room.world?.getNarrativeMemoryStatus === 'function'
                    ? room.world.getNarrativeMemoryStatus()
                    : null
            });
        } catch (error) {
            socket.emit('roomSaveError', { message: 'Nie udało się zapisać sesji.' });
        }
    });

    // Get room state
    socket.on('getRoomState', () => {
        const player = players.get(socket.id);
        
        if (!player || !rooms.has(player.roomId)) {
            socket.emit('roomState', { error: 'Not in a room' });
            return;
        }

        const room = rooms.get(player.roomId);
        socket.emit('roomState', {
            roomId: room.id,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            })),
            timeline: room.actionHistory.slice(-60),
            chatHistory: room.chatHistory.slice(-50),
            worldState: serializeWorld(room.world, room.players.get(socket.id)?.player, player.playerId)
        });
    });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Serialize world state for client
 */
function serializeWorld(world, viewerPlayer = null, viewerPlayerId = null) {
    if (!world) return null;
    const stableViewerId = viewerPlayerId || viewerPlayer?.id || null;
    const snapshot = typeof world.toViewerJSON === 'function'
        ? world.toViewerJSON(stableViewerId)
        : world.toJSON();
    if (viewerPlayer && typeof viewerPlayer.toJSON === 'function') {
        snapshot.player = viewerPlayer.toJSON();
    }
    if (typeof world.getNarrativeMemoryStatus === 'function') {
        snapshot.memoryStatus = world.getNarrativeMemoryStatus();
    }
    // Scenario director material is server-only. Never trust a future engine
    // serializer (or the legacy fallback) to expose it to clients.
    if (snapshot && typeof snapshot === 'object') {
        const knownNpcIds = new Set(Array.isArray(snapshot.player?.knownNpcIds)
            ? snapshot.player.knownNpcIds
            : []);
        const unknownOrdinals = new Map();
        if (Array.isArray(snapshot.npcs)) {
            snapshot.npcs = snapshot.npcs.map(npc => {
                if (!npc || knownNpcIds.has(npc.id)) return npc;
                const locationKey = String(npc.locationId || 'unknown');
                const previous = unknownOrdinals.get(locationKey) || 0;
                unknownOrdinals.set(locationKey, previous + 1);
                return {
                    ...npc,
                    name: `Nieznana postać${previous > 0 ? ` #${previous + 1}` : ''}`
                };
            });
        }
        delete snapshot.scenario;
        delete snapshot.scenarioState;
        if (snapshot.worldMetadata && typeof snapshot.worldMetadata === 'object') {
            // `plan` may contain the complete scenario JSON, including
            // director-only secrets. Rebuild this object instead of deleting
            // known sensitive keys so future metadata fields cannot leak.
            snapshot.worldMetadata = {
                name: snapshot.worldMetadata.name || null,
                description: snapshot.worldMetadata.description || null,
                scenario: (() => {
                    const campaign = publicCampaignSnapshot(world)?.scenario;
                    if (!campaign) return null;
                    return {
                        ...campaign,
                        activeAct: typeof world.scenarioState?.activeAct === 'string' ? world.scenarioState.activeAct : null
                    };
                })()
            };
        }
    }
    return snapshot;
}

/**
 * Call OpenRouter API for LLM response
 * Each player uses their own API key
 */
const NARRATOR_CONTEXT_LIMITS = Object.freeze({
    maxMessages: 20,
    maxChars: 18000,
    totalPromptChars: 30000,
    maxActionContextChars: 14000,
    maxSystemChars: 6000
});

function trimPreserveEnds(value, maxChars) {
    const text = String(value || '');
    if (text.length <= maxChars) return text;
    if (maxChars < 80) return text.slice(0, maxChars);
    const marker = '\n...[prompt shortened]...\n';
    const available = maxChars - marker.length;
    const head = Math.ceil(available * 0.58);
    const tail = available - head;
    return `${text.slice(0, head)}${marker}${text.slice(-tail)}`;
}

function trimNarratorHistory(history, maxChars = NARRATOR_CONTEXT_LIMITS.maxChars) {
    if (maxChars <= 0) return [];
    const source = Array.isArray(history) ? history : [];
    const recent = [];
    let chars = 0;
    for (let index = source.length - 1; index >= 0 && recent.length < NARRATOR_CONTEXT_LIMITS.maxMessages; index -= 1) {
        const message = source[index];
        const content = String(message?.content || '');
        const nextChars = chars + content.length;
        if (recent.length > 0 && nextChars > maxChars) break;
        const remaining = Math.max(0, maxChars - chars);
        recent.unshift({ role: message?.role === 'assistant' ? 'assistant' : 'user', content: content.slice(0, remaining) });
        chars += Math.min(content.length, remaining);
    }
    return recent;
}

function parseNarrativeMemoryPatch(rawText) {
    const source = boundedText(rawText, 30000);
    const withoutFence = source.replace(/```json/gi, '').replace(/```/g, '').trim();
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Memory extractor did not return a JSON object');
    const parsed = JSON.parse(withoutFence.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') throw new Error('Memory extractor returned invalid JSON');
    return parsed;
}

function formatNarrativeContext(context, maxChars = 10000) {
    if (!context || typeof context !== 'object') return '';
    const lines = [];
    const append = (prefix, item) => {
        let value;
        try {
            value = typeof item === 'string' ? item : JSON.stringify(item);
        } catch (error) {
            value = '';
        }
        if (value) lines.push(`${prefix} ${value}`);
    };
    const publicOnly = item => item && item.directorOnly !== true
        && (!Array.isArray(item.knownBy) || item.knownBy.length === 0 || item.knownBy.includes('public'));
    for (const fact of (Array.isArray(context.facts) ? context.facts : []).filter(publicOnly)) append('[FACT]', fact);
    for (const episode of (Array.isArray(context.episodes) ? context.episodes : []).filter(publicOnly)) append('[EPISODE]', episode);
    for (const thread of (Array.isArray(context.threads) ? context.threads : []).filter(publicOnly)) append('[THREAD]', thread);
    let output = '';
    for (const line of lines) {
        if (output.length + line.length + 1 > maxChars) break;
        output += `${line}\n`;
    }
    return output.trim();
}

const MEMORY_PATCH_SCHEMA_PROMPT = `{
  "version": 1,
  "facts": [{
    "kind": "appearance|relationship|promise|knowledge|event|location_detail|rumor|secret",
    "subject": {"type": "player|npc|location|faction|quest", "id": "..."},
    "predicate": "...",
    "value": "any JSON value",
    "canonicalKey": "optional stable key",
    "certainty": "confirmed|claimed|rumor|false",
    "importance": 0.0,
    "tags": [],
    "relatedIds": [],
    "locationId": null,
    "knownBy": ["public"] or ["actorId"],
    "directorOnly": false,
    "source": {"turnId": "...", "speakerId": "...", "kind": "...", "gameTime": 0}
  }],
  "retractions": [{"canonicalKey": "..."}],
  "episode": {
    "title": "...",
    "summary": "...",
    "turnIds": ["every exact input turn id, no omissions or additions"],
    "importance": 0.0,
    "tags": [],
    "entityIds": [],
    "locationId": null,
    "knownBy": ["public"] or ["actorId"],
    "directorOnly": false
  },
  "threads": [{
    "id": "...",
    "title": "...",
    "status": "active|resolved|abandoned",
    "summary": "...",
    "importance": 0.0,
    "entityIds": [],
    "locationId": null,
    "knownBy": ["public"] or ["actorId"],
    "directorOnly": false
  }]
}`;

function getConsolidationTurnIds(input) {
    const turns = Array.isArray(input?.turns)
        ? input.turns
        : (Array.isArray(input?.pendingTurns) ? input.pendingTurns : []);
    return turns
        .map(turn => turn?.id || turn?.turnId)
        .filter(id => typeof id === 'string' && id.length > 0);
}

function hasExactConsolidationEpisode(patch, requiredTurnIds) {
    const actual = Array.isArray(patch?.episode?.turnIds) ? patch.episode.turnIds : [];
    return actual.length === requiredTurnIds.length && actual.every((id, index) => id === requiredTurnIds[index]);
}

async function callNarrativeMemoryExtractor(input, apiKey, model) {
    if (!apiKey) throw new Error('No API key configured for narrative memory extraction');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://gierkaboza-production.up.railway.app',
                'X-Title': 'AI RPG Narrative Memory'
            },
            signal: controller.signal,
            body: JSON.stringify({
                model: model || 'openai/gpt-3.5-turbo',
                temperature: 0.1,
                max_tokens: 1800,
                messages: [
                    {
                        role: 'system',
                        content: `You are a narrative memory extractor. Return one JSON object only, matching this exact accepted patch schema:\n${MEMORY_PATCH_SCHEMA_PROMPT}\n\nRules:\n- Always return an episode, even when there are no new facts. Its turnIds MUST equal the exact requiredEpisodeTurnIds supplied in the input, in the same order.\n- Use knownBy ["public"] for public observations. Use knownBy [actorId] for private player facts. Use directorOnly true for GM secrets. Apply the same visibility fields to episode and thread objects when they are accepted by the schema.\n- Never write mechanical state: hp, maxHp, gold, inventory, xp, level, stats, quest status/rewards, NPC alive/dead or combat mechanics.\n- Do not invent facts. Keep facts concise and use source.turnId from the input.`
                    },
                    {
                        role: 'user',
                        content: JSON.stringify({
                            contract: {
                                version: 1,
                                factKinds: ['appearance', 'relationship', 'promise', 'knowledge', 'event', 'location_detail', 'rumor', 'secret'],
                                certainties: ['confirmed', 'claimed', 'rumor', 'false'],
                                requiredEpisodeTurnIds: getConsolidationTurnIds(input)
                            },
                            input
                        })
                    }
                ]
            })
        });
        if (!response.ok) throw new Error(`Memory extractor API error: ${response.status}`);
        const data = await response.json();
        return parseNarrativeMemoryPatch(data?.choices?.[0]?.message?.content || '');
    } finally {
        clearTimeout(timeout);
    }
}

function scheduleNarrativeConsolidation(room, playerData, model, apiKey) {
    if (!room || room.narrativeConsolidationPromise || Date.now() < room.narrativeConsolidationNextAttemptAt || !room.world?.narrativeMemory?.shouldConsolidate()) return;
    const world = room.world;
    const input = world.buildMemoryConsolidationInput();
    room.narrativeConsolidationPromise = (async () => {
        try {
            const patch = await callNarrativeMemoryExtractor({ ...input, actorId: playerData.id }, apiKey, model);
            const requiredTurnIds = getConsolidationTurnIds(input);
            if (!hasExactConsolidationEpisode(patch, requiredTurnIds)) {
                throw new Error('Memory patch must contain one episode with the exact input turn ids');
            }
            const result = world.applyNarrativeMemoryPatch(patch);
            if (!result?.success) {
                room.narrativeConsolidationNextAttemptAt = Date.now() + 30000;
                console.warn('Narrative memory patch rejected:', result?.error || 'unknown error');
                return;
            }
            room.narrativeConsolidationNextAttemptAt = 0;
            room.lastActiveAt = Date.now();
            persistRooms();
        } catch (error) {
            // Keep pending turns when extraction, parsing or validation fails.
            room.narrativeConsolidationNextAttemptAt = Date.now() + 30000;
            console.warn('Narrative memory consolidation skipped:', error.message);
        } finally {
            room.narrativeConsolidationPromise = null;
        }
    })();
}

async function callLLM(context, playerName, apiKey, model = 'openai/gpt-3.5-turbo', narratorHistory = [], wantsDetailed = false) {
    if (!apiKey) {
        return `${playerName} wykonuje akcję... (brak klucza API - dodaj swój klucz OpenRouter)`;
    }
    
    try {
        // Buduj messages z historią narracji żeby bot pamiętał poprzednie tury
        // UWAGA: narratorHistory zawiera pary user/assistant - bierzemy ostatnie 10 tur (20 wiadomości)
        const systemMessage = {
            role: 'system',
            content: `Jesteś narratorem w grze RPG. Opisuj akcje gracza i ich konsekwencje.

ZAKAZANE SFORMUŁOWANIA (NIGDY ich nie używaj):
- ❌ "Czy ta decyzja..."
- ❌ "Odpowiedź wkrótce się wyjaśni"
- ❌ "Konsekwencje mogą być poważne"
- ❌ "Sytuacja staje się napięta"
- ❌ "Coś może się wkrótce wydarzyć"
- ❌ Powtarzanie tych samych zwrotów w każdej odpowiedzi

JAK PISAĆ (ZAWSZE stosuj):
- ✅ Opisuj TYLKO to co się DZIEJE TERAZ
- ✅ Używaj zmysłowych szczegółów (dźwięki, zapachy, tekstury)
- ✅ Pokazuj reakcje NPC konkretnie, nie ogólnikowo
- ✅ Nawiązuj do poprzednich akcji w tej sesji
- ✅ Bądź bezpośredni - nie zadawaj pytań retorycznych


Postać nazywa się ${playerName}. Odpowiadaj po polsku.`
        };
        // Obrabiamy tylko ostatnie wiadomości z historii; pełna pamięć nie trafia do promptu.
        systemMessage.content += '\n\nSECURITY: The response is broadcast to every player in the room. Never reveal, imply, or invent actor-private facts, facts hidden from the public, or GM/director secrets. Use only public memory facts present in this prompt.';
        systemMessage.content += ' The scenario director brief is internal guidance only: never reveal its secrets directly or as narrator knowledge; reveal them only through player-discoverable events.';
        systemMessage.content += ' The mechanics section in the user prompt is authoritative. Never invent a successful travel or relocate a character when the mechanics say that the world state did not change.';
        systemMessage.content += ' NPC names are personal knowledge: do not reveal an NPC\'s canonical name until the player explicitly asks for it and the NPC gives it in dialogue. Use a role or physical description before that.';
        systemMessage.content += ' If the player action clearly resolves one listed scenario choice, append exactly one marker at the very end in this exact format: [[SCENARIO_CHOICE:{"choiceId":"...","optionId":"..."}]]. Otherwise append no marker. Never explain or reveal the marker.';

        // Bound the complete prompt, not only individual history sections.
        const systemContent = trimPreserveEnds(systemMessage.content, NARRATOR_CONTEXT_LIMITS.maxSystemChars);
        const actionContext = trimPreserveEnds(context, NARRATOR_CONTEXT_LIMITS.maxActionContextChars);
        const historyBudget = Math.max(
            0,
            NARRATOR_CONTEXT_LIMITS.totalPromptChars - systemContent.length - actionContext.length
        );
        const messages = [
            { role: 'system', content: systemContent },
            ...trimNarratorHistory(narratorHistory, historyBudget),
            { role: 'user', content: actionContext }
        ];

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://gierkaboza-production.up.railway.app',
                'X-Title': 'AI RPG Multiplayer'
            },
            body: JSON.stringify({
                model: model,
                messages,
                temperature: 0.8,
                max_tokens: wantsDetailed ? 1200 : 800
            })
        });
        
        if (!response.ok) {
            throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.choices[0].message.content;
    } catch (error) {
        console.error('LLM error:', error);
        return `${playerName} wykonuje akcję, ale narrator ma problemy techniczne...`;
    }
}

// ============================================================================
// CONTENT SLIDER HELPER
// ============================================================================

/**
 * Get description for slider value based on type
 */
function getSliderDescription(type, value) {
    const descriptions = {
        violence: {
            low: '(opisowa, bez szczegółów)',
            mid: '(realistyczna, widoczne obrażenia)',
            high: '(ekstremalna, szczegółowe rany, krew)'
        },
        sexual: {
            low: '(wulg. tylko sugestie)',
            mid: '(szczegółowe opisy)',
            high: '(ekstremalne, szczegółowe akty)'
        },
        darkness: {
            low: '(lekki klimat)',
            mid: '(ponury, niebezpieczny)',
            high: '(beznadziejny, koszmary)'
        },
        realism: {
            low: '(heroiczny, szczęście)',
            mid: '(realistyczne konsekwencje)',
            high: '(brutalny, śmierć)'
        },
        language: {
            low: '(czysty)',
            mid: '(okazjonalne wulgaryzmy)',
            high: '(brutalny, ciągłe)'
        },
        psychological: {
            low: '(prosta)',
            mid: '(złożona, motywacje)',
            high: '(pokrętna, trauma)'
        }
    };
    
    const d = descriptions[type];
    if (!d) return '';
    
    if (value <= 3) return d.low;
    if (value <= 7) return d.mid;
    return d.high;
}

// ============================================================================
// API ROUTES
// ============================================================================

// Get list of active rooms
app.get('/api/rooms', (req, res) => {
    const roomList = Array.from(rooms.values()).map(room => ({
        id: room.id,
        playerCount: room.players.size,
        createdAt: room.createdAt,
        hostName: room.players.size > 0 
            ? Array.from(room.players.values())[0]?.name 
            : 'Unknown'
    }));
    res.json(roomList);
});

// Get public campaign/scenario catalog. Hidden director notes and secrets never leave the server.
app.get('/api/scenarios', (req, res) => {
    res.json(Array.from(scenarioCatalog.values())
        .map(publicScenarioSummary)
        .sort((a, b) => a.title.localeCompare(b.title, 'pl')));
});

// ============================================================================
// ACCOUNT, FRIENDS AND GAME INVITES
// ============================================================================

app.post('/api/auth/login', (req, res) => {
    const username = safeAuthText(req.body?.username, 80).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const attemptKey = `${req.ip || 'unknown'}:${username}`;
    const now = Date.now();
    const attempts = authLoginAttempts.get(attemptKey);
    if (attempts && now - attempts.startedAt < 15 * 60 * 1000 && attempts.count >= 10) {
        return res.status(429).json({ error: 'login_rate_limited', message: 'Za dużo nieudanych prób. Spróbuj ponownie za kilka minut.' });
    }
    const user = findUserByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
        if (!attempts || now - attempts.startedAt >= 15 * 60 * 1000) {
            authLoginAttempts.set(attemptKey, { startedAt: now, count: 1 });
        } else {
            attempts.count += 1;
        }
        return res.status(401).json({ error: 'invalid_credentials', message: 'Nieprawidłowy login lub hasło.' });
    }
    authLoginAttempts.delete(attemptKey);
    const session = createAuthSession(user.id);
    res.json({ ...accountSnapshot(user.id), token: session.token, expiresAt: session.expiresAt });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
    const header = typeof req.headers.authorization === 'string' ? req.headers.authorization : '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (token) delete authState.sessions[hashSessionToken(token)];
    persistAuthState();
    res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json(accountSnapshot(req.authUser.id));
});

app.get('/api/friends', requireAuth, (req, res) => {
    res.json(accountSnapshot(req.authUser.id));
});

app.post('/api/friends/request', requireAuth, (req, res) => {
    const target = findUserByUsername(req.body?.username);
    if (!target) return res.status(404).json({ error: 'user_not_found', message: 'Nie znaleziono takiego konta.' });
    if (target.id === req.authUser.id) return res.status(400).json({ error: 'self_friend_request', message: 'Nie możesz dodać samego siebie.' });
    const existing = getFriendship(req.authUser.id, target.id);
    if (existing?.status === 'accepted') return res.status(409).json({ error: 'already_friends', message: 'To konto jest już na liście znajomych.' });
    if (existing) return res.status(409).json({ error: 'request_exists', message: 'Zaproszenie do znajomych już istnieje.' });
    const friendship = {
        id: `friendship_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        userA: req.authUser.id,
        userB: target.id,
        status: 'pending',
        requestedBy: req.authUser.id,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    authState.friendships.push(friendship);
    persistAuthState();
    emitAccountEvent(target.id, 'friendRequest', { from: publicUser(req.authUser.id) });
    res.status(201).json(accountSnapshot(req.authUser.id));
});

app.post('/api/friends/:username/accept', requireAuth, (req, res) => {
    const target = findUserByUsername(req.params.username);
    const friendship = target ? getFriendship(req.authUser.id, target.id) : null;
    if (!friendship || friendship.status !== 'pending' || friendship.requestedBy === req.authUser.id) {
        return res.status(404).json({ error: 'friend_request_not_found', message: 'Nie znaleziono przychodzącego zaproszenia.' });
    }
    friendship.status = 'accepted';
    friendship.updatedAt = Date.now();
    persistAuthState();
    emitAccountEvent(target.id, 'friendUpdate', accountSnapshot(target.id));
    res.json(accountSnapshot(req.authUser.id));
});

app.post('/api/friends/:username/reject', requireAuth, (req, res) => {
    const target = findUserByUsername(req.params.username);
    const friendship = target ? getFriendship(req.authUser.id, target.id) : null;
    if (!friendship || friendship.status !== 'pending') {
        return res.status(404).json({ error: 'friend_request_not_found', message: 'Nie znaleziono zaproszenia.' });
    }
    authState.friendships = authState.friendships.filter(item => item.id !== friendship.id);
    persistAuthState();
    emitAccountEvent(target.id, 'friendUpdate', accountSnapshot(target.id));
    res.json(accountSnapshot(req.authUser.id));
});

app.get('/api/invites', requireAuth, (req, res) => {
    res.json(accountSnapshot(req.authUser.id).invites);
});

app.post('/api/invites', requireAuth, (req, res) => {
    const target = findUserByUsername(req.body?.friendUsername || req.body?.username);
    const roomId = safeAuthText(req.body?.roomId, 64);
    const roomName = safeAuthText(req.body?.roomName, 160) || roomId;
    if (!target) return res.status(404).json({ error: 'user_not_found', message: 'Nie znaleziono znajomego.' });
    if (!getFriendship(req.authUser.id, target.id) || getFriendship(req.authUser.id, target.id).status !== 'accepted') {
        return res.status(403).json({ error: 'friend_required', message: 'Możesz zapraszać tylko zaakceptowanych znajomych.' });
    }
    if (!roomId || !rooms.has(roomId)) return res.status(404).json({ error: 'room_not_found', message: 'Najpierw utwórz lub otwórz pokój gry.' });
    const inviterIsInRoom = Array.from(rooms.get(roomId).players.values()).some(player => player.authUserId === req.authUser.id);
    if (!inviterIsInRoom) return res.status(403).json({ error: 'room_access_required', message: 'Nie jesteś aktywnym uczestnikiem tego pokoju.' });
    const duplicate = authState.invites.find(invite => invite.fromUserId === req.authUser.id && invite.toUserId === target.id && invite.roomId === roomId && invite.status === 'pending');
    if (duplicate) return res.status(409).json({ error: 'invite_exists', message: 'To zaproszenie już czeka na odpowiedź.' });
    const invite = {
        id: `invite_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        fromUserId: req.authUser.id,
        toUserId: target.id,
        roomId,
        roomName,
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000
    };
    authState.invites.push(invite);
    persistAuthState();
    emitAccountEvent(target.id, 'gameInvite', publicInvite(invite));
    res.status(201).json(publicInvite(invite));
});

app.post('/api/invites/:inviteId/accept', requireAuth, (req, res) => {
    const invite = authState.invites.find(item => item.id === req.params.inviteId && item.toUserId === req.authUser.id);
    if (!invite || invite.status !== 'pending' || Number(invite.expiresAt) <= Date.now()) {
        return res.status(404).json({ error: 'invite_not_found', message: 'Zaproszenie wygasło albo nie istnieje.' });
    }
    if (!rooms.has(invite.roomId)) {
        return res.status(404).json({ error: 'room_not_found', message: 'Pokój nie jest już dostępny.' });
    }
    invite.status = 'accepted';
    invite.updatedAt = Date.now();
    persistAuthState();
    emitAccountEvent(invite.fromUserId, 'inviteAccepted', publicInvite(invite));
    res.json({ ok: true, roomId: invite.roomId, invite: publicInvite(invite) });
});

app.post('/api/invites/:inviteId/reject', requireAuth, (req, res) => {
    const invite = authState.invites.find(item => item.id === req.params.inviteId && item.toUserId === req.authUser.id);
    if (!invite || invite.status !== 'pending') return res.status(404).json({ error: 'invite_not_found', message: 'Zaproszenie nie istnieje.' });
    invite.status = 'rejected';
    invite.updatedAt = Date.now();
    persistAuthState();
    res.json({ ok: true });
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        rooms: rooms.size, 
        players: players.size,
        uptime: process.uptime()
    });
});

// ============================================================================
// START SERVER
// ============================================================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║          MULTIPLAYER RPG SERVER                           ║
║          =========================                         ║
║                                                           ║
║  Server running on port ${PORT}                            ║
║  WebSocket: Socket.io ready                              ║
║                                                           ║
║  Endpoints:                                              ║
║  - GET  /              - Game UI                         ║
║  - GET  /api/rooms     - List active rooms               ║
║  - GET  /api/scenarios  - List public scenarios           ║
║  - GET  /api/health   - Server health                   ║
║                                                           ║
║  Socket Events:                                          ║
║  - joinRoom           - Join/create room                 ║
║  - playerAction       - Send player action               ║
║  - chatMessage        - Send chat message                ║
║  - getRoomState       - Get current room state           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});

module.exports = { app, server, io };
