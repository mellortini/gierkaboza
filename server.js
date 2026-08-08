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

const app = express();
const server = http.createServer(app);

// Global CORS - must be first
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', process.env.CLIENT_ORIGIN || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
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
const DATA_DIR = path.join(__dirname, 'data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');
const rejoinSessions = new Map();

function createRoom(roomId, world = null, persisted = {}) {
    return {
        id: roomId,
        world,
        players: new Map(),
        savedPlayers: new Map(Object.entries(persisted.savedPlayers || {})),
        createdAt: persisted.createdAt || Date.now(),
        lastActiveAt: persisted.lastActiveAt || Date.now(),
        hostId: null,
        chatHistory: Array.isArray(persisted.chatHistory) ? persisted.chatHistory.slice(-50) : [],
        playerHistories: persisted.playerHistories || {},
        actionQueue: Promise.resolve()
    };
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
            createdAt: room.createdAt,
            lastActiveAt: room.lastActiveAt,
            chatHistory: room.chatHistory.slice(-50),
            playerHistories: Object.fromEntries(
                Object.entries(room.playerHistories || {}).map(([id, history]) => [id, history.slice(-100)])
            )
        }));
        fs.writeFileSync(ROOMS_FILE, JSON.stringify(data, null, 2), 'utf8');
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
            const { roomId: rawRoomId, playerName: rawPlayerName, characterData, worldData, worldOption, playerId: requestedPlayerId } = data || {};
            const roomId = String(rawRoomId || '').trim();
            const playerName = String(rawPlayerName || '').trim();

            console.log(`Join room request: ${roomId}, player: ${playerName}, worldOption: ${worldOption}`);
            
            // Validate data
            if (!roomId || !playerName || roomId.length > 64 || playerName.length > 80) {
                socket.emit('joinError', { message: 'Podaj poprawne ID pokoju i nazwę gracza (maks. 64/80 znaków).' });
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
            if (incomingWorld && worldOption === 'current') {
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
                // Create new world
                room.world = World.createStarterWorld(playerName, 'town_central');
            }
        }

        // Add or restore a player. The world remains shared, while character state is per socket/player.
        const playerId = (requestedPlayerId && room.savedPlayers.has(requestedPlayerId))
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
        if (!room.hostId) room.hostId = socket.id;
        if (!room.world.player) room.world.player = gamePlayer;
        room.players.set(socket.id, {
            id: playerId,
            socketId: socket.id,
            name: playerName,
            characterData: characterData || {},
            player: gamePlayer,
            joinedAt: Date.now(),
            isHost: room.hostId === socket.id
        });

        // Join socket room
        socket.join(roomId);
        socket.roomId = roomId;

        // Store player info
        players.set(socket.id, {
            roomId,
            playerId,
            playerName,
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
            worldState: serializeWorld(room.world, gamePlayer)
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

        room.lastActiveAt = Date.now();
        persistRooms();
        console.log(`${playerName} joined room ${roomId}`);
        } catch (err) {
            console.error('Error in joinRoom:', err);
            socket.emit('joinError', { message: 'Błąd serwera: ' + err.message });
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
        const mechanicsContext = mechanicalResult
            ? `Mechanika: ${mechanicalResult.success ? 'akcja wykonana' : 'brak zmiany stanu'} — ${mechanicalResult.message}. `
            : '';

        // Build action context - be brief, don't describe location every time
        let actionContext = `Jesteś ${playerData.name}. `;
        actionContext += `Akcja: "${action}". `;
        actionContext += mechanicsContext;
        actionContext += `To dzieje się w ${location ? location.name : currentPlayer.locationId}. `;
        actionContext += `Jest ${world.getFormattedTime()}, dzień ${world.getDayNumber()}. `;
        
        if (room.players.size > 1) {
            const others = Array.from(room.players.values())
                .filter(p => p.socketId !== socket.id)
                .map(p => p.name)
                .join(', ');
            actionContext += `Obok ciebie jest: ${others}. `;
        }
        
        // KAŻDY GRACZ MA SWOJĄ HISTORIĘ - nie mieszaj z innymi graczami!
        if (!room.playerHistories) room.playerHistories = {};
        if (!room.playerHistories[socket.id]) room.playerHistories[socket.id] = [];
        const playerHistory = room.playerHistories[socket.id];

        // Dołącz historię czatu graczy do kontekstu AI
        if (room.chatHistory && room.chatHistory.length > 0) {
            const recentChat = room.chatHistory.slice(-10); // ostatnie 10 wiadomości
            actionContext += `\n\n## OSTATNI CZAT MIĘDZY GRACZAMI:\n`;
            for (const msg of recentChat) {
                const tag = msg.type === 'in_character' ? '[IC]' : '[OOC]';
                actionContext += `${tag} ${msg.playerName}: ${msg.message}\n`;
            }
        }
        
        // Dodaj podsumowanie poprzednich akcji TYLKO tego gracza (nie mieszaj z innymi graczami)
        const recentPlayerActions = playerHistory?.filter((_, i) => i % 2 === 0).slice(-4) || []; // tylko akcje tego gracza
        if (recentPlayerActions.length > 0) {
            actionContext += `\n\n## TWOJE POPRZEDNIE AKCJE:\n`;
            for (const h of recentPlayerActions) {
                actionContext += `- ${h.content?.substring(0, 80) || '...'}\n`;
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
        
        const response = await callLLM(actionContext, playerData.name, playerApiKey, playerModel, playerHistory.slice(-40), wantsDetailed);

        // Zapisz akcję gracza i odpowiedź AI do jego osobistej historii (pamięć bota) - BEZ LIMITU
        playerHistory.push({ role: 'user', content: action });
        playerHistory.push({ role: 'assistant', content: response });
        room.playerHistories[socket.id] = playerHistory.slice(-100);
        // Bez limitu - bot pamięta całą historię tego gracza!

        // Phase 1-2: Przesuwamy czas i przetwarzamy wydarzenia

        // Phase 4: Zapisujemy akcję do pamięci kontekstowej
        if (world.recordPlayerAction) {
            world.recordPlayerAction('player_action', {
                description: action.substring(0, 100),
                scope: 'local'
            });
        }

        // Each client receives the shared world with its own player snapshot.
        for (const [socketId, roomPlayer] of room.players.entries()) {
            io.to(socketId).emit('actionResult', {
                playerId: playerData.id,
                playerName: playerData.name,
                action,
                response,
                mechanics: mechanicalResult?.toJSON ? mechanicalResult.toJSON() : mechanicalResult,
                worldState: serializeWorld(world, roomPlayer.player)
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
                rejoinSessions.set(`${roomId}:${playerId}`, {
                    roomId,
                    playerId,
                    playerName,
                    characterData: characterData || {},
                    player: playerData.player.toJSON(),
                    isHost: wasHost,
                    expiresAt: Date.now() + 60000
                });
            }

            // Remove active socket while preserving the player's saved state.
            room.players.delete(socket.id);
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
                room.players.get(newHost).isHost = true;
                
                io.to(roomId).emit('hostChanged', {
                    newHostId: room.players.get(newHost).id,
                    newHostName: room.players.get(newHost).name
                });
            }

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
        console.log(`Player disconnected: ${socket.id}`);
    });

    // Rejoin room after reconnect
    socket.on('legacyRejoinRoom', (data) => {
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
        
        // Dodaj gracza z powrotem do pokoju
        room.players.set(socket.id, {
            id: rejoinData.playerId,
            socketId: socket.id,
            name: rejoinData.playerName,
            characterData: rejoinData.characterData,
            joinedAt: Date.now(),
            isHost: rejoinData.isHost
        });
        
        // Zaktualizuj hosta jeśli trzeba
        if (rejoinData.isHost) {
            room.hostId = socket.id;
        }
        
        // Join socket room
        socket.join(roomId);
        socket.roomId = roomId;
        
        // Zaktualizuj players map
        players.set(socket.id, {
            roomId,
            playerId: rejoinData.playerId,
            playerName: rejoinData.playerName
        });
        
        // Wyślij potwierdzenie
        socket.emit('roomRejoined', {
            success: true,
            roomId,
            playerId: rejoinData.playerId,
            playerName: rejoinData.playerName,
            isHost: rejoinData.isHost,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            }))
        });
        
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
        delete socket.rejoinData;
    });

    // Rejoin using the persisted session key, since a new socket cannot carry old socket properties.
    socket.on('rejoinRoom', (data) => {
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
        const savedPlayer = room.savedPlayers.get(playerId) || rejoinData.player;
        const restoredPlayer = Player.fromJSON(savedPlayer);
        room.savedPlayers.delete(playerId);
        if (!room.hostId) room.hostId = socket.id;
        room.players.set(socket.id, {
            id: playerId,
            socketId: socket.id,
            name: rejoinData.playerName,
            characterData: rejoinData.characterData || {},
            player: restoredPlayer,
            joinedAt: Date.now(),
            isHost: room.hostId === socket.id
        });
        room.lastActiveAt = Date.now();
        socket.join(roomId);
        socket.roomId = roomId;
        players.set(socket.id, {
            roomId,
            playerId,
            playerName: rejoinData.playerName,
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
            worldState: serializeWorld(room.world, restoredPlayer)
        });
        socket.to(roomId).emit('playerRejoined', {
            playerId,
            playerName: rejoinData.playerName,
            players: playerList
        });
        rejoinSessions.delete(key);
        persistRooms();
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

            // Broadcast only to OTHER players in room (sender already added message locally)
            socket.to(player.roomId).emit('playerChatMessage', {
                playerId: playerData.id,
                playerName: playerData.name,
                message: message,
                type: type || 'player_dialogue',
                timestamp: Date.now()
            });

            console.log(`Player chat from ${playerData.name}: ${message.substring(0, 50)}`); 
        } catch (err) {
            console.error('Error in playerChat:', err);
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
            worldState: serializeWorld(room.world, room.players.get(socket.id)?.player)
        });
    });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Serialize world state for client
 */
function serializeWorld(world, viewerPlayer = null) {
    if (!world) return null;
    const snapshot = world.toJSON();
    if (viewerPlayer && typeof viewerPlayer.toJSON === 'function') {
        snapshot.player = viewerPlayer.toJSON();
    }
    return snapshot;
}

/**
 * Call OpenRouter API for LLM response
 * Each player uses their own API key
 */
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
        // Weź ostatnie 25 tur (50 wiadomości) z historii
        // Bierzemy całą historię - bot pamięta wszystko!
        const messages = [systemMessage, ...narratorHistory, { role: 'user', content: context }];

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
