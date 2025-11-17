# Burrs.io - Multiplayer Spike Game

A real-time multiplayer spike game built with React, TypeScript, Canvas2D, and Socket.IO.

## Features

- **Multiplayer**: Real-time multiplayer with Socket.IO
- **Server-Authoritative**: All game logic runs on the server to prevent cheating
- **WASD Controls**: Smooth player movement with keyboard controls
- **Camera System**: Camera follows your spike and keeps it centered
- **Username System**: Automatic username generation for anonymous players
- **Map Boundaries**: Bounded game world with hard boundaries
- **Real-time Synchronization**: See all connected players in real-time

## Project Structure

```
burrs-io/
├── src/                  # Client-side code
│   ├── App.tsx          # Main React component
│   ├── App.css          # Styles
│   └── main.tsx         # Entry point
├── server/              # Server-side code
│   ├── gameServer.js    # Game server with Socket.IO
│   └── package.json     # Server dependencies
└── package.json         # Client dependencies
```

## Installation

1. Install client dependencies:
```bash
npm install
```

2. Install server dependencies:
```bash
cd server
npm install
cd ..
```

## Running the Game

Simply run one command to start both the client and server:

```bash
npm run dev
```

This will start:
- **Game Server** on port 5174
- **Client** on port 5173

Then open your browser to `http://localhost:5173`

### Alternative: Run Servers Separately

If you prefer to run them separately:

**Terminal 1 - Start the Client:**
```bash
npm run dev:client
```

**Terminal 2 - Start the Game Server:**
```bash
npm run dev:server
```

## How to Play

1. Enter your name (or leave empty for a random username like "UnnamedUser-XXXX")
2. Click "Play" to connect to the server
3. Use **WASD** keys to move your spike:
   - **W** - Move up
   - **A** - Move left
   - **S** - Move down
   - **D** - Move right
4. Your camera will follow your spike automatically
5. See other players' spikes and usernames in real-time

## Username System

- If you enter "noname" or leave the name field empty, the server generates a random username in the format: `UnnamedUser-XXXX` (where XXXX is a random 4-digit number)
- Usernames are validated and stored server-side to prevent client-side manipulation
- Maximum username length: 20 characters

## Technical Details

### Client (Port 5173)
- React + TypeScript
- Canvas2D for rendering
- Socket.IO client for real-time communication
- Vite for development and building

### Server (Port 5174)
- Node.js with Socket.IO
- Server-authoritative game state
- 60 tick rate for smooth gameplay
- Input validation and sanitization
- Map boundaries: 3000x3000 pixels

### Security Features
- Server-side validation for all game actions
- Authoritative server for game state and physics
- Client only sends input commands
- Username sanitization and validation

## Game Configuration

Server configuration can be modified in `server/gameServer.js`:
- `MAP_WIDTH`: 3000 (game world width)
- `MAP_HEIGHT`: 3000 (game world height)
- `PLAYER_SIZE`: 25 (spike radius)
- `PLAYER_SPEED`: 5 (movement speed)
- `TICK_RATE`: 60 (server updates per second)

## Development

The game uses:
- **React 18** for UI
- **TypeScript** for type safety
- **Socket.IO 4.7** for WebSocket communication
- **Vite 7** for fast development and building
- **Canvas2D** for high-performance rendering

## Testing Multiplayer

To test multiplayer functionality:
1. Start the server and client as described above
2. Open multiple browser windows/tabs to `http://localhost:5173`
3. Enter different names in each window
4. Click "Play" in each window
5. You should see all players' spikes moving in real-time across all windows

## License

MIT

