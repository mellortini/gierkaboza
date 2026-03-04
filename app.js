// Phase 1: Import silnika gry - klasy będą przypisane w init() z window.RPGEngine
// Nie deklarujemy tutaj żeby uniknąć konfliktu z globalnymi klasami z engine.js

// Stan aplikacji
const state = {
    apiKey: localStorage.getItem('openrouter_api_key') || '',
    model: localStorage.getItem('openrouter_model') || '',
    character: null,
    gameState: [],
    isLoading: false,
    storyHistory: [],
    world: null,  // Instancja silnika World
    
    // Multiplayer state
    isMultiplayer: false,
    socket: null,
    roomId: null,
    playerId: null,
    isHost: false,
    players: []
};

// Dane postaci
let characterData = {
    name: '',
    setting: '',
    settingName: '',
    description: '',
    adventureType: '',
    tone: '',
    sliders: {
        violence: 5,
        sexual: 5,
        darkness: 5,
        realism: 5,
        language: 3,
        psychological: 5
    }
};

// Dane świata
let worldData = {
    name: '',
    description: '',
    scope: 'medium',
    complexity: 'moderate',
    plan: null,
    model: '',
    generated: false
};

// Tłumaczenia dla UI
const settingNames = {
    fantasy: '🐉 Fantasy',
    scifi: '🚀 Sci-Fi',
    postapo: '☢️ Post-Apo',
    cyberpunk: '🌃 Cyberpunk',
    horror: '🕯️ Horror',
    modern: '🏙️ Współczesny',
    historical: '⚔️ Historyczny',
    custom: '✨ Własny'
};

// Elementy DOM
const elements = {
    apiKeyInput: document.getElementById('api-key'),
    saveApiKeyBtn: document.getElementById('save-api-key'),
    modelSelect: document.getElementById('model-select'),
    refreshModelsBtn: document.getElementById('refresh-models'),
    modelsLoading: document.getElementById('models-loading'),
    apiStatus: document.getElementById('api-status'),
    apiConfigSection: document.getElementById('api-config'),
    worldBuilding: document.getElementById('world-building'),
    worldName: document.getElementById('world-name'),
    worldDescription: document.getElementById('world-description'),
    worldModel: document.getElementById('world-model'),
    refreshWorldModels: document.getElementById('refresh-world-models'),
    worldScope: document.getElementById('world-scope'),
    worldComplexity: document.getElementById('world-complexity'),
    generateWorldPlanBtn: document.getElementById('generate-world-plan'),
    regeneratePlanBtn: document.getElementById('regenerate-plan'),
    worldPlanContent: document.getElementById('world-plan-content'),
    worldPreviewContent: document.getElementById('world-preview-content'),
    startWithWorldBtn: document.getElementById('start-with-world'),
    useCustomWorldBtn: document.getElementById('use-custom-world'),
    skipWorldBuildingBtn: document.getElementById('skip-world-building'),
    characterCreation: document.getElementById('character-creation'),
    charName: document.getElementById('char-name'),
    charSetting: document.getElementById('char-setting'),
    customSettingGroup: document.getElementById('custom-setting-group'),
    customSetting: document.getElementById('custom-setting'),
    charDescription: document.getElementById('char-description'),
    adventureType: document.getElementById('adventure-type'),
    toneTon: document.getElementById('tone-ton'),
    violenceLevel: document.getElementById('violence-level'),
    violenceValue: document.getElementById('violence-value'),
    sexualLevel: document.getElementById('sexual-level'),
    sexualValue: document.getElementById('sexual-value'),
    darknessLevel: document.getElementById('darkness-level'),
    darknessValue: document.getElementById('darkness-value'),
    realismLevel: document.getElementById('realism-level'),
    realismValue: document.getElementById('realism-value'),
    languageLevel: document.getElementById('language-level'),
    languageValue: document.getElementById('language-value'),
    psychologicalLevel: document.getElementById('psychological-level'),
    psychologicalValue: document.getElementById('psychological-value'),
    startGameBtn: document.getElementById('start-game'),
    gameSection: document.getElementById('game-section'),
    gameCharacterName: document.getElementById('game-character-name'),
    gameSetting: document.getElementById('game-setting'),
    gameStory: document.getElementById('game-story'),
    playerAction: document.getElementById('player-action'),
    sendActionBtn: document.getElementById('send-action'),
    suggestActionsBtn: document.getElementById('suggest-actions'),
    viewCharacterBtn: document.getElementById('view-character'),
    saveGameBtn: document.getElementById('save-game'),
    loadGameBtn: document.getElementById('load-game'),
    exportGameBtn: document.getElementById('export-game'),
    newGameBtn: document.getElementById('new-game'),
    savedGamesSection: document.getElementById('saved-games-section'),
    savedGamesList: document.getElementById('saved-games-list'),
    importFile: document.getElementById('import-file'),
    characterModal: document.getElementById('character-modal'),
    closeModal: document.querySelector('.close-modal'),
    characterDetails: document.getElementById('character-details'),
    // HUD elements
    gameHud: document.getElementById('game-hud'),
    gameTime: document.getElementById('game-time'),
    gameDay: document.getElementById('game-day'),
    playerLocation: document.getElementById('player-location'),
    playerHp: document.getElementById('player-hp'),
    playerStamina: document.getElementById('player-stamina'),
    playerMana: document.getElementById('player-mana'),
    playerGold: document.getElementById('player-gold'),
    playerHunger: document.getElementById('player-hunger'),
    playerThirst: document.getElementById('player-thirst'),
    playerFatigue: document.getElementById('player-fatigue')
};

// Pobieranie listy modeli z OpenRouter
async function fetchModels(forWorldBuilder = false) {
    if (!state.apiKey) {
        elements.modelsLoading.textContent = 'Wprowadź klucz API, aby wczytać modele';
        elements.modelsLoading.className = 'models-status';
        elements.modelsLoading.classList.remove('hidden');
        return;
    }

    elements.modelsLoading.textContent = 'Wczytywanie modeli...';
    elements.modelsLoading.className = 'models-status loading';
    elements.modelsLoading.classList.remove('hidden');
    elements.refreshModelsBtn.disabled = true;
    if (elements.refreshWorldModels) elements.refreshWorldModels.disabled = true;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/models', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${state.apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'AI Roleplay'
            }
        });

        if (!response.ok) {
            throw new Error(`Błąd HTTP: ${response.status}`);
        }

        const data = await response.json();
        
        // Sortowanie: najpierw darmowe, potem płatne
        const models = data.data.sort((a, b) => {
            const aFree = a.id.includes(':free') || a.pricing?.prompt === 0;
            const bFree = b.id.includes(':free') || b.pricing?.prompt === 0;
            if (aFree && !bFree) return -1;
            if (!aFree && bFree) return 1;
            return a.name.localeCompare(b.name);
        });

        // Wypełnij oba selecty
        const selectElements = [elements.modelSelect];
        if (elements.worldModel) selectElements.push(elements.worldModel);

        selectElements.forEach(select => {
            select.innerHTML = '';
            models.forEach(model => {
                const isFree = model.id.includes(':free') || model.pricing?.prompt === 0;
                const priceInfo = isFree ? '[DARMOWY]' : '';
                const contextInfo = model.context_length ? `(${Math.round(model.context_length/1000)}k kontekst)` : '';
                
                const option = document.createElement('option');
                option.value = model.id;
                option.textContent = `${model.name} ${priceInfo} ${contextInfo}`.trim();
                select.appendChild(option);
            });
        });

        // Przywróć zapisane modele
        if (state.model && models.find(m => m.id === state.model)) {
            elements.modelSelect.value = state.model;
        }
        if (worldData.model && models.find(m => m.id === worldData.model)) {
            elements.worldModel.value = worldData.model;
        }

        elements.modelsLoading.textContent = `Wczytano ${models.length} modeli`;
        elements.modelsLoading.className = 'models-status success';
        
        setTimeout(() => {
            elements.modelsLoading.classList.add('hidden');
        }, 3000);

    } catch (error) {
        console.error('Błąd pobierania modeli:', error);
        elements.modelsLoading.textContent = 'Błąd wczytywania modeli. Sprawdź klucz API.';
        elements.modelsLoading.className = 'models-status error';
        
        // Dodaj domyślne opcje jako fallback
        const fallbackHTML = `
            <option value="deepseek/deepseek-chat:free">DeepSeek V3 (Free)</option>
            <option value="deepseek/deepseek-r1:free">DeepSeek R1 (Free)</option>
            <option value="google/gemini-2.0-flash-lite-preview-02-05:free">Gemini 2.0 Flash Lite (Free)</option>
            <option value="moonshotai/kimi-k2.5:free">Kimi K2.5 (Free)</option>
        `;
        elements.modelSelect.innerHTML = fallbackHTML;
        if (elements.worldModel) elements.worldModel.innerHTML = fallbackHTML;
    } finally {
        elements.refreshModelsBtn.disabled = false;
        if (elements.refreshWorldModels) elements.refreshWorldModels.disabled = false;
    }
}

// Inicjalizacja aplikacji
function init() {
    console.log('🚀 init() started');
    
    // Phase 1: Inicjalizacja silnika gry (po załadowaniu engine.js)
    if (typeof window.RPGEngine !== 'undefined') {
        World = window.RPGEngine.World;
        Location = window.RPGEngine.Location;
        Faction = window.RPGEngine.Faction;
        NPC = window.RPGEngine.NPC;
        Player = window.RPGEngine.Player;
        StatusEffect = window.RPGEngine.StatusEffect;
        WorldChange = window.RPGEngine.WorldChange;
        ActionResult = window.RPGEngine.ActionResult;
        console.log('✅ RPGEngine initialized in init()');
    } else {
        console.error('❌ RPGEngine not available in init()');
    }
    
    // Wczytaj zapisane dane
    if (state.apiKey) {
        elements.apiKeyInput.value = state.apiKey;
        showStatus('Klucz API wczytany z pamięci', 'success');
        fetchModels();
        showCharacterCreation();
    }

    // Event listeners - API
    elements.saveApiKeyBtn.addEventListener('click', saveApiKey);
    elements.refreshModelsBtn.addEventListener('click', fetchModels);
    elements.modelSelect.addEventListener('change', saveModel);
    elements.refreshWorldModels.addEventListener('click', () => fetchModels(true));

    // Event listeners - Budowanie świata
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    elements.generateWorldPlanBtn.addEventListener('click', generateWorldPlan);
    elements.regeneratePlanBtn.addEventListener('click', generateWorldPlan);
    elements.startWithWorldBtn.addEventListener('click', startGameWithWorld);
    elements.useCustomWorldBtn.addEventListener('click', showWorldBuilding);
    elements.skipWorldBuildingBtn.addEventListener('click', showCharacterCreation);

    // Event listeners - Tworzenie postaci
    elements.charSetting.addEventListener('change', () => {
        if (elements.charSetting.value === 'custom') {
            elements.customSettingGroup.classList.remove('hidden');
        } else {
            elements.customSettingGroup.classList.add('hidden');
        }
    });

    // Suwaki - aktualizacja wartości
    const sliders = [
        { input: elements.violenceLevel, display: elements.violenceValue },
        { input: elements.sexualLevel, display: elements.sexualValue },
        { input: elements.darknessLevel, display: elements.darknessValue },
        { input: elements.realismLevel, display: elements.realismValue },
        { input: elements.languageLevel, display: elements.languageValue },
        { input: elements.psychologicalLevel, display: elements.psychologicalValue }
    ];

    sliders.forEach(({ input, display }) => {
        input.addEventListener('input', () => {
            display.textContent = input.value;
            // Zmień kolor w zależności od wartości
            const val = parseInt(input.value);
            if (val <= 3) {
                display.style.background = 'linear-gradient(135deg, #27ae60, #2ecc71)';
            } else if (val <= 7) {
                display.style.background = 'linear-gradient(135deg, #f39c12, #ffd700)';
            } else {
                display.style.background = 'linear-gradient(135deg, #c0392b, #e74c3c)';
            }
        });
    });

    elements.startGameBtn.addEventListener('click', startGame);

    // Multiplayer event listeners
    const serverUrlInput = document.getElementById('server-url');
    const roomIdInput = document.getElementById('room-id');
    const joinRoomBtn = document.getElementById('join-room');
    const createRoomBtn = document.getElementById('create-room');
    
    if (joinRoomBtn) {
        joinRoomBtn.addEventListener('click', () => joinRoom(serverUrlInput.value, roomIdInput.value));
    }
    if (createRoomBtn) {
        createRoomBtn.addEventListener('click', () => createRoom(serverUrlInput.value, roomIdInput.value));
    }

    // Event listeners - Gra
    elements.sendActionBtn.addEventListener('click', sendAction);
    elements.playerAction.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendAction();
        }
    });
    elements.suggestActionsBtn.addEventListener('click', suggestActions);
    
    // Player chat in multiplayer
    const sendPlayerChatBtn = document.getElementById('send-player-chat');
    const playerChatInput = document.getElementById('player-chat-input');
    if (sendPlayerChatBtn && playerChatInput) {
        sendPlayerChatBtn.addEventListener('click', sendPlayerChat);
        playerChatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendPlayerChat();
            }
        });
    }
    elements.viewCharacterBtn.addEventListener('click', showCharacterModal);
    elements.closeModal.addEventListener('click', hideCharacterModal);
    elements.saveGameBtn.addEventListener('click', () => saveGameToFile());
    elements.loadGameBtn.addEventListener('click', loadGameFromFile);
    elements.exportGameBtn.addEventListener('click', exportGameToJSON);
    elements.newGameBtn.addEventListener('click', newGame);
    elements.importFile.addEventListener('change', importGameFromFile);

    // Zamknij modal po kliknięciu poza nim
    elements.characterModal.addEventListener('click', (e) => {
        if (e.target === elements.characterModal) hideCharacterModal();
    });

    // Wyświetl zapisane gry przy inicjalizacji
    displaySavedGames();
}

// Zapisanie klucza API
async function saveApiKey() {
    const apiKey = elements.apiKeyInput.value.trim();
    
    if (!apiKey) {
        showStatus('Wprowadź klucz API', 'error');
        return;
    }

    if (!apiKey.startsWith('sk-or-v1-')) {
        showStatus('Klucz powinien zaczynać się od "sk-or-v1-"', 'error');
        return;
    }

    state.apiKey = apiKey;
    localStorage.setItem('openrouter_api_key', apiKey);
    showStatus('Klucz API zapisany! Wczytywanie modeli...', 'success');
    
    await fetchModels();
    showCharacterCreation();
}

// ============================================================================
// MULTIPLAYER FUNCTIONS
// ============================================================================

/**
 * Connect to multiplayer server
 */
function connectToServer(serverUrl) {
    return new Promise((resolve, reject) => {
        if (state.socket && state.socket.connected) {
            resolve(state.socket);
            return;
        }

        // Determine the correct URL
        let url = serverUrl || 'http://localhost:3000';
        // Always add protocol
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            url = 'https://' + url;
        }

        console.log('Connecting to:', url);

        try {
            state.socket = io(url, {
                transports: ['polling'],
                reconnection: true,
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                timeout: 20000,
                forceNew: true,
                withCredentials: false
            });

            state.socket.on('connect', () => {
                console.log('Connected to server:', url, 'ID:', state.socket.id);
                resolve(state.socket);
            });

            state.socket.on('connect_error', (error) => {
                console.error('Connection error:', error.message);
                reject(error);
            });

            state.socket.on('disconnect', (reason) => {
                console.log('Disconnected:', reason);
                updateMultiplayerStatus('Rozłączono: ' + reason, 'error');
            });

            state.socket.on('error', (error) => {
                console.error('Socket error:', error);
            });

            // Log transport
            state.socket.on('open', () => {
                console.log('Transport opened');
            });

        } catch (error) {
            console.error('Socket creation error:', error);
            reject(error);
        }
    });
}

/**
 * Join an existing room
 */
async function joinRoom(serverUrl, roomId) {
    const statusEl = document.getElementById('multiplayer-status');
    const playersListEl = document.getElementById('players-list');
    const playersInRoomEl = document.getElementById('players-in-room');

    if (!roomId) {
        statusEl.textContent = 'Wprowadź ID pokoju!';
        statusEl.className = 'multiplayer-status error';
        return;
    }

    statusEl.textContent = 'Łączenie z serwerem...';
    statusEl.className = 'multiplayer-status connecting';

    // Validate character name
    const charNameInput = elements.charName.value.trim();
    if (!charNameInput) {
        statusEl.textContent = 'Wpisz imię postaci w formularzu powyżej!';
        statusEl.className = 'multiplayer-status error';
        elements.charName.focus();
        return;
    }
    
    // Get world selection
    const worldSelect = document.getElementById('world-select');
    const worldOption = worldSelect ? worldSelect.value : 'new';
    
    // Update character data
    characterData.name = charNameInput;
    characterData.setting = elements.charSetting.value;
    characterData.description = elements.charDescription.value.trim();
    
    try {
        await connectToServer(serverUrl);
        
        const playerName = characterData.name;
        
        // Include API key for LLM calls on server
        const characterDataWithApi = {
            ...characterData,
            apiKey: state.apiKey
        };
        
        // Prepare world data based on selection
        let worldData = null;
        if (worldOption === 'current' && state.world) {
            worldData = state.world.toJSON();
        } else if (worldOption === 'saved') {
            // Load from localStorage
            const savedGame = localStorage.getItem('rpg_current_save');
            if (savedGame) {
                try {
                    worldData = JSON.parse(savedGame);
                } catch (e) {
                    console.error('Error parsing saved game:', e);
                }
            }
        }
        
        state.socket.emit('joinRoom', {
            roomId: roomId,
            playerName: playerName,
            characterData: characterDataWithApi,
            worldData: worldData,
            worldOption: worldOption
        });

        // Wait for roomJoined event
        state.socket.once('roomJoined', (data) => {
            state.isMultiplayer = true;
            state.roomId = data.roomId;
            state.playerId = data.playerId;
            state.playerName = data.playerName;
            console.log('roomJoined: playerName set to:', data.playerName, 'playerId:', data.playerId);
            state.isHost = data.isHost;
            state.players = data.players;

            statusEl.textContent = `Połączono! Jesteś w pokoju: ${roomId}`;
            statusEl.className = 'multiplayer-status connected';

            // Update players list
            updatePlayersList(data.players);

            // Start multiplayer game
            startMultiplayerGame(data);
        });

        state.socket.once('roomJoined', (data) => {
            // This is handled above
        }, { once: true });

        // Handle errors
        state.socket.once('joinError', (data) => {
            statusEl.textContent = data.message || 'Błąd dołączania do pokoju';
            statusEl.className = 'multiplayer-status error';
        });

    } catch (error) {
        statusEl.textContent = 'Błąd połączenia: ' + error.message;
        statusEl.className = 'multiplayer-status error';
    }
}

/**
 * Create a new room
 */
async function createRoom(serverUrl, roomId) {
    const statusEl = document.getElementById('multiplayer-status');
    
    // Validate character name first
    const charNameInput = elements.charName.value.trim();
    if (!charNameInput) {
        statusEl.textContent = 'Wpisz imię postaci w formularzu powyżej!';
        statusEl.className = 'multiplayer-status error';
        elements.charName.focus();
        return;
    }
    
    // Generate room ID if not provided
    const finalRoomId = roomId || `room_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    document.getElementById('room-id').value = finalRoomId;
    
    await joinRoom(serverUrl, finalRoomId);
}

/**
 * Update players list in UI
 */
function updatePlayersList(players) {
    const playersListEl = document.getElementById('players-list');
    const playersInRoomEl = document.getElementById('players-in-room');
    
    if (!playersInRoomEl) return;
    
    playersInRoomEl.innerHTML = '';
    
    for (const player of players) {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${player.name}</span>
            ${player.isHost ? '<span class="host-badge">HOST</span>' : ''}
        `;
        playersInRoomEl.appendChild(li);
    }
    
    playersListEl.classList.remove('hidden');
}

/**
 * Update multiplayer status
 */
function updateMultiplayerStatus(message, type) {
    const statusEl = document.getElementById('multiplayer-status');
    if (statusEl) {
        statusEl.textContent = message;
        statusEl.className = `multiplayer-status ${type}`;
    }
}

/**
 * Start multiplayer game
 */
function startMultiplayerGame(roomData) {
    // Hide character creation, show game
    elements.characterCreation.classList.add('hidden');
    elements.gameSection.classList.remove('hidden');
    
    // Update game header
    elements.gameCharacterName.textContent = characterData.name || 'Gracz';
    elements.gameSetting.textContent = settingNames[characterData.setting] || characterData.setting;
    
    // Initialize game state - always create local world (server doesn't send full world data)
    state.world = World.createStarterWorld(characterData.name, 'town_central');
    
    // If server sent world state, we could sync some data here in the future
    if (roomData.worldState && roomData.worldState.formattedTime) {
        state.world.currentTimeMinutes = roomData.worldState.currentTimeMinutes || 0;
    }
    
    // Initialize game state for LLM
    state.gameState = [
        { role: 'system', content: buildNarratorPrompt() }
    ];
    
    // Add welcome message
    addStoryEntry('system', `Witaj w trybie wieloosobowym!`);
    addStoryEntry('system', `ID Pokoju: ${state.roomId}`);
    addStoryEntry('system', `Gracze: ${state.players.map(p => p.name).join(', ')}`);
    
    // Show player chat area in multiplayer
    const playerChatArea = document.getElementById('player-chat-area');
    if (playerChatArea) {
        playerChatArea.classList.remove('hidden');
    }
    
    // Setup socket listeners for multiplayer
    setupMultiplayerListeners();
    
    // Update HUD
    updateGameHUD();
}

/**
 * Setup socket event listeners for multiplayer
 */
function setupMultiplayerListeners() {
    if (!state.socket) return;

    // Player joined
    state.socket.on('playerJoined', (data) => {
        state.players = data.players;
        updatePlayersList(data.players);
        addStoryEntry('system', `${data.playerName} dołączył do gry!`);
    });

    // Player left
    state.socket.on('playerLeft', (data) => {
        state.players = data.players;
        updatePlayersList(data.players);
        addStoryEntry('system', `${data.playerName} opuścił grę.`);
    });

    // Host changed
    state.socket.on('hostChanged', (data) => {
        state.isHost = data.newHostId === state.playerId;
        addStoryEntry('system', `Nowy host: ${data.newHostName}`);
    });

    // Action result from server
    state.socket.on('actionResult', (data) => {
        // Add story response
        addStoryEntry('narrator', data.response);
        
        // Update world state
        if (data.worldState) {
            state.world = World.fromJSON(data.worldState);
            updateGameHUD();
        }
    });

    // Action started
    state.socket.on('actionStarted', (data) => {
        addStoryEntry('system', `${data.playerName} wykonuje akcję: ${data.action}...`);
    });

    // Chat message
    state.socket.on('chatMessage', (data) => {
        addStoryEntry('player', `[${data.playerName}]: ${data.message}`);
    });

    // Player-to-player chat message (from other players)
    state.socket.on('playerChatMessage', (data) => {
        console.log('Received playerChatMessage:', { dataPlayerId: data.playerId, statePlayerId: state.playerId, dataPlayerName: data.playerName });
        // Always add messages from other players (not our own - those we added locally)
        if (data.playerId !== state.playerId) {
            addStoryEntry('player', `💬 [${data.playerName}]: ${data.message}`);
        } else {
            console.log('Skipping own message (already added locally)');
        }
    });

    // Action error (when bot fails to respond)
    state.socket.on('actionError', (data) => {
        addStoryEntry('system', `❌ Błąd: ${data.message}`);
    });
}

/**
 * Send action in multiplayer
 */
async function sendMultiplayerAction(action) {
    if (!state.socket || !state.isMultiplayer) return;

    const sceneType = determineSceneType(action);
    const sceneTags = extractSceneTags(action);

    state.socket.emit('playerAction', {
        action: action,
        sceneType: sceneType,
        sceneTags: sceneTags
    });
}

/**
 * Send player-to-player chat (AI sees but doesn't respond immediately)
 */
function sendPlayerChat() {
    const chatInput = document.getElementById('player-chat-input');
    const message = chatInput.value.trim();
    
    if (!message || !state.socket || !state.isMultiplayer) return;
    
    // Get player name from state
    const playerName = state.playerName || 'Ty';
    
    // Add to story as player dialogue (format matches server)
    addStoryEntry('player', `💬 [${playerName}]: ${message}`);
    
    // Send to other players via special event
    state.socket.emit('playerChat', {
        message: message,
        type: 'player_dialogue'
    });
    
    // Clear input
    chatInput.value = '';
}

/**
 * Send chat message in multiplayer (old general chat)
 */
function sendMultiplayerChat(message) {
    if (!state.socket || !state.isMultiplayer) return;
    
    state.socket.emit('chatMessage', {
        message: message
    });
}

// Zapisanie modelu
function saveModel() {
    state.model = elements.modelSelect.value;
    localStorage.setItem('openrouter_model', state.model);
}

// Pokazanie statusu
function showStatus(message, type) {
    elements.apiStatus.textContent = message;
    elements.apiStatus.className = `status ${type}`;
    
    if (type === 'success') {
        setTimeout(() => {
            elements.apiStatus.textContent = '';
            elements.apiStatus.className = 'status';
        }, 3000);
    }
}

// Przełączanie tabów
function switchTab(tabName) {
    // Ukryj wszystkie taby
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Pokaż wybrany tab
    const tabElement = document.getElementById(tabName);
    if (tabElement) {
        tabElement.classList.add('active');
    }
    
    // Zaznacz przycisk
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

// Pokazanie budowania świata
function showWorldBuilding() {
    elements.worldBuilding.classList.remove('hidden');
    elements.characterCreation.classList.add('hidden');
    elements.gameSection.classList.add('hidden');
}

// Pokazanie tworzenia postaci
function showCharacterCreation() {
    elements.worldBuilding.classList.add('hidden');
    elements.characterCreation.classList.remove('hidden');
    elements.gameSection.classList.add('hidden');
}

// Funkcja pomocnicza do opisu poziomu suwaka
function getLevelDescription(type, level) {
    const descriptions = {
        violence: {
            1: 'Brak przemocy - konflikty rozwiązywane pokojowo',
            2: 'Minimalna - przemoc tylko wzmiankowana',
            3: 'Łagodna - przemoc bez szczegółów',
            4: 'Umiarkowana - ogólne opisy walk',
            5: 'Średnia - realistyczna przemoc, obrażenia',
            6: 'Dojrzała - szczegółowe rany, ból, krew',
            7: 'Intensywna - brutalne opisy, tortury',
            8: 'Ekstremalna - makabra, rozczłonkowanie',
            9: 'Chora - sadystyczne detale, cierpienie',
            10: 'Bez ograniczeń - najbrutalniejsze, szokujące sceny'
        },
        sexual: {
            1: 'Romantyczny - tylko niewinne uczucia',
            2: 'Flirt - lekkie sugestie, napięcie',
            3: 'Sugestywny - wzmianki o intymności',
            4: 'Mild NSFW - delikatne opisy',
            5: 'Średni NSFW - szczegółowe sceny erotyczne',
            6: 'Intensywny - wyraźne sceny seksualne',
            7: 'Hard NSFW - szczegółowe akty seksualne',
            8: 'Ekstremalny - perwersyjne praktyki',
            9: 'Brutalny - przemoc seksualna, BDSM',
            10: 'Bez granic - wszystkie fetysze, tabu'
        },
        darkness: {
            1: 'Jasny - optymizm, nadzieja',
            2: 'Pogodny - lekkie problemy',
            3: 'Neutralny - mieszane emocje',
            4: 'Ponury - smutek, strata',
            5: 'Mroczny - desperacja, strach',
            6: 'Ciemny - beznadzieja, szaleństwo',
            7: 'Piekielny - koszmar, horror',
            8: 'Apokaliptyczny - koniec świata',
            9: 'Nihilistyczny - brak sensu, rozpacz',
            10: 'Absolutna ciemność - depresja, trauma'
        },
        realism: {
            1: 'Bajkowy - happy endy, sprawiedliwość',
            2: 'Heroiczny - bohaterowie nie giną',
            3: 'Przygodowy - szczęście sprzyja',
            4: 'Równowaga - szanse 50/50',
            5: 'Realistyczny - prawdopodobne wyniki',
            6: 'Surowy - błędy są karane',
            7: 'Brutalny - śmierć jest łatwa',
            8: 'Mroczny - zło często wygrywa',
            9: 'Bezlitosny - przetrwanie niemożliwe',
            10: 'Koszmarny - rzeczywistość okrutna'
        },
        language: {
            1: 'Czysty - brak wulgaryzmów',
            2: 'Uprzejmy - łagodne słowa',
            3: 'Neutralny - rzadkie przekleństwa',
            4: 'Średni - wulgaryzmy w stresie',
            5: 'Surowy - częste przekleństwa',
            6: 'Brutalny - agresywny język',
            7: 'Obraźliwy - poniżanie',
            8: 'Chuligański - ulica, gangi',
            9: 'Psychopata - sadyzm w słowach',
            10: 'Degrengolada - najgorsze słowa'
        },
        psychological: {
            1: 'Prosta - motywacje jasne',
            2: 'Lekka - podstawowe emocje',
            3: 'Standardowa - typowe reakcje',
            4: 'Złożona - wewnętrzne konflikty',
            5: 'Głęboka - psychologia postaci',
            6: 'Intensywna - trauma, fobie',
            7: 'Mroczna - szaleństwo, paranoja',
            8: 'Pokrętna - zaburzenia osobowości',
            9: 'Chora - psychopatia, sadyzm',
            10: 'Niezbadana - niepojęta groza'
        }
    };
    return descriptions[type][level] || 'Nieznany';
}

// Generowanie planu świata
async function generateWorldPlan() {
    worldData.name = elements.worldName.value.trim();
    worldData.description = elements.worldDescription.value.trim();
    worldData.scope = elements.worldScope.value;
    worldData.complexity = elements.worldComplexity.value;
    worldData.model = elements.worldModel.value;

    if (!worldData.name) {
        alert('Podaj nazwę świata');
        return;
    }
    if (!worldData.model) {
        alert('Wybierz model do planowania');
        return;
    }

    elements.generateWorldPlanBtn.disabled = true;
    elements.worldPlanContent.innerHTML = '<div style="text-align: center; padding: 40px; color: #ffd700;">🎲 Generuję plan świata...</div>';

    try {
        const scopeDescriptions = {
            small: 'Mały świat - 1-2 miasta, kilka ważnych lokacji, proste relacje między postaciami',
            medium: 'Średni świat - region z 5-10 miastami, wiele lokacji, kilka frakcji, złożone relacje',
            large: 'Duży świat - cały kontynent, 20+ miast, wiele kultur, złożona polityka, wiele frakcji',
            epic: 'Epicki świat - cały świat, imperium, wiele ras, złożona historia, światowe konsekwencje'
        };

        const complexityDescriptions = {
            simple: 'Prosta fabuła - jeden główny wątek, kilka ważnych postaci, jasne cele',
            moderate: 'Umiarkowana - kilka wątków, intrygi, tajemnice, kilka zwrotów akcji',
            complex: 'Złożona - wiele wątków, głębokie tajemnice, wiele zwrotów akcji, moralnie szare strefy',
            epic: 'Epicka - światowe konsekwencje, wiele frakcji, głębokie podziały ideologiczne, apokaliptyczne zagrożenia'
        };

        const prompt = `Jesteś mistrzem planowania światów fantasy/sci-fi. Twoim zadaniem jest stworzenie szczegółowego planu świata dla gry RPG.

## ŚWIAT:
**Nazwa:** ${worldData.name}
**Opis:** ${worldData.description || 'Brak opisu - stwórz własny'}

## PARAMETRY:
**Zakres:** ${scopeDescriptions[worldData.scope]}
**Złożoność fabuły:** ${complexityDescriptions[worldData.complexity]}

## PLAN POWINIEN ZAWIERAĆ:

### 1. GEOGRAFIA I KLIMAT
- Opis terenu (góry, równiny, morza, lasy)
- Klimat i pory roku
- Ważne lokacje geograficzne

### 2. MIASTA I LOKACJE (${worldData.scope === 'small' ? '2-3' : worldData.scope === 'medium' ? '5-10' : worldData.scope === 'large' ? '15-25' : '30+'})
Dla każdego miasta:
- Nazwa i położenie
- Populacja i typ (stolicę, port, twierdza, itp.)
- Główne cechy i architektura
- Ważne lokacje w mieście

### 3. FRAKCJE I GRUPY (${worldData.complexity === 'simple' ? '2-3' : worldData.complexity === 'moderate' ? '4-6' : worldData.complexity === 'complex' ? '7-10' : '10+'})
Dla każdej frakcji:
- Nazwa i cel
- Lider
- Siła i zasoby
- Relacje z innymi frakcjami

### 4. GŁÓWNE POSTACIE (${worldData.complexity === 'simple' ? '3-5' : worldData.complexity === 'moderate' ? '6-10' : worldData.complexity === 'complex' ? '10-15' : '15+'})
Dla każdej postaci:
- Imię i rola
- Motywacje i tajemnice
- Relacje z innymi postaciami
- Wpływ na świat

### 5. GŁÓWNE WĄTKI FABULARNE
- Główny konflikt
- Tajemnice świata
- Możliwe zwroty akcji
- Zagrożenia

### 6. HISTORIA ŚWIATA
- Kluczowe wydarzenia z przeszłości
- Jak świat doszedł do obecnego stanu
- Legendy i mity

## INSTRUKCJE:
- Bądź szczegółowy i konkretny
- Stwórz spójny, żywy świat
- Daj graczowi wiele możliwości eksploracji
- Utwórz tajemnice do odkrycia
- Odpowiadaj po POLSKU
- Formatuj odpowiedź używając nagłówków (###) i list

Wygeneruj kompletny plan świata:`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'AI RPG'
            },
            body: JSON.stringify({
                model: worldData.model,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.9,
                max_tokens: 4000
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `Błąd HTTP: ${response.status}`);
        }

        const data = await response.json();
        worldData.plan = data.choices[0].message.content;
        worldData.generated = true;

        // Wyświetl plan
        elements.worldPlanContent.innerHTML = `<div style="white-space: pre-wrap; color: #eaeaea;">${escapeHtml(worldData.plan)}</div>`;
        
        // Aktualizuj podgląd
        updateWorldPreview();

    } catch (error) {
        console.error('Błąd generowania planu:', error);
        elements.worldPlanContent.innerHTML = `<div style="color: #e74c3c; padding: 20px;">❌ Błąd: ${error.message}</div>`;
    } finally {
        elements.generateWorldPlanBtn.disabled = false;
    }
}

// Aktualizacja podglądu świata
function updateWorldPreview() {
    if (!worldData.plan) {
        elements.worldPreviewContent.innerHTML = '<p style="color: #888; text-align: center; padding: 40px;">Wygeneruj plan świata, aby zobaczyć podgląd</p>';
        return;
    }

    const preview = `
        <h3>🌍 ${worldData.name}</h3>
        <p><strong>Zakres:</strong> ${elements.worldScope.options[elements.worldScope.selectedIndex].text}</p>
        <p><strong>Złożoność:</strong> ${elements.worldComplexity.options[elements.worldComplexity.selectedIndex].text}</p>
        <p><strong>Model planowania:</strong> ${elements.worldModel.options[elements.worldModel.selectedIndex].text}</p>
        
        <h4>📋 Plan świata:</h4>
        <div style="white-space: pre-wrap; font-size: 0.9rem; color: #ddd; max-height: 400px; overflow-y: auto;">
            ${escapeHtml(worldData.plan.substring(0, 2000))}...
        </div>
    `;
    
    elements.worldPreviewContent.innerHTML = preview;
}

// Start gry ze świata
function startGameWithWorld() {
    if (!worldData.generated || !worldData.plan) {
        alert('Wygeneruj plan świata najpierw!');
        return;
    }
    
    showCharacterCreation();
}

// Budowanie system promptu dla narratora
function buildNarratorPrompt() {
    const settingDescriptions = {
        fantasy: 'Świat fantasy - średniowieczny z magią, smokami, elfami, krasnoludami i potworami.',
        scifi: 'Świat science fiction - przyszłość, kosmos, zaawansowana technologia, obce rasy.',
        postapo: 'Post-apokaliptyczny świat - zniszczona cywilizacja, radiacja, mutanty, walka o przetrwanie.',
        cyberpunk: 'Cyberpunk - megamiasto, korporacje rządzą światem, hakerzy, cybernetyczne implanty.',
        horror: 'Horror - mroczny świat, nadprzyrodzone zagrożenia, strach, niewyjaśnione zjawiska.',
        modern: 'Współczesny świat - dzisiejsze czasy, miasta, technologia, kryminał, polityka.',
        historical: 'Historyczny - starożytność lub inna epoka historyczna, autentyczne realia.',
        custom: elements.customSetting.value
    };

    const adventureDescriptions = {
        epic: 'Epicka podróż - misja o wadze światowej, ratowanie królestwa/świata.',
        mystery: 'Tajemnica - zagadka do rozwiązania, detektywistyczne śledztwo.',
        survival: 'Przetrwanie - walka o życie w nieprzyjaznym środowisku.',
        exploration: 'Eksploracja - odkrywanie nieznanego, mapowanie nowych terenów.',
        revenge: 'Zemsta - dążenie do ukarania tych, którzy wyrządzili krzywdę.',
        heist: 'Skok - napad, kradzież, intryga, precyzyjne planowanie.',
        romance: 'Romans - miłosna historia, relacje między postaciami.',
        open: 'Otwarta - gracz decyduje o kierunku fabuły.'
    };

    const s = characterData.sliders;

    let prompt = `Jesteś Mistrzem Gry (Narratorem) w grze RPG. Twoim zadaniem jest prowadzenie immersyjnej, szczegółowej przygody.

## ZASADY OGÓLNE:
1. Jesteś NARRATOREM, nie graczem. Opisujesz świat, NPCów, wydarzenia. NIGDY nie przejmujesz kontroli nad postacią gracza.
2. Pisz szczegółowo, zmysłowo, buduj napięcie i atmosferę.
3. Reaguj na akcje gracza realistycznie - jego decyzje mają konsekwencje.
4. Wprowadzaj nieoczekiwane zwroty akcji, ale zachowaj spójność fabularną.
5. Kontroluj NPCów - daj im osobowość, motywacje, tajemnice.
6. Nie spiesz się - rozwijaj sceny, dialogi, opisy otoczenia.
7. Zachęcaj gracza do podejmowania decyzji poprzez stawianie go przed wyborami.
8. Używaj formatowania: **pogrubienie** dla ważnych elementów, *kursywa* dla myśli.

## PLAN ŚWIATA (TRZYMAJ SIĘ TEGO):
${worldData.plan ? worldData.plan : 'Brak planu - stwórz własny świat'}

## USTAWIENIA GRY:
**Świat:** ${settingDescriptions[characterData.setting]}
**Typ przygody:** ${adventureDescriptions[characterData.adventureType]}

## POZIOMY TREŚCI (skala 1-10):

### 💀 BRUTALNOŚĆ / PRZEMOC: ${s.violence}/10
${getLevelDescription('violence', s.violence)}
${s.violence >= 5 ? 'Opisuj szczegółowo rany, krew, cierpienie, fizyczne konsekwencje walk.' : 'Umiarkowane opisy przemocy.'}
${s.violence >= 8 ? 'Możesz zawierać rozczłonkowanie, tortury, sadystyczne detale.' : ''}

### 🔞 EROTYKA / SEKS: ${s.sexual}/10
${getLevelDescription('sexual', s.sexual)}
${s.sexual >= 5 ? 'Opisuj szczegółowo sceny erotyczne, akty seksualne, napięcie między postaciami.' : 'Tylko sugestie romantyczne.'}
${s.sexual >= 8 ? 'Możesz zawierać BDSM, perwersje, tabu, szczegółowe opisy aktów.' : ''}

### 🌑 MROCZNOŚĆ: ${s.darkness}/10
${getLevelDescription('darkness', s.darkness)}
${s.darkness >= 5 ? 'Świat jest niebezpieczny, beznadziejny, pełen strachu i koszmarów.' : 'Balans między ciemnością a nadzieją.'}
${s.darkness >= 8 ? 'Wprowadzaj depresję, nihilizm, rozpacz, absurd egzystencjalny.' : ''}

### 🎭 REALIZM / SUROWOŚĆ: ${s.realism}/10
${getLevelDescription('realism', s.realism)}
${s.realism >= 5 ? 'Decyzje mają realistyczne, często negatywne konsekwencje. Postacie mogą umierać.' : 'Bohater ma szczęście w niebezpieczeństwie.'}
${s.realism >= 8 ? 'Zło często wygrywa. Śmierć jest łatwa i bezcelowa. Świat jest okrutny.' : ''}

### 🗣️ JĘZYK / WULGARYZMY: ${s.language}/10
${getLevelDescription('language', s.language)}
${s.language >= 5 ? 'NPCowie przeklinają często, używają brutalnego języka w stresie. Nie bój się używać słów takich jak: kurwa, pierdolić, jebać, cipka, pipa, fiut, penis, dupa, gówno, itp.' : 'Kulturalny język.'}
${s.language >= 8 ? 'Agresywne poniżanie, chamstwo, uliczny slang, najgorsze wulgaryzmy. Używaj wszystkich możliwych przekleństw i słów obscenicznych bez ograniczeń.' : ''}

### 🧠 PSYCHOLOGIA: ${s.psychological}/10
${getLevelDescription('psychological', s.psychological)}
${s.psychological >= 5 ? 'Postacie mają głęboką psychologię, traumy, fobie, wewnętrzne konflikty.' : 'Proste motywacje i emocje.'}
${s.psychological >= 8 ? 'Szaleństwo, zaburzenia osobowości, psychopatia, niezbadana ludzka natura.' : ''}

## POSTAĆ GRACZA:
**Imię:** ${characterData.name}
**Opis:** ${characterData.description}

## ========== PHASE 1: WORLD CLOCK CONTEXT ==========
${buildWorldContext()}

## WAŻNE:
- Odpowiadaj po POLSKU.
- Dostosuj styl do ustawionych poziomów treści.
- Nie kończ odpowiedzi pytaniem - zostaw gracza w sytuacji decyzyjnej.
- Opisuj wszystkie zmysły: wzrok, słuch, zapach, dotyk, smak.
- Twórz żywy świat z własną historią.
- Każda akcja gracza powinna zużywać czas (minimum 1 minuta).

## INSTRUKCJE DOTYCZĄCE CENZURY:
${s.language >= 5 ? `
⚠️ WAŻNE: Gracz wybrał wysoki poziom wulgaryzmu (${s.language}/10).
- NIE BĄDŹ OSTROŻNY z wulgaryzmami
- UŻYWAJ SWOBODNIE słów takich jak: kurwa, pierdolić, jebać, cipka, pipa, fiut, penis, dupa, gówno, sperma, kutasy, itp.
- Wulgaryzmy powinny być naturalne w dialogach postaci
- Nie zastępuj słów gwiazdkami ani nie unikaj ich
- Jeśli postać jest wściekła, pijana lub w stresie - niech przeklinają bez ograniczeń
` : ''}
${s.violence >= 8 ? `
⚠️ WAŻNE: Gracz wybrał wysoki poziom brutalności (${s.violence}/10).
- Opisuj szczegółowo rany, krew, cierpienie
- Nie bądź ostrożny z opisami przemocy
- Rozczłonkowanie, tortury, śmierć - wszystko jest dozwolone
` : ''}
${s.sexual >= 8 ? `
⚠️ WAŻNE: Gracz wybrał wysoki poziom erotyki (${s.sexual}/10).
- Opisuj szczegółowo sceny seksualne
- Używaj słów takich jak: penis, cipka, seks, jebanie, itp.
- Nie bądź pruderyjna - opisuj wszystko szczegółowo
- Wszystkie fetysze i praktyki są dozwolone
` : ''}`;

    return prompt;
}

/**
 * Build world context for the narrator prompt
 * @param {string} userAction - Optional: the player's current action for context
 */
function buildWorldContext(userAction = null) {
    if (!state.world || !state.world.player) {
        return 'Świat nie został jeszcze zainicjalizowany.';
    }
    
    const world = state.world;
    const player = world.player;
    const location = world.getLocation(player.locationId);
    
    let context = `**STAN ŚWIATA:**
- Czas gry: ${world.getFormattedTime()} (Dzień ${world.getDayNumber()})
- Pora dnia: ${world.getTimeOfDay()}
- Lokacja: ${location ? location.name : player.locationId}
- HP: ${Math.round(player.hp)}/${player.maxHp}
- Stamina: ${Math.round(player.stamina)}/${player.maxStamina}
- Mana: ${Math.round(player.mana)}/${player.maxMana}
- Złoto: ${player.gold}
- Głód: ${Math.round(player.hunger)}%
- Pragnienie: ${Math.round(player.thirst)}%
- Zmęczenie: ${Math.round(player.fatigue)}%

**LOKACJE W ŚWIECIE:**
`;
    
    for (const loc of world.locations.values()) {
        context += `\n- **${loc.name}** (${loc.id}): Populacja ${loc.population}, Bogactwo ${Math.round(loc.wealth)}/100, Stabilność ${Math.round(loc.stability)}/100, Niebezpieczeństwo ${Math.round(loc.dangerLevel)}/100`;
    }
    
    context += `\n\n**FRAKCJE:**`;
    for (const faction of world.factions.values()) {
        const playerRep = player.getReputation(faction.id);
        context += `\n- **${faction.name}** (${faction.id}): Siła ${Math.round(faction.power)}/100, Zasoby ${Math.round(faction.resources)}/100, Reputacja gracza: ${playerRep > 0 ? '+' : ''}${playerRep}`;
    }
    
    if (player.statusEffects.length > 0) {
        context += `\n\n**EFEKTY STATUSOWE:**`;
        for (const effect of player.statusEffects) {
            context += `\n- ${effect.name} (${Math.round(effect.remainingMinutes)} minut pozostało)`;
        }
    }
    
    if (player.storyFlags.size > 0) {
        context += `\n\n**FLAGI FABULARNE:**`;
        for (const flag of player.storyFlags) {
            context += `\n- ${flag}`;
        }
    }
    
    // Phase 4: Add contextual memory if available
    if (world.historyNodes && world.historyNodes.length > 0) {
        const sceneType = determineSceneType(userAction || "");
        const sceneTags = extractSceneTags(userAction || "");
        const memoryContext = buildMemoryContext(world, sceneType, sceneTags);
        
        if (memoryContext) {
            context += `\n\n**KONTEKST HISTORYCZNY (ostatnie wydarzenia):**`;
            context += memoryContext;
        }
    }
    
    return context;
}

// Phase 4: Determine scene type from user action
function determineSceneType(actionText) {
    const lowerAction = actionText.toLowerCase();
    
    if (lowerAction.includes("rozmawia") || lowerAction.includes("pytaj") || lowerAction.includes("powiedz") || 
        lowerAction.includes("dzień dobry") || lowerAction.includes("witaj") || lowerAction.includes("dziękuj")) {
        return "dialog";
    }
    if (lowerAction.includes("atak") || lowerAction.includes("walcz") || lowerAction.includes("zabij") || 
        lowerAction.includes("uderz") || lowerAction.includes("broni")) {
        return "combat";
    }
    if (lowerAction.includes("eksploruj") || lowerAction.includes("szukaj") || lowerAction.includes("idź do") || 
        lowerAction.includes("odkryj")) {
        return "exploration";
    }
    if (lowerAction.includes("kup") || lowerAction.includes("sprzedaj") || lowerAction.includes("targuj") || 
        lowerAction.includes("handel")) {
        return "trade";
    }
    if (lowerAction.includes("odpocznij") || lowerAction.includes("śpij") || lowerAction.includes("leczenie")) {
        return "rest";
    }
    if (lowerAction.includes("podróż") || lowerAction.includes("wędruj") || lowerAction.includes("idź do")) {
        return "travel";
    }
    
    return "default";
}

// Phase 4: Extract scene tags from user action
function extractSceneTags(actionText) {
    const tags = [];
    const lowerAction = actionText.toLowerCase();
    
    // Player initiated
    if (lowerAction.startsWith("chcę") || lowerAction.startsWith("idę") || lowerAction.startsWith("robię")) {
        tags.push("player_action");
    }
    
    // NPC interaction
    if (lowerAction.includes("npc") || lowerAction.includes("postaci") || lowerAction.includes("rozmowa")) {
        tags.push("npc_interaction");
    }
    
    // Combat
    if (lowerAction.includes("walcz") || lowerAction.includes("atak") || lowerAction.includes("broń")) {
        tags.push("combat");
    }
    
    // Political
    if (lowerAction.includes("król") || lowerAction.includes("królestwo") || lowerAction.includes("frankcja") || 
        lowerAction.includes("wojna") || lowerAction.includes("sojusz")) {
        tags.push("political");
    }
    
    // Economic
    if (lowerAction.includes("gold") || lowerAction.includes("pieniądze") || lowerAction.includes("kup") || 
        lowerAction.includes("sprzedaj")) {
        tags.push("economic");
    }
    
    // Exploration
    if (lowerAction.includes("eksploruj") || lowerAction.includes("szukaj") || lowerAction.includes("mapa")) {
        tags.push("exploration");
    }
    
    // Social
    if (lowerAction.includes("rozmowa") || lowerAction.includes("przyjaciel") || lowerAction.includes("wróg")) {
        tags.push("social");
    }
    
    // Danger
    if (lowerAction.includes("niebezpieczeństwo") || lowerAction.includes("pułapka") || lowerAction.includes("zagrożenie")) {
        tags.push("danger");
    }
    
    return tags;
}

// Phase 4: Build memory context from history nodes
function buildMemoryContext(world, sceneType, sceneTags) {
    if (!world.buildContextForScene) return null;
    
    try {
        const context = world.buildContextForScene(sceneType, sceneTags);
        
        if (!context.historyNodes || context.historyNodes.length === 0) {
            return null;
        }
        
        let memoryText = "";
        
        for (const node of context.historyNodes) {
            memoryText += `\n- ${node.summaryText}`;
        }
        
        return memoryText;
    } catch (e) {
        console.warn("Error building memory context:", e);
        return null;
    }
}

// Rozpoczęcie gry
async function startGame() {
    // Zbierz dane postaci
    characterData.name = elements.charName.value.trim();
    characterData.setting = elements.charSetting.value;
    characterData.description = elements.charDescription.value.trim();
    characterData.adventureType = elements.adventureType.value;
    characterData.tone = elements.toneTon.value;
    
    // Zbierz wartości suwaków
    characterData.sliders = {
        violence: parseInt(elements.violenceLevel.value),
        sexual: parseInt(elements.sexualLevel.value),
        darkness: parseInt(elements.darknessLevel.value),
        realism: parseInt(elements.realismLevel.value),
        language: parseInt(elements.languageLevel.value),
        psychological: parseInt(elements.psychologicalLevel.value)
    };

    // Walidacja
    if (!characterData.name) {
        alert('Podaj imię postaci');
        return;
    }
    if (!characterData.description) {
        alert('Opisz swoją postać');
        return;
    }
    if (characterData.setting === 'custom' && !elements.customSetting.value.trim()) {
        alert('Opisz swój własny świat');
        return;
    }
    if (!state.model) {
        alert('Wybierz model AI');
        return;
    }

    // Zapisz nazwę settingu
    characterData.settingName = settingNames[characterData.setting];

    // Pokaż sekcję gry
    elements.characterCreation.classList.add('hidden');
    elements.gameSection.classList.remove('hidden');
    elements.gameCharacterName.textContent = characterData.name;
    elements.gameSetting.textContent = characterData.settingName;

    // Wyczyść historię
    state.storyHistory = [];
    elements.gameStory.innerHTML = '';

    // ========== PHASE 1: Initialize World Engine ==========
    // Create starter world with default locations and factions
    state.world = World.createStarterWorld(characterData.name, 'town_central');
    
    // Update HUD with initial world state
    updateGameHUD();

    // Inicjalizuj konwersację z system promptem
    state.gameState = [
        { role: 'system', content: buildNarratorPrompt() }
    ];

    // Dodaj wiadomość inicjalizującą z podsumowaniem ustawień
    const s = characterData.sliders;
    addStoryEntry('system', `Rozpoczynasz nową przygodę...\n\nUstawienia: 💀${s.violence} 🔞${s.sexual} 🌑${s.darkness} 🎭${s.realism} 🗣️${s.language} 🧠${s.psychological}`);

    // Poproś AI o rozpoczęcie historii
    await generateStory('Rozpocznij przygodę. Przedstaw scenę otwarcia: gdzie jest postać, co robi, co widzi wokół siebie. Ustaw scenę dla pierwszej decyzji gracza.');
}

// Generowanie historii przez AI
async function generateStory(userAction = null) {
    if (state.isLoading) return;

    state.isLoading = true;
    elements.sendActionBtn.disabled = true;
    elements.suggestActionsBtn.disabled = true;

    // Dodaj akcję gracza jeśli istnieje
    if (userAction) {
        state.gameState.push({ role: 'user', content: userAction });
    }

    // Pokaż wskaźnik ładowania
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'story-entry loading-entry';
    loadingDiv.innerHTML = '<div class="story-narrator">Narrator pisze...</div><div class="story-text">Tworzę historię...</div>';
    elements.gameStory.appendChild(loadingDiv);
    elements.gameStory.scrollTop = elements.gameStory.scrollHeight;

    // Phase 4: Build contextual memory for LLM
    let memoryContext = '';
    if (state.world && state.world.buildContextForScene && userAction) {
        try {
            const sceneType = determineSceneType(userAction);
            const sceneTags = extractSceneTags(userAction);
            const context = state.world.buildContextForScene(sceneType, sceneTags);
            
            if (context && context.historyNodes && context.historyNodes.length > 0) {
                memoryContext = '\n\n## KONTEKST HISTORYCZNY:\n';
                for (const node of context.historyNodes) {
                    memoryContext += `- ${node.summaryText}\n`;
                }
            }
        } catch (e) {
            console.warn("Error building memory context:", e);
        }
    }

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'AI RPG'
            },
            body: JSON.stringify({
                model: state.model,
                messages: memoryContext 
                    ? [...state.gameState.slice(0, -1), { role: state.gameState[state.gameState.length - 1].role, content: state.gameState[state.gameState.length - 1].content + memoryContext }]
                    : state.gameState,
                temperature: 0.9,
                max_tokens: 2000
            })
        });

        // Usuń wskaźnik ładowania
        loadingDiv.remove();

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error?.message || `Błąd HTTP: ${response.status}`);
        }

        const data = await response.json();
        const storyText = data.choices[0].message.content;

        // Dodaj do historii
        state.gameState.push({ role: 'assistant', content: storyText });

        // ========== PHASE 1: Advance World Time ==========
        // Simulate time passage for this action (default: 10 minutes per narrative turn)
        if (state.world) {
            const timeAdvance = 10; // minutes
            state.world.advanceWorldTime(timeAdvance);
            
            // Log the action as a world change
            const worldChange = new WorldChange(
                'conversation_happened',
                null,
                true,
                `Player action: ${userAction ? userAction.substring(0, 50) : 'narrative turn'}`,
                'local'
            );
            state.world.logWorldChange(worldChange);
            
            // Phase 4: Record player action for memory system
            if (userAction && state.world.recordPlayerAction) {
                state.world.recordPlayerAction('player_action', {
                    description: userAction.substring(0, 100),
                    scope: 'local'
                });
            }
            
            // Update HUD with new world state
            updateGameHUD();
        }

        // Wyświetl w grze
        addStoryEntry('narrator', storyText);

    } catch (error) {
        loadingDiv.remove();
        console.error('Błąd:', error);
        addStoryEntry('system', `Błąd: ${error.message}. Spróbuj ponownie.`);
    } finally {
        state.isLoading = false;
        elements.sendActionBtn.disabled = false;
        elements.suggestActionsBtn.disabled = false;
    }
}

// Dodanie wpisu do historii
function addStoryEntry(type, text) {
    const entryDiv = document.createElement('div');
    entryDiv.className = 'story-entry';

    if (type === 'narrator') {
        entryDiv.innerHTML = `
            <div class="story-narrator">🎲 Narrator</div>
            <div class="story-text">${formatStoryText(text)}</div>
        `;
    } else if (type === 'player') {
        entryDiv.innerHTML = `
            <div class="story-player">
                <div class="story-player-label">⚔️ ${characterData.name}</div>
                <div>${escapeHtml(text)}</div>
            </div>
        `;
    } else if (type === 'system') {
        entryDiv.innerHTML = `
            <div class="story-text" style="color: #ffd700; font-style: italic; text-align: center; padding: 20px;">${escapeHtml(text)}</div>
        `;
    }

    elements.gameStory.appendChild(entryDiv);
    elements.gameStory.scrollTop = elements.gameStory.scrollHeight;
}

// Formatowanie tekstu historii (markdown)
function formatStoryText(text) {
    // Zamień **tekst** na <strong>
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Zamień *tekst* na <em>
    text = text.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Zamień nowe linie na <br>
    text = text.replace(/\n/g, '<br>');
    return text;
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========== PHASE 1: HUD Update Function ==========
/**
 * Update the game HUD with current world state
 */
function updateGameHUD() {
    if (!state.world || !state.world.player) return;
    
    const world = state.world;
    const player = world.player;
    
    // Time display
    elements.gameTime.textContent = world.getFormattedTime();
    elements.gameDay.textContent = world.getDayNumber();
    
    // Location
    const location = world.getLocation(player.locationId);
    elements.playerLocation.textContent = location ? location.name : player.locationId;
    
    // Health
    elements.playerHp.textContent = `${Math.round(player.hp)}/${player.maxHp}`;
    
    // Stamina
    elements.playerStamina.textContent = `${Math.round(player.stamina)}/${player.maxStamina}`;
    
    // Mana
    elements.playerMana.textContent = `${Math.round(player.mana)}/${player.maxMana}`;
    
    // Gold
    elements.playerGold.textContent = player.gold;
    
    // Survival stats
    elements.playerHunger.textContent = `${Math.round(player.hunger)}%`;
    elements.playerThirst.textContent = `${Math.round(player.thirst)}%`;
    elements.playerFatigue.textContent = `${Math.round(player.fatigue)}%`;
    
    // Add warning class if survival stats are critical
    updateSurvivalWarnings(player);
}

/**
 * Update visual warnings for critical survival stats
 */
function updateSurvivalWarnings(player) {
    const hungerElement = elements.playerHunger;
    const thirstElement = elements.playerThirst;
    const fatigueElement = elements.playerFatigue;
    
    // Hunger warning
    if (player.hunger >= 80) {
        hungerElement.classList.add('warning');
    } else {
        hungerElement.classList.remove('warning');
    }
    
    // Thirst warning
    if (player.thirst >= 80) {
        thirstElement.classList.add('warning');
    } else {
        thirstElement.classList.remove('warning');
    }
    
    // Fatigue warning
    if (player.fatigue >= 80) {
        fatigueElement.classList.add('warning');
    } else {
        fatigueElement.classList.remove('warning');
    }
}

// Wysłanie akcji gracza
async function sendAction() {
    const action = elements.playerAction.value.trim();
    
    if (!action || state.isLoading) return;

    elements.playerAction.value = '';
    addStoryEntry('player', action);
    
    // Check if in multiplayer mode
    if (state.isMultiplayer) {
        await sendMultiplayerAction(action);
    } else {
        await generateStory(action);
    }
}

// Sugerowanie akcji
async function suggestActions() {
    if (state.isLoading) return;

    state.isLoading = true;
    elements.suggestActionsBtn.disabled = true;

    // Usuń poprzednie sugestie
    const oldSuggestions = document.querySelector('.suggested-actions');
    if (oldSuggestions) oldSuggestions.remove();

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.apiKey}`,
                'HTTP-Referer': window.location.href,
                'X-Title': 'AI RPG'
            },
            body: JSON.stringify({
                model: state.model,
                messages: [
                    ...state.gameState,
                    { role: 'user', content: 'Jako narrator, zaproponuj 3-4 możliwe akcje jakie gracz mógłby teraz podjąć. Bądź kreatywny. Odpowiedz tylko listą akcji, każda w nowej linii, bez numeracji.' }
                ],
                temperature: 0.8,
                max_tokens: 300
            })
        });

        if (!response.ok) throw new Error('Błąd pobierania sugestii');

        const data = await response.json();
        const suggestions = data.choices[0].message.content.split('\n').filter(s => s.trim());

        // Wyświetl sugestie
        const suggestionsDiv = document.createElement('div');
        suggestionsDiv.className = 'suggested-actions';
        suggestionsDiv.innerHTML = '<h4>💡 Sugerowane akcje:</h4>';

        suggestions.forEach(suggestion => {
            const cleanSuggestion = suggestion.replace(/^[-\d.\s]+/, '').trim();
            if (cleanSuggestion) {
                const btn = document.createElement('button');
                btn.className = 'suggested-action-btn';
                btn.textContent = cleanSuggestion;
                btn.onclick = () => {
                    elements.playerAction.value = cleanSuggestion;
                    suggestionsDiv.remove();
                };
                suggestionsDiv.appendChild(btn);
            }
        });

        elements.gameStory.appendChild(suggestionsDiv);
        elements.gameStory.scrollTop = elements.gameStory.scrollHeight;

    } catch (error) {
        console.error('Błąd sugestii:', error);
    } finally {
        state.isLoading = false;
        elements.suggestActionsBtn.disabled = false;
    }
}

// Pokazanie modala z postacią
function showCharacterModal() {
    const s = characterData.sliders;
    elements.characterDetails.innerHTML = `
        <h3>🧙 Imię</h3>
        <p>${characterData.name}</p>
        
        <h3>🌍 Świat</h3>
        <p>${characterData.settingName}</p>
        
        <h3>📝 Opis</h3>
        <p>${characterData.description.replace(/\n/g, '<br>')}</p>
        
        <h3>🎯 Typ przygody</h3>
        <p>${elements.adventureType.options[elements.adventureType.selectedIndex].text}</p>
        
        <h3>🎚️ Poziomy treści</h3>
        <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 8px; margin-top: 10px;">
            <p><strong>💀 Brutalność:</strong> ${s.violence}/10 - ${getLevelDescription('violence', s.violence)}</p>
            <p><strong>🔞 Erotyka:</strong> ${s.sexual}/10 - ${getLevelDescription('sexual', s.sexual)}</p>
            <p><strong>🌑 Mroczność:</strong> ${s.darkness}/10 - ${getLevelDescription('darkness', s.darkness)}</p>
            <p><strong>🎭 Realizm:</strong> ${s.realism}/10 - ${getLevelDescription('realism', s.realism)}</p>
            <p><strong>🗣️ Język:</strong> ${s.language}/10 - ${getLevelDescription('language', s.language)}</p>
            <p><strong>🧠 Psychologia:</strong> ${s.psychological}/10 - ${getLevelDescription('psychological', s.psychological)}</p>
        </div>
    `;
    elements.characterModal.classList.remove('hidden');
}

// Ukrycie modala
function hideCharacterModal() {
    elements.characterModal.classList.add('hidden');
}

// Generowanie nazwy pliku z datą
function generateFileName() {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
    const charName = characterData.name.replace(/[^a-z0-9]/gi, '_');
    return `RPG_${charName}_${dateStr}_${timeStr}.json`;
}

// Zapisanie gry do pliku JSON
function saveGameToFile() {
    if (!characterData.name || state.gameState.length === 0) {
        alert('Nie ma aktywnej gry do zapisania!');
        return;
    }

    const saveData = {
        character: characterData,
        gameState: state.gameState,
        story: elements.gameStory.innerHTML,
        timestamp: new Date().toISOString(),
        version: '1.1',
        // ========== PHASE 1: Save World State ==========
        world: state.world ? state.world.toJSON() : null
    };
    
    // Zapisz w localStorage jako ostatni save
    localStorage.setItem('rpg_save', JSON.stringify(saveData));
    
    // Eksportuj do pliku
    const dataStr = JSON.stringify(saveData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = generateFileName();
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    alert(`Gra zapisana!\n\nPlik: ${link.download}\n\nZnajdziesz go w folderze Pobrane.`);
}

// Eksport gry do JSON (kopia zapasowa)
function exportGameToJSON() {
    saveGameToFile();
}

// Wczytanie gry z pliku
function loadGameFromFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const saveData = JSON.parse(event.target.result);
                applyLoadedGame(saveData);
            } catch (error) {
                alert('Błąd wczytywania pliku: ' + error.message);
            }
        };
        reader.readAsText(file);
    };
    
    input.click();
}

// Import gry z pliku (przez input)
function importGameFromFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const saveData = JSON.parse(event.target.result);
            applyLoadedGame(saveData);
        } catch (error) {
            alert('Błąd importu pliku: ' + error.message);
        }
    };
    reader.readAsText(file);
}

// Zastosowanie wczytanych danych gry
function applyLoadedGame(saveData) {
    if (!saveData.character || !saveData.gameState) {
        alert('Nieprawidłowy plik zapisu!');
        return;
    }
    
    // Przywróć dane postaci
    characterData = saveData.character;
    state.gameState = saveData.gameState;
    
    // ========== PHASE 1: Restore World State ==========
    if (saveData.world) {
        state.world = World.fromJSON(saveData.world);
    } else {
        // Fallback: create new world if not in save file
        state.world = World.createStarterWorld(characterData.name, 'town_central');
    }
    
    // Pokaż sekcję gry
    elements.characterCreation.classList.add('hidden');
    elements.gameSection.classList.remove('hidden');
    elements.gameCharacterName.textContent = characterData.name;
    elements.gameSetting.textContent = characterData.settingName || 'Własny';
    
    // Update HUD with restored world state
    updateGameHUD();
    
    // Przywróć historię
    if (saveData.story) {
        elements.gameStory.innerHTML = saveData.story;
    } else {
        elements.gameStory.innerHTML = '';
        // Odtwórz historię z gameState
        state.gameState.forEach(msg => {
            if (msg.role === 'assistant') {
                addStoryEntry('narrator', msg.content);
            } else if (msg.role === 'user') {
                addStoryEntry('player', msg.content);
            }
        });
    }
    
    const date = new Date(saveData.timestamp);
    addStoryEntry('system', `Gra wczytana z: ${date.toLocaleString()}`);
    
    alert(`Gra wczytana!\n\nPostać: ${characterData.name}\nData zapisu: ${date.toLocaleString()}`);
}

// Wyświetlanie listy zapisanych gier
function displaySavedGames() {
    const saves = [];
    
    // Sprawdź localStorage
    const localSave = localStorage.getItem('rpg_save');
    if (localSave) {
        try {
            const data = JSON.parse(localSave);
            saves.push({ ...data, source: 'local', name: 'Ostatni autosave' });
        } catch (e) {}
    }
    
    if (saves.length === 0) {
        elements.savedGamesList.innerHTML = '<p class="no-saves">Brak zapisanych gier. Rozpocznij nową grę i zapisz ją!</p>';
        return;
    }
    
    elements.savedGamesList.innerHTML = saves.map((save, index) => {
        const date = new Date(save.timestamp);
        const s = save.character.sliders || {};
        return `
            <div class="saved-game-item">
                <div class="saved-game-info">
                    <h4>${save.character.name}</h4>
                    <p>${save.character.settingName || 'Własny świat'} • ${date.toLocaleString()}</p>
                    <div class="saved-game-sliders">
                        💀${s.violence || '?'} 🔞${s.sexual || '?'} 🌑${s.darkness || '?'} 🎭${s.realism || '?'}
                    </div>
                </div>
                <div class="saved-game-actions">
                    <button onclick="loadGameByIndex(${index})" class="btn-primary">Wczytaj</button>
                    <button onclick="deleteGame(${index})" class="btn-secondary">Usuń</button>
                </div>
            </div>
        `;
    }).join('');
}

// Wczytanie gry po indeksie
function loadGameByIndex(index) {
    const saveData = JSON.parse(localStorage.getItem('rpg_save'));
    if (saveData) {
        applyLoadedGame(saveData);
    }
}

// Usunięcie gry
function deleteGame(index) {
    if (confirm('Czy na pewno chcesz usunąć ten zapis?')) {
        localStorage.removeItem('rpg_save');
        displaySavedGames();
    }
}

// Nowa gra
function newGame() {
    if (confirm('Czy na pewno chcesz rozpocząć nową grę? Obecny postęp zostanie utracony.')) {
        state.gameState = [];
        state.storyHistory = [];
        elements.gameStory.innerHTML = '';
        showCharacterCreation();
    }
}

// (stare funkcje usunięte - zastąpione nowym systemem RPG)

// Uruchom aplikację - z defer skrypty ładują się po DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    // DOM już gotowy
    init();
}
