import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 5174;

// Game configuration
const GAME_CONFIG = {
  MAP_WIDTH: 4000,
  MAP_HEIGHT: 4000,
  PLAYER_SIZE: 30, // Base size for spikes
  PLAYER_SPEED: 3.5, // Reduced from 5 for slower movement
  TICK_RATE: 60, // Server updates per second
  FOOD_COUNT: 500, // Total food orbs on map
  PREMIUM_ORB_COUNT: 5, // Total premium orbs on map
};

// Food tier configuration (matches client)
const FOOD_TIERS = [
  { tier: 1, color: '#ff0055', xp: 5, weight: 40 },   // Most common - Neon Red
  { tier: 2, color: '#00ffff', xp: 10, weight: 25 },  // Common - Neon Cyan
  { tier: 3, color: '#00d4ff', xp: 15, weight: 15 },  // Uncommon - Neon Blue
  { tier: 4, color: '#ffff00', xp: 20, weight: 8 },   // Rare - Neon Yellow
  { tier: 5, color: '#b000ff', xp: 25, weight: 5 },   // Very Rare - Neon Purple
  { tier: 6, color: '#ff00ff', xp: 30, weight: 3 },   // Epic - Neon Pink
  { tier: 7, color: '#ff6600', xp: 35, weight: 2 },   // Legendary - Neon Orange
  { tier: 8, color: '#ff4500', xp: 40, weight: 1 },   // Mythic - Neon Coral
  { tier: 9, color: '#00ccff', xp: 45, weight: 0.7 }, // Ultra Rare - Neon Light Blue
  { tier: 10, color: '#cc00ff', xp: 50, weight: 0.3 } // Ultimate - Neon Lavender
];

// Calculate size multiplier based on score (3x slower progression)
function getSizeMultiplier(score) {
  if (score < 3000) {
    return 1 + (score / 3000);
  } else if (score < 15000) {
    return 2 + ((score - 3000) / 12000);
  } else if (score < 75000) {
    return 3 + ((score - 15000) / 60000);
  } else {
    return 4;
  }
}

// Store all connected players
const players = new Map();

// Store food orbs
const food = new Map();

// Store premium orbs
const premiumOrbs = new Map();

// Generate random username
function generateRandomUsername() {
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `UnnamedUser-${randomNum}`;
}

// Generate random spawn position within map boundaries
function getRandomSpawnPosition() {
  const padding = GAME_CONFIG.PLAYER_SIZE + 10;
  return {
    x: padding + Math.random() * (GAME_CONFIG.MAP_WIDTH - padding * 2),
    y: padding + Math.random() * (GAME_CONFIG.MAP_HEIGHT - padding * 2),
  };
}

// Generate random color for player (neon colors)
function generateRandomColor() {
  const colors = [
    '#ff0055', '#00ffff', '#00d4ff', '#ffff00', '#b000ff',
    '#ff00ff', '#ff6600', '#ff4500', '#00ccff', '#cc00ff'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Generate random food orb
function generateRandomFood() {
  // Calculate total weight
  const totalWeight = FOOD_TIERS.reduce((sum, tier) => sum + tier.weight, 0);

  // Select tier based on weighted random
  let random = Math.random() * totalWeight;
  let selectedTier = FOOD_TIERS[0];

  for (const tier of FOOD_TIERS) {
    random -= tier.weight;
    if (random <= 0) {
      selectedTier = tier;
      break;
    }
  }

  return {
    id: Math.random().toString(36).substring(2, 11),
    x: Math.random() * GAME_CONFIG.MAP_WIDTH,
    y: Math.random() * GAME_CONFIG.MAP_HEIGHT,
    size: 5 + Math.random() * 5, // 5-10 pixels
    color: selectedTier.color,
    xp: selectedTier.xp,
    tier: selectedTier.tier
  };
}

// Generate random premium orb
function generateRandomPremiumOrb() {
  return {
    id: Math.random().toString(36).substring(2, 11),
    x: Math.random() * GAME_CONFIG.MAP_WIDTH,
    y: Math.random() * GAME_CONFIG.MAP_HEIGHT,
    size: 20,
    rotation: Math.random() * Math.PI * 2,
    color: '#dd00ff', // Neon purple/magenta
    xp: 100
  };
}

// Create HTTP server
const httpServer = createServer();

// Create Socket.IO server with CORS enabled
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://burrs-io-client.onrender.com",
      "http://localhost:5173",
      "http://localhost:5174"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Handle client connections
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle player join
  socket.on('join', (username) => {
    // Validate and sanitize username
    let playerName = username?.trim() || '';
    
    // Generate random username if empty or "noname"
    if (!playerName || playerName.toLowerCase() === 'noname') {
      playerName = generateRandomUsername();
    }
    
    // Limit username length
    playerName = playerName.substring(0, 20);

    // Create player object
    const spawnPos = getRandomSpawnPosition();
    const player = {
      id: socket.id,
      username: playerName,
      x: spawnPos.x,
      y: spawnPos.y,
      vx: 0,
      vy: 0,
      size: GAME_CONFIG.PLAYER_SIZE,
      color: generateRandomColor(),
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: 0.015,
      score: 0, // Track player score
      health: 100, // Track player health
      isEating: false, // Track eating animation state
      eatingProgress: 0, // Track eating animation progress
      inputs: {
        up: false,
        down: false,
        left: false,
        right: false,
      },
    };

    players.set(socket.id, player);

    // Initialize food orbs if not already done
    if (food.size === 0) {
      for (let i = 0; i < GAME_CONFIG.FOOD_COUNT; i++) {
        const foodOrb = generateRandomFood();
        food.set(foodOrb.id, foodOrb);
      }
    }

    // Initialize premium orbs if not already done
    if (premiumOrbs.size === 0) {
      for (let i = 0; i < GAME_CONFIG.PREMIUM_ORB_COUNT; i++) {
        const orb = generateRandomPremiumOrb();
        premiumOrbs.set(orb.id, orb);
      }
    }

    // Send initial game state to the new player
    socket.emit('init', {
      playerId: socket.id,
      player: player,
      players: Array.from(players.values()),
      food: Array.from(food.values()),
      premiumOrbs: Array.from(premiumOrbs.values()),
      mapConfig: {
        width: GAME_CONFIG.MAP_WIDTH,
        height: GAME_CONFIG.MAP_HEIGHT,
      },
    });

    // Notify all other players about the new player
    socket.broadcast.emit('playerJoined', player);

    console.log(`Player joined: ${playerName} (${socket.id})`);
  });

  // Handle player input
  socket.on('input', (inputs) => {
    const player = players.get(socket.id);
    if (player && inputs) {
      // Validate inputs (security check)
      player.inputs = {
        up: Boolean(inputs.up),
        down: Boolean(inputs.down),
        left: Boolean(inputs.left),
        right: Boolean(inputs.right),
      };
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`Player disconnected: ${player.username} (${socket.id})`);
      players.delete(socket.id);
      
      // Notify all clients about player leaving
      io.emit('playerLeft', socket.id);
    }
  });
});

// Game loop - update game state and broadcast to all clients
function gameLoop() {
  // Update all players based on their inputs
  players.forEach((player) => {
    // Calculate velocity based on inputs
    let vx = 0;
    let vy = 0;

    if (player.inputs.up) vy -= GAME_CONFIG.PLAYER_SPEED;
    if (player.inputs.down) vy += GAME_CONFIG.PLAYER_SPEED;
    if (player.inputs.left) vx -= GAME_CONFIG.PLAYER_SPEED;
    if (player.inputs.right) vx += GAME_CONFIG.PLAYER_SPEED;

    // Normalize diagonal movement
    if (vx !== 0 && vy !== 0) {
      const magnitude = Math.sqrt(vx * vx + vy * vy);
      vx = (vx / magnitude) * GAME_CONFIG.PLAYER_SPEED;
      vy = (vy / magnitude) * GAME_CONFIG.PLAYER_SPEED;
    }

    player.vx = vx;
    player.vy = vy;

    // Update position
    player.x += player.vx;
    player.y += player.vy;

    // Update rotation
    player.rotation += player.rotationSpeed;

    // Update eating animation
    if (player.isEating) {
      player.eatingProgress += 0.12; // Animation speed

      // Reset when animation completes (full cycle: open and close)
      if (player.eatingProgress >= 1) {
        player.isEating = false;
        player.eatingProgress = 0;
      }
    }

    // Calculate player's actual size based on score
    const sizeMultiplier = getSizeMultiplier(player.score);
    const actualSize = GAME_CONFIG.PLAYER_SIZE * sizeMultiplier;

    // Enforce map boundaries
    const totalSize = actualSize * 1.29; // body radius + thorn length (scaled)
    player.x = Math.max(totalSize, Math.min(GAME_CONFIG.MAP_WIDTH - totalSize, player.x));
    player.y = Math.max(totalSize, Math.min(GAME_CONFIG.MAP_HEIGHT - totalSize, player.y));

    // Check collision with food
    food.forEach((foodOrb) => {
      const dx = foodOrb.x - player.x;
      const dy = foodOrb.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < actualSize + foodOrb.size) {
        // Player collected food
        player.score += foodOrb.xp;

        // Trigger eating animation
        player.isEating = true;
        player.eatingProgress = 0;

        // Remove food and spawn new one
        food.delete(foodOrb.id);
        const newFood = generateRandomFood();
        food.set(newFood.id, newFood);

        // Broadcast food collection event
        io.emit('foodCollected', {
          playerId: player.id,
          foodId: foodOrb.id,
          newFood: newFood,
          newScore: player.score
        });
      }
    });

    // Check collision with premium orbs
    premiumOrbs.forEach((orb) => {
      const dx = orb.x - player.x;
      const dy = orb.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < actualSize + orb.size) {
        // Player collected premium orb
        player.score += orb.xp;

        // Trigger eating animation
        player.isEating = true;
        player.eatingProgress = 0;

        // Remove orb and spawn new one
        premiumOrbs.delete(orb.id);
        const newOrb = generateRandomPremiumOrb();
        premiumOrbs.set(newOrb.id, newOrb);

        // Broadcast premium orb collection event
        io.emit('premiumOrbCollected', {
          playerId: player.id,
          orbId: orb.id,
          newOrb: newOrb,
          newScore: player.score
        });
      }
    });
  });

  // Update premium orb rotations
  premiumOrbs.forEach((orb) => {
    orb.rotation += 0.02;
  });

  // Broadcast game state to all clients
  if (players.size > 0) {
    io.emit('gameState', {
      players: Array.from(players.values()),
      food: Array.from(food.values()),
      premiumOrbs: Array.from(premiumOrbs.values())
    });
  }
}

// Start game loop
const gameLoopInterval = setInterval(gameLoop, 1000 / GAME_CONFIG.TICK_RATE);

// Start server
httpServer.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  clearInterval(gameLoopInterval);
  io.close();
  httpServer.close();
  process.exit(0);
});

