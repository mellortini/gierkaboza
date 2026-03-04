/**
 * Multiplayer RPG Server with Socket.io
 * Handles real-time game synchronization between players
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Global CORS - must be first
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
    res.setHeader('Access-Control-Allow-Credentials', true);
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

app.use(express.json({ limit: '10mb' }));

// Socket.io configuration for Railway
const io = new Server(server, {
    transports: ['polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true,
    perMessageDeflate: false,
    cookie: false,
    serveClient: true
});

// Log all Socket.io errors
io.engine.on('connection_error', (err) => {
    console.log('Connection error:', err.req, err.code, err.message, err.context);
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

// Load game engine at startup
let World = null;
try {
    // Try to load engine.js for server-side world creation
    const engine = require('./engine.js');
    World = engine.World;
    console.log('✅ Game engine loaded successfully');
} catch (err) {
    console.error('❌ Failed to load engine.js:', err.message);
    // We'll create a simple world class if engine fails to load
    World = null;
}

// Simple fallback World class if engine.js fails
class SimpleWorld {
    constructor() {
        this.currentTimeMinutes = 0;
        this.locations = new Map();
        this.factions = new Map();
        this.npcs = new Map();
        this.player = null;
        this.worldLog = [];
    }
    
    advanceWorldTime(minutes) {
        this.currentTimeMinutes += minutes;
    }
    
    getFormattedTime() {
        const hours = Math.floor(this.currentTimeMinutes / 60);
        const minutes = this.currentTimeMinutes % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}`;
    }
    
    getDayNumber() {
        return Math.floor(this.currentTimeMinutes / (24 * 60)) + 1;
    }
    
    getTimeOfDay() {
        const hour = this.currentTimeMinutes % (24 * 60) / 60;
        if (hour >= 6 && hour < 12) return "Morning";
        if (hour >= 12 && hour < 17) return "Afternoon";
        if (hour >= 17 && hour < 21) return "Evening";
        return "Night";
    }
    
    getLocation(id) { return this.locations.get(id); }
    getNPC(id) { return this.npcs.get(id); }
    getFaction(id) { return this.factions.get(id); }
    
    static createStarterWorld(playerName, locationId) {
        const world = new SimpleWorld();
        world.player = {
            name: playerName,
            locationId: locationId,
            hp: 100,
            maxHp: 100,
            gold: 100,
            hunger: 0,
            thirst: 0,
            fatigue: 0
        };
        
        // Add default locations
        world.locations.set('town_central', { id: 'town_central', name: 'Central Town', population: 500, wealth: 60, stability: 70, dangerLevel: 10, controllingFactionId: 'kingdom' });
        world.locations.set('tavern', { id: 'tavern', name: 'Golden Dragon Tavern', population: 50, wealth: 40, stability: 60, dangerLevel: 5, controllingFactionId: null });
        world.locations.set('market', { id: 'market', name: 'Market Square', population: 200, wealth: 80, stability: 75, dangerLevel: 15, controllingFactionId: 'kingdom' });
        
        // Add default factions
        world.factions.set('kingdom', { id: 'kingdom', name: 'Kingdom of Valdoria', power: 80, resources: 70 });
        world.factions.set('merchants', { id: 'merchants', name: 'Merchants Guild', power: 50, resources: 90 });
        
        return world;
    }
}

// Use SimpleWorld if engine.js failed to load
if (!World) {
    console.log('Using SimpleWorld fallback');
    World = SimpleWorld;
}

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
        const { roomId, playerName, characterData } = data;
        
        // Create room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                world: null,          // Will be created when first player joins
                players: new Map(),   // playerId -> player data
                createdAt: Date.now(),
                hostId: socket.id
            });
        }

        const room = rooms.get(roomId);
        
        // Create world if first player
        if (!room.world) {
            room.world = World.createStarterWorld(playerName, 'town_central');
        }

        // Add player to room
        const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        room.players.set(socket.id, {
            id: playerId,
            socketId: socket.id,
            name: playerName,
            characterData: characterData,
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
            playerName
        });

        // Send room info to player
        socket.emit('roomJoined', {
            success: true,
            roomId,
            playerId,
            isHost: room.hostId === socket.id,
            players: Array.from(room.players.values()).map(p => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost
            })),
            worldState: serializeWorld(room.world)
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

        console.log(`${playerName} joined room ${roomId}`);
    });

    // Handle player action
    socket.on('playerAction', async (data) => {
        const { action, sceneType, sceneTags } = data;
        const player = players.get(socket.id);
        
        if (!player || !rooms.has(player.roomId)) {
            socket.emit('actionError', { message: 'Not in a room' });
            return;
        }

        const room = rooms.get(player.roomId);
        const world = room.world;
        const playerData = room.players.get(socket.id);

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
        const currentPlayer = world.player;
        const location = world.getLocation(currentPlayer.locationId);

        // Build action context
        const actionContext = `
**AKTUALNY STAN GRY:**
- Czas: ${world.getFormattedTime()} (Dzień ${world.getDayNumber()})
- Lokacja: ${location ? location.name : currentPlayer.locationId}
- HP: ${Math.round(currentPlayer.hp)}/${currentPlayer.maxHp}
- Złoto: ${currentPlayer.gold}

**INNI GRACZE W GRZE:**
${Array.from(room.players.values())
    .filter(p => p.socketId !== socket.id)
    .map(p => `- ${p.name}`)
    .join('\n') || '- Brak innych graczy'}

${context}

**AKCJA GRACZA:** ${action}
`;

        // Emit to all players in room that action is processing
        io.to(player.roomId).emit('actionStarted', {
            playerId: playerData.id,
            playerName: playerData.name,
            action: action.substring(0, 50)
        });

        // For now, simulate a simple response
        // In production, this would call the LLM
        const response = await simulateLLMResponse(actionContext, playerData.name);

        // Advance world time
        world.advanceWorldTime(10);

        // Record action in memory
        if (world.recordPlayerAction) {
            world.recordPlayerAction('player_action', {
                description: action.substring(0, 100),
                scope: 'local'
            });
        }

        // Broadcast response to all players
        io.to(player.roomId).emit('actionResult', {
            playerId: playerData.id,
            playerName: playerData.name,
            response,
            worldState: serializeWorld(world)
        });
    });

    // Handle chat message
    socket.on('chatMessage', (data) => {
        const { message } = data;
        const player = players.get(socket.id);
        
        if (!player || !rooms.has(player.roomId)) return;

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

            // Remove player from room
            room.players.delete(socket.id);

            // Notify others
            io.to(player.roomId).emit('playerLeft', {
                playerId: player.playerId,
                playerName: player.playerName,
                players: Array.from(room.players.values()).map(p => ({
                    id: p.id,
                    name: p.name,
                    isHost: p.isHost
                }))
            });

            // Clean up empty rooms
            if (room.players.size === 0) {
                rooms.delete(player.roomId);
                console.log(`Room ${player.roomId} deleted (empty)`);
            } else if (room.hostId === socket.id) {
                // Transfer host to next player
                const newHost = room.players.keys().next().value;
                room.hostId = newHost;
                room.players.get(newHost).isHost = true;
                
                io.to(player.roomId).emit('hostChanged', {
                    newHostId: room.players.get(newHost).id,
                    newHostName: room.players.get(newHost).name
                });
            }

            console.log(`${player.playerName} left room ${player.roomId}`);
        }

        players.delete(socket.id);
        console.log(`Player disconnected: ${socket.id}`);
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
            worldState: serializeWorld(room.world)
        });
    });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Serialize world state for client
 */
function serializeWorld(world) {
    if (!world) return null;
    
    return {
        currentTimeMinutes: world.currentTimeMinutes,
        formattedTime: world.getFormattedTime(),
        dayNumber: world.getDayNumber(),
        timeOfDay: world.getTimeOfDay(),
        locations: Array.from(world.locations.values()).map(l => ({
            id: l.id,
            name: l.name,
            population: l.population,
            wealth: l.wealth,
            stability: l.stability,
            dangerLevel: l.dangerLevel,
            controllingFactionId: l.controllingFactionId
        })),
        factions: Array.from(world.factions.values()).map(f => ({
            id: f.id,
            name: f.name,
            power: f.power,
            resources: f.resources
        })),
        player: world.player ? {
            name: world.player.name,
            locationId: world.player.locationId,
            hp: world.player.hp,
            maxHp: world.player.maxHp,
            gold: world.player.gold,
            hunger: world.player.hunger,
            thirst: world.player.thirst,
            fatigue: world.player.fatigue
        } : null
    };
}

/**
 * Simulate LLM response (placeholder)
 * In production, replace with actual OpenRouter API call
 */
async function simulateLLMResponse(context, playerName) {
    // This is a placeholder - in production, call OpenRouter API
    const responses = [
        `Rozglądasz się wokół. Słońce powoli zachodzi za horyzont, rzucając długie cienie na brukowane ulice. ${playerName} stoi pośrodku rynku, gdzie tłumy ludzi przechodzą obok siebie, każdy zajęty swoimi sprawami.`,
        `Wiatr niesie zapach świeżo upieczonego chleba z pobliskiej piekarni. ${playerName} zauważa, że kilka osób przygląda mu się z ciekawością.`,
        `Nocne niebo rozświetlają gwiazdy. W cieniu jednego z budynków ${playerName} dostrzega postać, która wydaje się go obserwować.`,
        `Deszcz pada od rana, tworząc kałuże na ulicach. ${playerName} schronić się może pod okapem starej kamienicy, gdzie inni podróżni już czekają na poprawę pogody.`
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
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
