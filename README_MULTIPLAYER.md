# Multiplayer RPG - Deployment Guide

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
3. In "Multiplayer" section, enter a Room ID (or leave blank to auto-generate)
4. Click "Stwórz nowy pokój" (Create new room)
5. Share the Room ID with your friend

### Join (Player 2)
1. Open the game
2. Enter your character details  
3. In "Multiplayer" section:
   - Enter the Server URL (e.g., `your-app.up.railway.app`)
   - Enter the Room ID from your friend
4. Click "Dołącz do pokoju" (Join room)

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
