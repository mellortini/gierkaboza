# Multiplayer RPG - Deployment Guide

## Konta, znajomi i zaproszenia

Multiplayer ma teraz warstwę kont. W wersji testowej są przygotowane dwa konta:

| Login | Hasło | Znajomy |
|---|---|---|
| `mat` | wartość `RPG_MAT_PASSWORD` | `rob` |
| `rob` | wartość `RPG_ROB_PASSWORD` | `mat` |

Po zalogowaniu panel konta pokazuje status znajomych oraz oczekujące zaproszenia. Host może wysłać zaproszenie do aktywnego pokoju przyciskiem `Zaproś do gry`. Drugi gracz przyjmuje je na swoim koncie, a ID pokoju zostaje automatycznie wpisane w sekcji multiplayer.

Hasła nie są przechowywane w repozytorium. Serwer tworzy hash scrypt przy pierwszym seedowaniu kont na podstawie zmiennych `RPG_MAT_PASSWORD` i `RPG_ROB_PASSWORD`. Aby zachować ustalone hasło testowe, ustaw obie zmienne na `123` w Railway. Stan sesji, znajomych i zaproszeń jest zapisywany w `data/auth.json`, podobnie jak pokoje w `data/rooms.json`.

Na Railway trzeba ustawić `RPG_DATA_DIR` na zamontowany Volume albo później podłączyć adapter PostgreSQL. Bez trwałego dysku konta testowe odtworzą się z seeda po restarcie, ale aktywne sesje i zaproszenia mogą zostać utracone.

### API kont

- `POST /api/auth/login` — logowanie i token sesji;
- `GET /api/auth/me` — konto, znajomi i zaproszenia;
- `POST /api/friends/request` — zaproszenie do znajomych;
- `POST /api/friends/:username/accept` — akceptacja znajomego;
- `POST /api/invites` — zaproszenie znajomego do aktywnego pokoju;
- `POST /api/invites/:inviteId/accept` — przyjęcie zaproszenia do pokoju.

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Server
```bash
npm start
```

### 3. Play
- Open `http://localhost:3000` in your browser
- Enter your OpenRouter API key
- Create your character
- Use the Multiplayer section to create/join a room

## 🌐 Deploy to Railway

### Option 1: Deploy from GitHub (Recommended)

1. **Push your code to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Add multiplayer support"
   git remote add origin https://github.com/YOUR_USERNAME/rpg-game.git
   git push -u origin main
   ```

2. **Deploy on Railway**
   - Go to [railway.app](https://railway.app)
   - Sign in with GitHub
   - Click "New Project" → "Deploy from GitHub repo"
   - Select your repository
   - Railway will automatically detect Node.js and deploy

3. **Get your URL**
   - After deployment, Railway provides a URL like `your-app-name.up.railway.app`
   - Share this URL with your friend

### Option 2: Deploy from CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Deploy
railway up
```

## 🎮 How to Play Multiplayer

### Host (Player 1)
1. Open the game
2. Enter your character details
3. In the "Multiplayer" section, choose a campaign in "Scenariusz kampanii".
   For the prepared campaign choose "Popioły pod Zieloną Doliną".
4. Leave "Źródło świata" as "Świat z wybranego scenariusza".
5. Enter a Room ID (or leave blank to auto-generate).
6. Click "Stwórz nowy pokój" (Create new room).
7. Share the Room ID with your friend.

### Join (Player 2)
1. Open the game
2. Enter your character details  
3. In "Multiplayer" section:
   - Enter the Server URL (e.g., `your-app.up.railway.app`)
   - Enter the Room ID from your friend
   - The scenario selector is informational when joining; the host's campaign is authoritative.
4. Click "Dołącz do pokoju" (Join room)

### Lobby kampanii i postaci

Po dołączeniu do nowego pokoju gracze nie trafiają od razu do gry. Najpierw pojawia się lobby:

1. Host wybiera kampanię bezpośrednio w polu „Scenariusz kampanii”. Można też wcześniej wczytać ją w zakładce „Plan Świata”.
2. Host zostawia „Świat z wybranego scenariusza” i wybiera „Stwórz nowy pokój”. Serwer ładuje scenariusz po identyfikatorze, więc sama nazwa świata nie może przypadkiem uruchomić domyślnego świata.
3. Każdy uczestnik widzi nazwę oraz opis wspólnej kampanii.
4. Każdy może dodać kilka własnych postaci z opisami, ale wybierać i usuwać może tylko swoje postacie.
5. Każdy wybiera postać, którą chce prowadzić, i klika „Jestem gotowy”.
6. Gdy wszyscy aktywni gracze są gotowi, host klika „Host: rozpocznij grę”.

Lobby nie przesyła kluczy API ani tajnego briefu reżysera. Po starcie serwer wysyła każdemu wybraną postać oraz właściwy snapshot wspólnego świata. Lista scenariuszy jest publicznym katalogiem metadanych (`GET /api/scenarios`); sekrety pozostają po stronie serwera.

## 📁 Project Structure

```
rpg-game/
├── server.js          # Node.js + Socket.io server
├── package.json       # Dependencies
├── railway.json       # Railway deployment config
├── engine.js          # Game engine (World, entities)
├── app.js             # Client-side game logic
├── index.html         # Game UI
└── styles.css         # Styling
```

## 🔧 Configuration

### Environment Variables (Railway)
- `PORT` - Server port (default: 3000)
- `RPG_DATA_DIR` - opcjonalna ścieżka do trwałych zapisów, np. `/data` po podpięciu Railway Volume

### Trwałe zapisy na Railway

Serwer zapisuje pokoje, świat, wspólną oś tur, czat oraz pamięć narratora do `data/rooms.json`.
Na komputerze lokalnym plik pozostaje na dysku. Railway używa jednak efemerycznego systemu
plików, dlatego połącz aplikację z Volume i ustaw zmienną `RPG_DATA_DIR` na jego punkt montowania
(przykładowo `/data`). Bez Volume gra będzie działać, ale pokoje mogą zostać wyczyszczone po
ponownym uruchomieniu kontenera.

Po restarcie serwer odtwarza zapisany pokój, a gracz może wrócić tym samym ID pokoju. W multiplayerze
zapisywana jest także wspólna historia ostatnich tur, historia czatu i stan skondensowanej pamięci
narratora — nie tylko stan postaci hosta.

### Sandbox / pełna swoboda

Wybierz `Sandbox — pełna swoboda` i źródło `Sandbox — świat tworzony podczas gry`. Ten tryb nie
ładuje scenariusza, gotowej mapy, NPC ani zadań. Lokacja powstaje dopiero po podróży gracza, np.
`idę do karczmy`, `udaję się do lasu` albo `lecę na księżyc`. Odkryte miejsca są zapisywane i można
do nich wracać. Dla nowej kampanii użyj nowego ID pokoju — istniejący pokój zachowuje swój poprzedni
świat.

### Socket.io Events
- `joinRoom` - Join/create a game room
- `playerAction` - Send player action to server
- `chatMessage` - Send chat message
- `getRoomState` - Get current room state

## 🐛 Troubleshooting

### Connection Issues
- Make sure the server URL starts with `https://` on Railway
- Check that your firewall allows WebSocket connections

### API Key Issues
- Each player needs their own OpenRouter API key
- Keys are stored locally in browser, not on server

### Game State
- World state is synchronized between all players in the room
- Host's world state is authoritative

## 📝 License
MIT
