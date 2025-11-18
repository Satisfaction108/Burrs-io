import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = process.env.PORT || 5174;

// Game configuration
const GAME_CONFIG = {
  MAP_WIDTH: 4000,
  MAP_HEIGHT: 4000,
  PLAYER_SIZE: 30, // Base size for spikes
  // Base max speed in world units per tick (~360 px/s at 60 FPS for small spikes)
  PLAYER_SPEED: 6,
  TICK_RATE: 60, // Server updates per second
  FOOD_COUNT: 500, // Total food orbs on map
  PREMIUM_ORB_COUNT: 5, // Total premium orbs on map
  // Momentum-based movement configuration (tuned for ~2s ramp-up, smooth direction changes)
  ACCELERATION: 0.05,  // ~0 -> max speed in ~2 seconds
  DECELERATION: 0.05,  // ~max speed -> 0 in ~2 seconds when no input
  DIRECTION_CHANGE_DECEL: 0.4, // ~+max -> -max in ~0.5 seconds when reversing direction
  // Speed boost configuration
  BOOST_COOLDOWN_MS: 15000, // 15 second cooldown for speed boost
  BOOST_SPEED_MULTIPLIER: 2.2, // how much faster during boost
  BOOST_MAX_SPEED_FACTOR: 3.0, // cap relative to adjustedSpeed
  BOOST_MIN_SPEED_RATIO: 0.2, // must be at least 20% of base speed to trigger
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

// Calculate max HP based on score
// Base: 10 HP at 0 score
// Milestones: +5 HP every 5^n * 1000 score
// 0 score = 10 HP
// 1000 score = 15 HP
// 5000 score = 20 HP
// 25000 score = 25 HP
// 125000 score = 30 HP, etc.
function getMaxHP(score) {
  let hp = 10; // Base HP
  let milestone = 1000; // First milestone
  let milestoneIndex = 0;

  while (score >= milestone) {
    hp += 5;
    milestoneIndex++;
    milestone = 1000 * Math.pow(5, milestoneIndex);
  }

  return hp;
}

// Calculate damage points based on score
// Base: 1 damage at 0 score
// Milestones: +2 damage every 5^n * 1000 score
// 0 score = 1 damage
// 1000 score = 3 damage
// 5000 score = 5 damage
// 25000 score = 7 damage
// 125000 score = 9 damage, etc.
function getDamagePoints(score) {
  let damage = 1; // Base damage
  let milestone = 1000; // First milestone
  let milestoneIndex = 0;

  while (score >= milestone) {
    damage += 2;
    milestoneIndex++;
    milestone = 1000 * Math.pow(5, milestoneIndex);
  }

  // For scores between milestones, interpolate linearly
  // Find the previous milestone
  if (milestoneIndex > 0) {
    const prevMilestone = 1000 * Math.pow(5, milestoneIndex - 1);
    const nextMilestone = 1000 * Math.pow(5, milestoneIndex);
    const baseDamage = 1 + (milestoneIndex - 1) * 2;

    if (score < nextMilestone) {
      const progress = (score - prevMilestone) / (nextMilestone - prevMilestone);
      damage = baseDamage + progress * 2;
    }
  } else if (score < 1000) {
    // Between 0 and 1000, interpolate from 1 to 3
    damage = 1 + (score / 1000) * 2;
  }

  return damage;
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
      health: 100, // Track player health (percentage)
      maxHP: 10, // Track max HP points (starts at 10)
      currentHP: 10, // Track current HP points (starts at 10)
      isEating: false, // Track eating animation state
      eatingProgress: 0, // Track eating animation progress
      isAngry: false, // Track if player is angry from collision
      angryProgress: 0, // Track angry animation progress (0 to 1)
      isDying: false, // Track if player is dying
      deathProgress: 0, // Track death animation progress (0 to 1)
      deathStartTime: 0, // Track when death animation started
      lastCollisionTime: 0, // Track last collision timestamp
      damageDealt: new Map(), // Track damage dealt by other players (for assists)
      kills: 0, // Track number of kills
      foodEaten: 0, // Track food orbs eaten
      premiumOrbsEaten: 0, // Track premium orbs eaten
      spawnTime: Date.now(), // Track when player spawned
      lastBoostTime: 0, // Track last time speed boost was used
      // Momentum-based movement properties
      currentSpeed: 0, // Current movement speed (0 to adjustedSpeed)
      targetVx: 0, // Target velocity X based on input
      targetVy: 0, // Target velocity Y based on input
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
      // Ignore input if player is dying (fix death animation bug)
      if (player.isDying) {
        return;
      }

      // Validate inputs (security check)
      player.inputs = {
        up: Boolean(inputs.up),
        down: Boolean(inputs.down),
        left: Boolean(inputs.left),
        right: Boolean(inputs.right),
      };
    }
  });

  // Handle speed boost ability
  socket.on('speedBoost', () => {
    const player = players.get(socket.id);
    if (!player || player.isDying) return;

    const now = Date.now();
    const cooldown = GAME_CONFIG.BOOST_COOLDOWN_MS || 15000;

    // Enforce cooldown
    if (player.lastBoostTime && (now - player.lastBoostTime) < cooldown) {
      const remaining = Math.ceil((cooldown - (now - player.lastBoostTime)) / 1000);
      socket.emit('speedBoostError', {
        message: `Speed boost recharging... (${remaining}s)`
      });
      return;
    }

    const vx = player.vx || 0;
    const vy = player.vy || 0;
    const speed = Math.sqrt(vx * vx + vy * vy);

    const minSpeedRatio = GAME_CONFIG.BOOST_MIN_SPEED_RATIO || 0.2;
    const minSpeed = (GAME_CONFIG.PLAYER_SPEED || 1) * minSpeedRatio;

    if (speed < minSpeed) {
      socket.emit('speedBoostError', {
        message: 'You must be moving to use speed boost.'
      });
      return;
    }

    // Compute adjusted speed similar to movement loop
    const sizeMultiplier = getSizeMultiplier(player.score || 0);
    const speedMultiplier = 1 / Math.sqrt(sizeMultiplier);
    const adjustedSpeed = GAME_CONFIG.PLAYER_SPEED * speedMultiplier;

    const dirX = vx / speed;
    const dirY = vy / speed;

    const boostMul = GAME_CONFIG.BOOST_SPEED_MULTIPLIER || 2.2;
    const maxFactor = GAME_CONFIG.BOOST_MAX_SPEED_FACTOR || 3.0;

    const targetSpeed = Math.min(speed * boostMul, adjustedSpeed * maxFactor);

    player.vx = dirX * targetSpeed;
    player.vy = dirY * targetSpeed;
    player.lastBoostTime = now;

    // Notify this client that boost was successfully used (for cooldown UI)
    socket.emit('speedBoostUsed', {
      cooldownMs: cooldown,
      usedAt: now,
    });

    // Broadcast a boost event so all players can see a visual effect
    io.emit('playerBoosted', {
      playerId: player.id,
      x: player.x,
      y: player.y,
    });
  });

  // Handle respawn request
  socket.on('respawn', (username) => {
    // Validate and sanitize username
    let playerName = username?.trim() || '';

    if (!playerName || playerName.toLowerCase() === 'noname') {
      playerName = generateRandomUsername();
    }

    playerName = playerName.substring(0, 20);

    // Create new player object (respawn)
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
      score: 0,
      health: 100,
      maxHP: 10,
      currentHP: 10,
      isEating: false,
      eatingProgress: 0,
      isAngry: false,
      angryProgress: 0,
      isDying: false,
      deathProgress: 0,
      deathStartTime: 0,
      lastCollisionTime: 0,
      damageDealt: new Map(),
      kills: 0,
      foodEaten: 0,
      premiumOrbsEaten: 0,
      spawnTime: Date.now(),
      lastBoostTime: 0,
      // Momentum-based movement properties
      currentSpeed: 0,
      targetVx: 0,
      targetVy: 0,
      inputs: {
        up: false,
        down: false,
        left: false,
        right: false,
      },
    };

    players.set(socket.id, player);

    // Send init data to respawned player
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

    // Notify other players
    socket.broadcast.emit('playerJoined', player);

    console.log(`Player respawned: ${playerName} (${socket.id})`);
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

    // Update death animation FIRST - skip all other updates if dying
    if (player.isDying) {
      const elapsed = Date.now() - player.deathStartTime;
      player.deathProgress = Math.min(elapsed / 1500, 1); // 1.5 second death animation

      // When animation completes, remove player
      if (player.deathProgress >= 1) {
        players.delete(player.id);
        return; // Skip rest of update for this player
      }

      // Skip movement and other updates while dying
      return;
    }

    // Calculate size multiplier for speed scaling
    const sizeMultiplier = getSizeMultiplier(player.score);
    // Bigger players are slower (inverse relationship)
    // At 1x size: 100% speed, at 2x size: ~71% speed, at 3x size: ~58% speed
    const speedMultiplier = 1 / Math.sqrt(sizeMultiplier);
    const adjustedSpeed = GAME_CONFIG.PLAYER_SPEED * speedMultiplier;

    // Calculate target velocity based on inputs
    let targetVx = 0;
    let targetVy = 0;

    if (player.inputs.up) targetVy -= 1;
    if (player.inputs.down) targetVy += 1;
    if (player.inputs.left) targetVx -= 1;
    if (player.inputs.right) targetVx += 1;

    // Normalize diagonal movement
    if (targetVx !== 0 && targetVy !== 0) {
      const magnitude = Math.sqrt(targetVx * targetVx + targetVy * targetVy);
      targetVx = targetVx / magnitude;
      targetVy = targetVy / magnitude;
    }

    // Scale to adjusted speed
    targetVx *= adjustedSpeed;
    targetVy *= adjustedSpeed;

    // Detect direction change (recoil effect)
    const prevTargetVx = player.targetVx || 0;
    const prevTargetVy = player.targetVy || 0;
    const directionChanged = (
      (targetVx !== 0 && prevTargetVx !== 0 && Math.sign(targetVx) !== Math.sign(prevTargetVx)) ||
      (targetVy !== 0 && prevTargetVy !== 0 && Math.sign(targetVy) !== Math.sign(prevTargetVy))
    );

    // Store target velocity
    player.targetVx = targetVx;
    player.targetVy = targetVy;

    // Apply momentum-based movement
    const hasInput = targetVx !== 0 || targetVy !== 0;

    if (hasInput) {
      // Accelerate towards target velocity
      const currentVx = player.vx || 0;
      const currentVy = player.vy || 0;

      // Calculate difference between current and target
      const diffVx = targetVx - currentVx;
      const diffVy = targetVy - currentVy;

      // Apply acceleration (with extra deceleration on direction change for recoil)
      const accelRate = directionChanged ? GAME_CONFIG.DIRECTION_CHANGE_DECEL : GAME_CONFIG.ACCELERATION;

      player.vx = currentVx + Math.sign(diffVx) * Math.min(Math.abs(diffVx), accelRate);
      player.vy = currentVy + Math.sign(diffVy) * Math.min(Math.abs(diffVy), accelRate);
    } else {
      // Decelerate when no input
      const currentVx = player.vx || 0;
      const currentVy = player.vy || 0;

      // Apply deceleration
      if (Math.abs(currentVx) > 0.01) {
        player.vx = currentVx - Math.sign(currentVx) * Math.min(Math.abs(currentVx), GAME_CONFIG.DECELERATION);
      } else {
        player.vx = 0;
      }

      if (Math.abs(currentVy) > 0.01) {
        player.vy = currentVy - Math.sign(currentVy) * Math.min(Math.abs(currentVy), GAME_CONFIG.DECELERATION);
      } else {
        player.vy = 0;
      }
    }

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

    // Health regeneration (full heal over ~2 minutes of game time)
    // Use maxHP so higher-HP players still take about the same time to fully regen
    if (player.health < 100) {
      const maxHP = player.maxHP || 10;
      const currentHP = player.currentHP || maxHP;

      // Regenerate HP points: full heal in ~120 seconds at current tick rate
      const fullRegenSeconds = 120;
      const regenRate = maxHP / (GAME_CONFIG.TICK_RATE * fullRegenSeconds);
      const newHP = Math.min(currentHP + regenRate, maxHP);
      player.currentHP = newHP;

      // Update health percentage
      player.health = Math.min((newHP / maxHP) * 100, 100);
    }

    // Calculate player's actual size based on score (reuse sizeMultiplier from above)
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
        player.foodEaten += 1; // Track food eaten

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
        player.premiumOrbsEaten += 1; // Track premium orbs eaten

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

    // Update max HP and current HP based on score
    player.maxHP = getMaxHP(player.score);

    // Update angry animation
    if (player.isAngry) {
      const currentTime = Date.now();
      const timeSinceCollision = (currentTime - player.lastCollisionTime) / 1000; // in seconds

      if (timeSinceCollision < 1.5) {
        // Angry for 1.5 seconds
        player.angryProgress = Math.min(1, timeSinceCollision / 0.2); // Ramp up quickly in 0.2s
      } else if (timeSinceCollision < 2.5) {
        // Transition back to happy over 1 second
        player.angryProgress = 1 - ((timeSinceCollision - 1.5) / 1.0);
      } else {
        // Reset to happy
        player.isAngry = false;
        player.angryProgress = 0;
      }
    }
  });

  // Check player-to-player collisions
  const playerArray = Array.from(players.values());
  for (let i = 0; i < playerArray.length; i++) {
    const player1 = playerArray[i];
    const size1 = GAME_CONFIG.PLAYER_SIZE * getSizeMultiplier(player1.score);

    for (let j = i + 1; j < playerArray.length; j++) {
      const player2 = playerArray[j];
      const size2 = GAME_CONFIG.PLAYER_SIZE * getSizeMultiplier(player2.score);

      // Calculate distance between players
      const dx = player2.x - player1.x;
      const dy = player2.y - player1.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if players are colliding (using outer spike radius)
      const collisionDistance = size1 * 1.29 + size2 * 1.29;

      if (distance < collisionDistance) {
        // Collision detected!
        const currentTime = Date.now();

        // Apply bounce/push-back effect
        // Calculate normalized direction vector from player1 to player2
        let nx = dx;
        let ny = dy;
        if (distance !== 0) {
          nx = dx / distance;
          ny = dy / distance;
        } else {
          // If players are exactly on top of each other, push in a default direction
          nx = 1;
          ny = 0;
        }

        // Resolve overlap and apply smooth knockback instead of instant teleport
        const overlap = collisionDistance - distance;

        // Minimal positional separation: just enough to stop intersecting
        const separation = overlap + 2; // small padding
        const separationPerPlayer = separation * 0.5;
        player1.x -= nx * separationPerPlayer;
        player1.y -= ny * separationPerPlayer;
        player2.x += nx * separationPerPlayer;
        player2.y += ny * separationPerPlayer;

        // Velocity-based knockback – creates a smooth push over a few frames
        const baseImpulse = 4; // tuned for noticeable push at current speeds
        const depthFactor = Math.min(overlap / (GAME_CONFIG.PLAYER_SIZE * 0.8), 2); // 0..2
        const impulseStrength = baseImpulse * (1 + 0.5 * depthFactor);

        player1.vx -= nx * impulseStrength;
        player1.vy -= ny * impulseStrength;
        player2.vx += nx * impulseStrength;
        player2.vy += ny * impulseStrength;

        // Only apply damage if enough time has passed since last collision (cooldown: 0.5s)
        const canDamage1 = (currentTime - player1.lastCollisionTime) > 500;
        const canDamage2 = (currentTime - player2.lastCollisionTime) > 500;

        if (canDamage1 || canDamage2) {
          // Base damage from score progression
          const baseDamageFrom1To2 = getDamagePoints(player1.score);
          const baseDamageFrom2To1 = getDamagePoints(player2.score);

          // Current speeds (magnitude of velocity vector)
          const speed1 = Math.sqrt((player1.vx || 0) * (player1.vx || 0) + (player1.vy || 0) * (player1.vy || 0));
          const speed2 = Math.sqrt((player2.vx || 0) * (player2.vx || 0) + (player2.vy || 0) * (player2.vy || 0));

          // Normalize speeds relative to base max speed
          const maxBaseSpeed = GAME_CONFIG.PLAYER_SPEED || 1;
          const speedNorm1 = Math.min(speed1 / maxBaseSpeed, 1);
          const speedNorm2 = Math.min(speed2 / maxBaseSpeed, 1);

          // Momentum-based damage scaling
          // At 0 speed -> 0.5x base damage, at max speed -> 2x base damage
          const factor1 = 0.5 + speedNorm1 * 1.5;
          const factor2 = 0.5 + speedNorm2 * 1.5;

          const damageFrom1To2 = Math.max(1, Math.round(baseDamageFrom1To2 * factor1));
          const damageFrom2To1 = Math.max(1, Math.round(baseDamageFrom2To1 * factor2));

          // Apply damage to both players and track damage dealt
          if (canDamage2) {
            // Player2 receives damage based on player1's momentum
            player2.currentHP -= damageFrom1To2;
            player2.health = (player2.currentHP / player2.maxHP) * 100;
            player2.isAngry = true;
            player2.lastCollisionTime = currentTime;
            player2.angryProgress = 0;

            // Track damage dealt by player1 to player2 (for assists)
            const currentDamage = player2.damageDealt.get(player1.id) || 0;
            player2.damageDealt.set(player1.id, currentDamage + damageFrom1To2);
          }

          if (canDamage1) {
            // Player1 receives damage based on player2's momentum
            player1.currentHP -= damageFrom2To1;
            player1.health = (player1.currentHP / player1.maxHP) * 100;
            player1.isAngry = true;
            player1.lastCollisionTime = currentTime;
            player1.angryProgress = 0;

            // Track damage dealt by player2 to player1 (for assists)
            const currentDamage = player1.damageDealt.get(player2.id) || 0;
            player1.damageDealt.set(player2.id, currentDamage + damageFrom2To1);
          }

          // Broadcast collision event to all clients
          // damage1: damage received by player1, damage2: damage received by player2
          io.emit('playerCollision', {
            player1Id: player1.id,
            player2Id: player2.id,
            player1Health: player1.health,
            player2Health: player2.health,
            player1HP: player1.currentHP,
            player2HP: player2.currentHP,
            damage1: canDamage1 ? damageFrom2To1 : 0,
            damage2: canDamage2 ? damageFrom1To2 : 0,
          });

          // Check if either player died
          if (player1.health <= 0) {
            // Calculate assists and score distribution
            const deadPlayerScore = player1.score;
            const scoreToDistribute = Math.floor(deadPlayerScore * 0.75);

            // Get all players who dealt damage to player1
            const damagers = Array.from(player1.damageDealt.entries())
              .map(([playerId, damage]) => ({ playerId, damage }))
              .sort((a, b) => b.damage - a.damage);

            let killer = null;
            let assists = [];

            if (damagers.length > 0) {
              // The player who dealt the most damage is the killer
              killer = players.get(damagers[0].playerId);

              // If there are other damagers, they are assists
              if (damagers.length > 1) {
                assists = damagers.slice(1)
                  .map(d => players.get(d.playerId))
                  .filter(p => p !== undefined);
              }
            }

            // Distribute score
            if (killer && assists.length === 0) {
              // Solo kill - killer gets 75% of score
              killer.score += scoreToDistribute;
              killer.kills += 1;
            } else if (killer && assists.length > 0) {
              // Kill with assists - split evenly among all damagers
              const scorePerPlayer = Math.floor(scoreToDistribute / (assists.length + 1));
              killer.score += scorePerPlayer;
              killer.kills += 1;
              assists.forEach(assist => {
                if (assist) {
                  assist.score += scorePerPlayer;
                }
              });
            }

            // Calculate time survived
            const timeSurvived = Math.floor((currentTime - player1.spawnTime) / 1000); // in seconds

            // Start death animation
            player1.isDying = true;
            player1.deathStartTime = currentTime;
            player1.deathProgress = 0;
            // Stop all movement immediately
            player1.vx = 0;
            player1.vy = 0;
            player1.targetVx = 0;
            player1.targetVy = 0;

            // Broadcast death event with stats
            io.emit('playerDied', {
              playerId: player1.id,
              killedBy: killer ? killer.id : null,
              assists: assists.map(a => a.id),
              stats: {
                timeSurvived: timeSurvived,
                kills: player1.kills,
                foodEaten: player1.foodEaten,
                premiumOrbsEaten: player1.premiumOrbsEaten,
                score: deadPlayerScore,
              },
              killerScore: killer ? killer.score : 0,
            });

            // Player will be removed after death animation completes (in game loop)
          }

          if (player2.health <= 0) {
            // Calculate assists and score distribution
            const deadPlayerScore = player2.score;
            const scoreToDistribute = Math.floor(deadPlayerScore * 0.75);

            // Get all players who dealt damage to player2
            const damagers = Array.from(player2.damageDealt.entries())
              .map(([playerId, damage]) => ({ playerId, damage }))
              .sort((a, b) => b.damage - a.damage);

            let killer = null;
            let assists = [];

            if (damagers.length > 0) {
              // The player who dealt the most damage is the killer
              killer = players.get(damagers[0].playerId);

              // If there are other damagers, they are assists
              if (damagers.length > 1) {
                assists = damagers.slice(1)
                  .map(d => players.get(d.playerId))
                  .filter(p => p !== undefined);
              }
            }

            // Distribute score
            if (killer && assists.length === 0) {
              // Solo kill - killer gets 75% of score
              killer.score += scoreToDistribute;
              killer.kills += 1;
            } else if (killer && assists.length > 0) {
              // Kill with assists - split evenly among all damagers
              const scorePerPlayer = Math.floor(scoreToDistribute / (assists.length + 1));
              killer.score += scorePerPlayer;
              killer.kills += 1;
              assists.forEach(assist => {
                if (assist) {
                  assist.score += scorePerPlayer;
                }
              });
            }

            // Calculate time survived
            const timeSurvived = Math.floor((currentTime - player2.spawnTime) / 1000); // in seconds

            // Start death animation
            player2.isDying = true;
            player2.deathStartTime = currentTime;
            player2.deathProgress = 0;
            // Stop all movement immediately
            player2.vx = 0;
            player2.vy = 0;
            player2.targetVx = 0;
            player2.targetVy = 0;

            // Broadcast death event with stats
            io.emit('playerDied', {
              playerId: player2.id,
              killedBy: killer ? killer.id : null,
              assists: assists.map(a => a.id),
              stats: {
                timeSurvived: timeSurvived,
                kills: player2.kills,
                foodEaten: player2.foodEaten,
                premiumOrbsEaten: player2.premiumOrbsEaten,
                score: deadPlayerScore,
              },
              killerScore: killer ? killer.score : 0,
            });

            // Player will be removed after death animation completes (in game loop)
          }
        }
      }
    }
  }

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

