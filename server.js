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
    pingTimeout: 30000,
    pingInterval: 10000,
    allowEIO3: true,
    perMessageDeflate: false,
    cookie: false,
    serveClient: true,
    maxHttpBufferSize: 1e6
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

// ====================== PEŁNY SILNIK (fazy 1-5) ======================
let World;
try {
    const engineModule = require('./engine.js');
    World = engineModule.World;
    console.log('✅ PEŁNY SILNIK RPG (fazy 1-5) ZAŁADOWANY POMYŚLNIE');
} catch (err) {
    console.error('❌ BŁĄD ŁADOWANIA ENGINE.JS:');
    console.error(err.message);
    console.error(err.stack);
    process.exit(1); // zatrzymujemy serwer, bo bez silnika nie ma sensu
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
        try {
            const { roomId, playerName, characterData, worldData, worldOption } = data;
            
            console.log(`Join room request: ${roomId}, player: ${playerName}, worldOption: ${worldOption}`);
            
            // Validate data
            if (!roomId || !playerName) {
                socket.emit('joinError', { message: 'Brak ID pokoju lub nazwy gracza' });
                return;
            }
            
            // Create room if it doesn't exist
            if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                id: roomId,
                world: null,          // Will be created when first player joins
                players: new Map(),   // playerId -> player data
                createdAt: Date.now(),
                hostId: socket.id,
                chatHistory: [],      // Historia czatu graczy (dla kontekstu AI)
                narratorHistory: []   // Historia narracji AI (akcja + odpowiedź) dla pamięci bota
            });
        }

        const room = rooms.get(roomId);
        
        // Create or load world based on option
        if (!room.world) {
            if (worldData && worldOption === 'current') {
                // Load world from client data
                try {
                    room.world = World.fromJSON(worldData);
                    console.log('World loaded from client data');
                } catch (e) {
                    console.error('Error loading world from client:', e);
                    room.world = World.createStarterWorld(playerName, 'town_central');
                }
            } else if (worldOption === 'saved' && worldData) {
                try {
                    room.world = World.fromJSON(worldData);
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

        // Add player to room
        const playerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        room.players.set(socket.id, {
            id: playerId,
            socketId: socket.id,
            name: playerName,
            characterData: characterData, // API key should be included in characterData from client
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
            playerName: playerName,
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
        } catch (err) {
            console.error('Error in joinRoom:', err);
            socket.emit('joinError', { message: 'Błąd serwera: ' + err.message });
        }
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

        // Build action context - be brief, don't describe location every time
        let actionContext = `Jesteś ${playerData.name}. `;
        actionContext += `Akcja: "${action}". `;
        actionContext += `To dzieje się w ${location ? location.name : currentPlayer.locationId}. `;
        actionContext += `Jest ${world.getFormattedTime()}, dzień ${world.getDayNumber()}. `;
        
        if (room.players.size > 1) {
            const others = Array.from(room.players.values())
                .filter(p => p.socketId !== socket.id)
                .map(p => p.name)
                .join(', ');
            actionContext += `Obok ciebie jest: ${others}. `;
        }

        // Dołącz historię czatu graczy do kontekstu AI
        if (room.chatHistory && room.chatHistory.length > 0) {
            const recentChat = room.chatHistory.slice(-20); // ostatnie 20 wiadomości
            actionContext += `\n\n## OSTATNI DIALOG MIĘDZY GRACZAMI (uwzględnij to w narracji!):\n`;
            for (const msg of recentChat) {
                const tag = msg.type === 'in_character' ? '[IC]' : '[OOC]';
                actionContext += `${tag} ${msg.playerName}: ${msg.message}\n`;
            }
        }
        
        actionContext += `\nOpisz co się dzieje w wyniku tej akcji. NIE opisuj dokładnie lokacji - zakładam, że gracz ją widzi. Skup się na akcji, reakcjach NPC, konsekwencjach. 2-3 zdania wystarczą.`;

        // Emit to all players in room that action is processing
        io.to(player.roomId).emit('actionStarted', {
            playerId: playerData.id,
            playerName: playerData.name,
            action: action.substring(0, 50)
        });

        // Call LLM with player's API key
        const playerApiKey = playerData.characterData?.apiKey || '';
        if (!room.narratorHistory) room.narratorHistory = [];
        const response = await callLLM(actionContext, playerData.name, playerApiKey, room.narratorHistory);

        // Zapisz akcję i odpowiedź AI do historii narracji (pamięć bota)
        room.narratorHistory.push({ role: 'user', content: actionContext });
        room.narratorHistory.push({ role: 'assistant', content: response });
        // Ogranicz historię do ostatnich 20 par (40 wiadomości) żeby nie przekroczyć limitu tokenów
        if (room.narratorHistory.length > 40) {
            room.narratorHistory = room.narratorHistory.slice(-40);
        }

        // Phase 1-2: Przesuwamy czas i przetwarzamy wydarzenia
        world.advanceWorldTime(15);   // realistyczny koszt akcji

        // Phase 4: Zapisujemy akcję do pamięci kontekstowej
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

    // Player-to-player chat (AI sees but doesn't respond)
    socket.on('playerChat', (data) => {
        try {
            const { message, type } = data;
            const player = players.get(socket.id);
            
            if (!player || !rooms.has(player.roomId)) {
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
 * Call OpenRouter API for LLM response
 * Each player uses their own API key
 */
async function callLLM(context, playerName, apiKey, narratorHistory = []) {
    if (!apiKey) {
        return `${playerName} wykonuje akcję... (brak klucza API - dodaj swój klucz OpenRouter)`;
    }
    
    try {
        // Buduj messages z historią narracji żeby bot pamiętał poprzednie tury
        const systemMessage = {
            role: 'system',
            content: `Jesteś narratorem w grze RPG. Opisuj akcje gracza i ich konsekwencje. NIE opisuj ciągle tej samej lokacji - zakładaj, że gracz ją zna. Skup się na tym CO się dzieje, nie GDZIE się dzieje. Postać nazywa się ${playerName}. Pamiętaj o poprzednich wydarzeniach z tej sesji i nawiązuj do nich. Odpowiadaj po polsku.`
        };
        // Weź ostatnie 20 wiadomości z historii żeby nie przekroczyć limitu tokenów
        const historySlice = narratorHistory.slice(-20);
        const messages = [systemMessage, ...historySlice, { role: 'user', content: context }];

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://gierkaboza-production.up.railway.app',
                'X-Title': 'AI RPG Multiplayer'
            },
            body: JSON.stringify({
                model: 'openai/gpt-3.5-turbo',
                messages,
                temperature: 0.8,
                max_tokens: 400
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
