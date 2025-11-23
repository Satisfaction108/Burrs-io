import { createServer } from 'http';
import { Server } from 'socket.io';
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { MongoClient, ObjectId } from 'mongodb';
import authRoutes from './routes/auth.js';
import customizationsRoutes from './routes/customizations.js';
import gameRoutes from './routes/game.js';
import bugsRoutes from './routes/bugs.js';

dotenv.config();

// MongoDB connection for saving player stats
const mongoClient = new MongoClient(process.env.MONGODB_URI);
let db;
let usersCollection;

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db('burrs-io');
    usersCollection = db.collection('users');
    console.log('✅ Game server connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error in game server:', error);
  }
}

connectDB();

// Helper function to save player stats to database
async function savePlayerStats(player, sessionStats) {
  // Only save stats for authenticated users
  if (!player.userId || !usersCollection) return;

  try {
    // Validate ObjectId
    if (!ObjectId.isValid(player.userId)) {
      console.error(`Invalid userId format: ${player.userId}`);
      return;
    }

    const userId = new ObjectId(player.userId);

    // Calculate session playtime in seconds
    const sessionPlaytime = Math.floor((Date.now() - player.spawnTime) / 1000);

    // Update user stats in database
    await usersCollection.updateOne(
      { _id: userId },
      {
        $inc: {
          totalKills: sessionStats.kills || 0,
          totalDeaths: sessionStats.deaths || 0,
          totalPlaytime: sessionPlaytime,
          totalFoodEaten: sessionStats.foodEaten || 0,
          totalPremiumOrbsEaten: sessionStats.premiumOrbsEaten || 0,
          totalScore: sessionStats.score || 0,
        },
        $set: {
          lastPlayed: new Date()
        }
      }
    );

    console.log(`💾 Saved stats for user ${player.username} (${player.userId})`);
  } catch (error) {
    console.error('Error saving player stats:', error);
  }
}

// Helper function to save evolution progress to database
async function saveEvolutionProgress(player) {
  // Only save evolution progress for authenticated users
  if (!player.userId || !usersCollection) return;

  try {
    // Validate ObjectId
    if (!ObjectId.isValid(player.userId)) {
      console.error(`Invalid userId format: ${player.userId}`);
      return;
    }

    const userId = new ObjectId(player.userId);

    // Save current evolution state
    await usersCollection.updateOne(
      { _id: userId },
      {
        $set: {
          savedEvolution: {
            spikeType: player.spikeType || 'Spike',
            hasEvolved: player.hasEvolved || false,
            tier2Evolved: player.tier2Evolved || false,
            score: player.score || 0,
            evolutionScoreOffset: player.evolutionScoreOffset || 0,
            savedAt: new Date()
          }
        }
      }
    );

    console.log(`💾 Saved evolution progress for user ${player.username} (${player.userId})`);
  } catch (error) {
    console.error('Error saving evolution progress:', error);
  }
}

// Helper function to load evolution progress from database
async function loadEvolutionProgress(userId) {
  if (!userId || !usersCollection) return null;

  try {
    // Validate ObjectId
    if (!ObjectId.isValid(userId)) {
      console.error(`Invalid userId format: ${userId}`);
      return null;
    }

    const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

    if (user && user.savedEvolution) {
      // Check if saved evolution is recent (within 24 hours)
      const savedAt = new Date(user.savedEvolution.savedAt);
      const hoursSinceSaved = (Date.now() - savedAt.getTime()) / (1000 * 60 * 60);

      if (hoursSinceSaved < 24) {
        console.log(`✅ Loaded evolution progress for user ${userId}`);
        return user.savedEvolution;
      } else {
        console.log(`⏱️ Evolution progress expired for user ${userId} (${hoursSinceSaved.toFixed(1)} hours old)`);
      }
    }
  } catch (error) {
    console.error('Error loading evolution progress:', error);
  }

  return null;
}

const PORT = process.env.PORT || 5174;

// Create Express app
const app = express();

// Middleware
app.use(cors({
  origin: [
    "https://burrs.io",
    "https://www.burrs.io",
    "https://eu.burrs.io",
    "http://localhost:5173",
    "http://localhost:5174"
  ],
  credentials: true
}));
app.use(express.json());

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/customizations', customizationsRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/bugs', bugsRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Simple profanity filter - list of common inappropriate words
const profanityList = [
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'hell', 'crap', 'piss', 'dick', 'cock',
  'pussy', 'fag', 'slut', 'whore', 'bastard', 'cunt', 'nigger', 'nigga', 'retard',
  'rape', 'sex', 'porn', 'xxx', 'anal', 'cum', 'jizz', 'tits', 'boobs', 'penis',
  'vagina', 'dildo', 'viagra', 'nazi', 'hitler', 'kys', 'kill yourself'
];

// Check if text contains profanity (case-insensitive, partial matching)
function isProfane(text) {
  if (!text || typeof text !== 'string') return false;
  const lowerText = text.toLowerCase();
  return profanityList.some(word => lowerText.includes(word));
}

// Reconnection system configuration
const RECONNECTION_TIMEOUT_MS = 60000; // 60 seconds to reconnect
// Store disconnected player data temporarily. Keyed by IP address OR user ID
// so reconnection works even if the player reloads the page or changes their name.
const disconnectedPlayers = new Map(); // IP or userId -> { player, disconnectTime, timeoutId, reconnectionKey }
const ipToSocketId = new Map(); // IP -> current socket.id
const userIdToSocketId = new Map(); // userId -> current socket.id

// ═══════════════════════════════════════════════════════════════
// CHAIN SYSTEM HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate number of segments based on score
 * Every 500 score = 1 new segment
 */
function getSegmentCount(score) {
  return Math.floor(score / 500) + 1; // +1 for the head
}

/**
 * Calculate segment size based on score
 * All segments have the same size, based on (score % 500)
 */
function getSegmentSize(score, baseSize) {
  const scoreWithinCycle = score % 500;
  // Use the same size multiplier calculation as before
  const sizeMultiplier = 1 + (scoreWithinCycle / 500) * 0.5; // Grows from 1x to 1.5x within each 500-score cycle
  return baseSize * sizeMultiplier;
}

/**
 * Create segments array for a player based on their score
 * All segments start at the same position (will spread out during movement)
 */
function createSegments(x, y, score, baseSize, maxHP) {
  const segmentCount = getSegmentCount(score);
  const segmentSize = getSegmentSize(score, baseSize);
  const segments = [];

  for (let i = 0; i < segmentCount; i++) {
    segments.push({
      x: x,
      y: y,
      rotation: 0,
      health: maxHP,
      size: segmentSize
    });
  }

  return segments;
}

/**
 * Update segments array when score changes
 * Adds new segments or removes segments as needed
 */
function updateSegments(player) {
  const targetSegmentCount = getSegmentCount(player.score);
  const currentSegmentCount = player.segments ? player.segments.length : 0;
  const segmentSize = getSegmentSize(player.score, GAME_CONFIG.PLAYER_SIZE);

  // Initialize segments if they don't exist
  if (!player.segments) {
    player.segments = createSegments(player.x, player.y, player.score, GAME_CONFIG.PLAYER_SIZE, player.maxHP);
    return;
  }

  // Update all segment sizes
  player.segments.forEach(segment => {
    segment.size = segmentSize;
  });

  // Add new segments if score increased
  if (targetSegmentCount > currentSegmentCount) {
    const lastSegment = player.segments[player.segments.length - 1];
    for (let i = currentSegmentCount; i < targetSegmentCount; i++) {
      player.segments.push({
        x: lastSegment.x,
        y: lastSegment.y,
        rotation: 0,
        health: player.maxHP,
        size: segmentSize
      });
    }
  }

  // Remove segments if score decreased (from taking damage or dying)
  if (targetSegmentCount < currentSegmentCount) {
    player.segments = player.segments.slice(0, targetSegmentCount);
  }
}

// Helper to get client IP address from socket
function getClientIP(socket) {
  // Try to get IP from various sources (handles proxies, load balancers, etc.)
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || socket.conn.remoteAddress || 'unknown';
}

// Chat timeout system
const chatTimeouts = new Map(); // Track players who are timed out from chat

// AFK system configuration
const AFK_ACTIVATION_TIME_MS = 10000; // 10 seconds stationary in base to activate AFK
const afkActivationTimers = new Map(); // Track AFK activation timers

// Game configuration
const GAME_CONFIG = {
  MAP_WIDTH: 8000,
  MAP_HEIGHT: 8000,
  PLAYER_SIZE: 30, // Base size for spikes
  // Base max speed in world units per tick (~360 px/s at 60 FPS for small spikes)
  PLAYER_SPEED: 6,
  TICK_RATE: 60, // Server updates per second
  BROADCAST_RATE: 30, // Broadcast to clients 30 times per second (reduced from 60 for performance)
  FOOD_COUNT: 2400, // Total food orbs on map (scaled for 8000x8000 map)
  PREMIUM_ORB_COUNT: 20, // Total premium orbs on map (scaled for 8000x8000 map)
  // Momentum-based movement configuration (tuned for ~2s ramp-up, smooth direction changes)
  ACCELERATION: 0.05,  // ~0 -> max speed in ~2 seconds
  DECELERATION: 0.05,  // ~max speed -> 0 in ~2 seconds when no input
  DIRECTION_CHANGE_DECEL: 0.4, // ~+max -> -max in ~0.5 seconds when reversing direction
  // Speed boost configuration
  BOOST_COOLDOWN_MS: 15000, // 15 second cooldown for speed boost
  BOOST_SPEED_MULTIPLIER: 2.2, // how much faster during boost
  BOOST_MAX_SPEED_FACTOR: 3.0, // cap relative to adjustedSpeed
  BOOST_MIN_SPEED_RATIO: 0.2, // must be at least 20% of base speed to trigger
  // Premium orb fleeing configuration
  PREMIUM_ORB_FLEE_DISTANCE: 350, // Distance at which premium orbs start fleeing
  PREMIUM_ORB_FLEE_SPEED: 4, // Speed at which premium orbs flee (slower than player)
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

// Base FOV radius for normal player spikes (used for AI vision tuning)
const PLAYER_BASE_FOV_RADIUS = 600;

// AI-controlled spike configuration
const AI_CONFIG = {
  TARGET_COUNT: 8,            // Aim to keep ~8 AI entities in the world
  BASE_SCORE: 3000,           // Treat AI like a 3000-score spike for HP/damage (challenging but beatable)
  COLOR: '#00ff88',           // Unique neon green/teal body color for AI entities
  FOV_RADIUS: PLAYER_BASE_FOV_RADIUS * 1.5, // 1.5x normal spike FOV
  SPEED_FACTOR: 0.90,         // Slightly slower than players (10% reduction)
};

// Evolution configuration
const EVOLUTION_THRESHOLD = 5000;
const TIER_2_THRESHOLD = 15000;
const EVOLUTION_CONFIG = {
  // Tier 1 - Unlocks at 5000 score
  Prickle: { speed: 0.92, damage: 1.20, health: 1.05, abilityCooldown: 20000, abilityDuration: 2000 },
  Thorn: { speed: 1.05, damage: 1.18, health: 0.92, abilityCooldown: 28000, abilityDuration: 3000 },
  Bristle: { speed: 1.18, damage: 1.05, health: 1.00, abilityCooldown: 28000, abilityDuration: 3000 },
  Bulwark: { speed: 0.82, damage: 1.08, health: 1.20, abilityCooldown: 28000, abilityDuration: 3000 },
  Starflare: { speed: 1.05, damage: 1.15, health: 0.92, abilityCooldown: 120000, abilityDuration: 3000 },
  Mauler: { speed: 1.00, damage: 1.10, health: 1.08, abilityCooldown: 50000, abilityDuration: 3000 },

  // Tier 2 - Prickle variants (Unlocks at 15000 score)
  PrickleVanguard: { speed: 0.96, damage: 1.25, health: 1.08, abilityCooldown: 18000, abilityDuration: 2500 },
  PrickleSwarm: { speed: 1.00, damage: 1.28, health: 1.02, abilityCooldown: 17000, abilityDuration: 2000 },
  PrickleBastion: { speed: 0.88, damage: 1.32, health: 1.12, abilityCooldown: 20000, abilityDuration: 2500 },

  // Tier 2 - Thorn variants
  ThornWraith: { speed: 1.08, damage: 1.22, health: 0.94, abilityCooldown: 25000, abilityDuration: 3500 },
  ThornReaper: { speed: 1.08, damage: 1.28, health: 0.90, abilityCooldown: 24000, abilityDuration: 3000 },
  ThornShade: { speed: 1.12, damage: 1.20, health: 0.94, abilityCooldown: 22000, abilityDuration: 2500 },

  // Tier 2 - Bristle variants
  BristleBlitz: { speed: 1.25, damage: 1.08, health: 1.02, abilityCooldown: 26000, abilityDuration: 3500 },
  BristleStrider: { speed: 1.22, damage: 1.10, health: 1.05, abilityCooldown: 30000, abilityDuration: 4000 },
  BristleSkirmisher: { speed: 1.22, damage: 1.05, health: 1.10, abilityCooldown: 26000, abilityDuration: 3000 },

  // Tier 2 - Bulwark variants
  BulwarkAegis: { speed: 0.85, damage: 1.12, health: 1.25, abilityCooldown: 30000, abilityDuration: 3500 },
  BulwarkCitadel: { speed: 0.82, damage: 1.15, health: 1.30, abilityCooldown: 32000, abilityDuration: 3000 },
  BulwarkJuggernaut: { speed: 0.85, damage: 1.18, health: 1.25, abilityCooldown: 30000, abilityDuration: 3000 },

  // Tier 2 - Starflare variants
  StarflarePulsar: { speed: 1.08, damage: 1.22, health: 0.94, abilityCooldown: 110000, abilityDuration: 3000 },
  StarflareHorizon: { speed: 1.12, damage: 1.18, health: 0.96, abilityCooldown: 35000, abilityDuration: 2500 },
  StarflareNova: { speed: 1.08, damage: 1.28, health: 0.92, abilityCooldown: 90000, abilityDuration: 2500 },

  // Tier 2 - Mauler variants
  MaulerRavager: { speed: 1.05, damage: 1.18, health: 1.10, abilityCooldown: 45000, abilityDuration: 3000 },
  MaulerBulwark: { speed: 0.98, damage: 1.12, health: 1.18, abilityCooldown: 55000, abilityDuration: 3500 },
  MaulerApex: { speed: 1.10, damage: 1.22, health: 1.08, abilityCooldown: 50000, abilityDuration: 4000 },
};

// Team configuration for main team mode (scaled for 8000x8000 map)
const TEAM_BASE_SIZE = 1400;
const TEAM_BASE_MARGIN = 800;

const TEAMS = [
  {
    id: 'ORANGE',
    name: 'Neon Orange',
    color: '#ff4500',
    base: {
      x: TEAM_BASE_MARGIN,
      y: TEAM_BASE_MARGIN,
      width: TEAM_BASE_SIZE,
      height: TEAM_BASE_SIZE,
    },
  },
  {
    id: 'BLUE',
    name: 'Neon Blue',
    color: '#00ffff',
    base: {
      x: GAME_CONFIG.MAP_WIDTH - TEAM_BASE_MARGIN - TEAM_BASE_SIZE,
      y: TEAM_BASE_MARGIN,
      width: TEAM_BASE_SIZE,
      height: TEAM_BASE_SIZE,
    },
  },
  {
    id: 'RED',
    name: 'Neon Red',
    color: '#ff0055',
    base: {
      x: TEAM_BASE_MARGIN,
      y: GAME_CONFIG.MAP_HEIGHT - TEAM_BASE_MARGIN - TEAM_BASE_SIZE,
      width: TEAM_BASE_SIZE,
      height: TEAM_BASE_SIZE,
    },
  },
  {
    id: 'YELLOW',
    name: 'Neon Yellow',
    color: '#ffff00',
    base: {
      x: GAME_CONFIG.MAP_WIDTH - TEAM_BASE_MARGIN - TEAM_BASE_SIZE,
      y: GAME_CONFIG.MAP_HEIGHT - TEAM_BASE_MARGIN - TEAM_BASE_SIZE,
      width: TEAM_BASE_SIZE,
      height: TEAM_BASE_SIZE,
    },
  },
];

function getRandomTeam() {
  return TEAMS[Math.floor(Math.random() * TEAMS.length)];
}

// Spawn inside a team's base with small padding so players don't spawn right on the edge
function getRandomSpawnPositionForTeam(team) {
  const padding = 40;
  const base = team.base;
  const x = base.x + padding + Math.random() * (base.width - padding * 2);
  const y = base.y + padding + Math.random() * (base.height - padding * 2);
  return { x, y };
}
function isPointInsideBase(base, x, y) {
  return (
    x >= base.x &&
    x <= base.x + base.width &&
    y >= base.y &&
    y <= base.y + base.height
  );
}

// Check if a circle (spike body + thorns) overlaps a team base rectangle
function isCircleOverlappingBase(base, x, y, radius) {
  const closestX = Math.max(base.x, Math.min(x, base.x + base.width));
  const closestY = Math.max(base.y, Math.min(y, base.y + base.height));
  const dx = x - closestX;
  const dy = y - closestY;
  return dx * dx + dy * dy <= radius * radius;
}

// Check if a player is currently inside any team base (used for AI target logic)
function isPlayerInsideAnyBase(player) {
  if (!player) return false;
  const effectiveScore = player.isAI ? AI_CONFIG.BASE_SCORE : (player.score || 0);
  const evolutionOffset = player.isAI ? 0 : (player.evolutionScoreOffset || 0);
  const radius = GAME_CONFIG.PLAYER_SIZE * getSizeMultiplier(effectiveScore, evolutionOffset) * 1.29;
  return TEAMS.some((team) => isCircleOverlappingBase(team.base, player.x, player.y, radius));
}

// Check if a player is inside their own team base (for AFK activation)
function isPlayerInsideOwnBase(player) {
  if (!player || player.isAI || !player.teamId) return false;
  const team = TEAMS.find(t => t.id === player.teamId);
  if (!team) return false;
  return isPointInsideBase(team.base, player.x, player.y);
}


// Calculate size multiplier based on score (3x slower progression)
function getSizeMultiplier(score, evolutionScoreOffset = 0) {
  // If player has evolved, calculate visual size based on score gained since evolution
  const visualScore = Math.max(0, score - evolutionScoreOffset);

  if (visualScore < 3000) {
    return 1 + (visualScore / 3000);
  } else if (visualScore < 15000) {
    return 2 + ((visualScore - 3000) / 12000);
  } else if (visualScore < 75000) {
    return 3 + ((visualScore - 15000) / 60000);
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
    vx: 0, // Velocity X for fleeing behavior
    vy: 0, // Velocity Y for fleeing behavior
    size: 20,
    rotation: Math.random() * Math.PI * 2,
    color: '#dd00ff', // Neon purple/magenta
    xp: 100
  };
}
// Create an AI-controlled spike entity
function createAIPlayer(index = 0) {
  const spawnPos = getRandomSpawnPosition();
  const baseScore = AI_CONFIG.BASE_SCORE;
  const maxHP = getMaxHP(baseScore);

  return {
    id: `AI-${index}-${Math.random().toString(36).substring(2, 9)}`,
    username: 'AI HUNTER',
    x: spawnPos.x,
    y: spawnPos.y,
    vx: 0,
    vy: 0,
    size: GAME_CONFIG.PLAYER_SIZE,
    color: AI_CONFIG.COLOR,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: 0.02,
    score: baseScore,
    health: 100,
    maxHP,
    currentHP: maxHP,
    isEating: false,
    eatingProgress: 0,
    isAngry: true,
    angryProgress: 1,
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
    currentSpeed: 0,
    targetVx: 0,
    targetVy: 0,
    inputs: {
      up: false,
      down: false,
      left: false,
      right: false,
    },
    isAI: true,
  };
}

// Ensure we always have a baseline number of AI entities in the world
function ensureAIEntities() {
  let currentCount = 0;
  players.forEach((player) => {
    if (player.isAI) {
      currentCount += 1;
    }
  });

  const targetCount = AI_CONFIG.TARGET_COUNT;
  const toSpawn = Math.max(0, targetCount - currentCount);

  for (let i = 0; i < toSpawn; i++) {
    const aiPlayer = createAIPlayer(i);
    players.set(aiPlayer.id, aiPlayer);
  }
}


// Create HTTP server with Express app
const httpServer = createServer(app);

// Create Socket.IO server with CORS enabled
const io = new Server(httpServer, {
  cors: {
    origin: [
      "https://burrs.io",
      "https://www.burrs.io",
      "https://eu.burrs.io",
      "http://localhost:5173",
      "http://localhost:5174"
    ],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Handle client connections
io.on('connection', (socket) => {
  const clientIP = getClientIP(socket);

  // Check if user is authenticated (optional)
  const authToken = socket.handshake.auth?.token;
  let authenticatedUserId = null;

  if (authToken) {
    try {
      // Verify JWT token
      const decoded = jwt.verify(authToken, process.env.JWT_SECRET);
      authenticatedUserId = decoded.userId;
      console.log(`Client connected (authenticated): ${socket.id} - User ID: ${authenticatedUserId} - IP: ${clientIP}`);

      // Track user ID to socket mapping
      userIdToSocketId.set(authenticatedUserId, socket.id);
    } catch (error) {
      console.log(`Client connected with invalid token: ${socket.id} from IP: ${clientIP}`);
    }
  } else {
    console.log(`Client connected (guest): ${socket.id} from IP: ${clientIP}`);
  }

  // Track IP to socket mapping
  ipToSocketId.set(clientIP, socket.id);

  // Handle player join
  socket.on('join', async (data) => {
    // Support both old format (string) and new format (object with customizations)
    let playerName = '';
    let activeNametag = null;
    let activeSpike = null;

    if (typeof data === 'string') {
      playerName = data;
    } else if (data && typeof data === 'object') {
      playerName = data.username || '';
      activeNametag = data.activeNametag || null;
      activeSpike = data.activeSpike || null;
    }

    // Validate and sanitize username
    playerName = playerName?.trim() || '';

    // Generate random username if empty or "noname"
    if (!playerName || playerName.toLowerCase() === 'noname') {
      playerName = generateRandomUsername();
    }

    // Limit username length
    playerName = playerName.substring(0, 20);

    // Check for profanity in username
    if (isProfane(playerName)) {
      socket.emit('joinError', {
        message: 'No bad words allowed in your name. Please choose a different name.'
      });
      return;
    }

    // IP-based duplicate connection prevention (only for guest users)
    // Authenticated users can have multiple connections (e.g., multiple devices)
    if (!authenticatedUserId) {
      // Check if there's already an active player from this IP
      const existingSocketId = ipToSocketId.get(clientIP);
      if (existingSocketId && existingSocketId !== socket.id) {
        const existingPlayer = players.get(existingSocketId);
        // Only block if the existing player is active (not dying, not in disconnected state)
        if (existingPlayer && !existingPlayer.isDying) {
          socket.emit('joinError', {
            message: 'You already have an active game session. Please close other tabs or wait for your session to end.'
          });
          console.log(`❌ Blocked duplicate connection from IP ${clientIP} (existing session: ${existingSocketId})`);
          return;
        }
      }
    }

    // Check for reconnection - prioritize user ID for authenticated users, then fall back to IP
    let reconnectedPlayer = null;
    let reconnectionKey = null;

    // First, check if authenticated user has a disconnected session
    if (authenticatedUserId) {
      const userDisconnectedData = disconnectedPlayers.get(`user:${authenticatedUserId}`);
      if (userDisconnectedData) {
        reconnectedPlayer = userDisconnectedData.player;
        reconnectionKey = `user:${authenticatedUserId}`;
        console.log(`✅ User ID-based reconnection for user ${authenticatedUserId}: restoring player ${reconnectedPlayer.username}`);
      }
    }

    // If no user-based reconnection, check IP-based reconnection (for guests or as fallback)
    if (!reconnectedPlayer) {
      const ipDisconnectedData = disconnectedPlayers.get(`ip:${clientIP}`);
      if (ipDisconnectedData) {
        reconnectedPlayer = ipDisconnectedData.player;
        reconnectionKey = `ip:${clientIP}`;
        console.log(`✅ IP-based reconnection for ${clientIP}: restoring player ${reconnectedPlayer.username}`);
      }
    }

    // If we found a reconnection, clean it up
    if (reconnectedPlayer && reconnectionKey) {
      const disconnectedData = disconnectedPlayers.get(reconnectionKey);

      // Clear the timeout that would have removed this player
      if (disconnectedData.timeoutId) {
        clearTimeout(disconnectedData.timeoutId);
      }

      // Remove from disconnected players map
      disconnectedPlayers.delete(reconnectionKey);
    }

    // If reconnecting, restore their previous state
    if (reconnectedPlayer) {
      // Update socket ID to new connection
      const oldSocketId = reconnectedPlayer.id;
      reconnectedPlayer.id = socket.id;

      // Remove old socket ID from players map if it exists
      if (players.has(oldSocketId)) {
        players.delete(oldSocketId);
      }

      // Add player with new socket ID
      players.set(socket.id, reconnectedPlayer);

      // Update IP to socket mapping
      ipToSocketId.set(clientIP, socket.id);

      // Send init with restored state
      socket.emit('init', {
        playerId: socket.id,
        player: reconnectedPlayer,
        players: Array.from(players.values()),
        food: Array.from(food.values()),
        premiumOrbs: Array.from(premiumOrbs.values()),
        mapConfig: {
          width: GAME_CONFIG.MAP_WIDTH,
          height: GAME_CONFIG.MAP_HEIGHT,
          teamBases: TEAMS.map(team => ({
            id: team.id,
            color: team.color,
            x: team.base.x,
            y: team.base.y,
            width: team.base.width,
            height: team.base.height,
          })),
        },
        reconnected: true, // Flag to indicate this is a reconnection
      });

      // Notify all other players about the reconnected player
      socket.broadcast.emit('playerJoined', reconnectedPlayer);

      console.log(`Player reconnected: ${reconnectedPlayer.username} (${socket.id}) from IP: ${clientIP}`);
      return;
    }

    // New player - assign to a random team and spawn inside that team's base
    const team = getRandomTeam();
    const spawnPos = getRandomSpawnPositionForTeam(team);
    const player = {
      id: socket.id,
      username: playerName,
      userId: authenticatedUserId, // Store user ID for authenticated users
      x: spawnPos.x,
      y: spawnPos.y,
      vx: 0,
      vy: 0,
      size: GAME_CONFIG.PLAYER_SIZE,
      color: team.color,
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
      isAI: false,
      teamId: team.id,
      // Evolution properties
      spikeType: 'Spike', // Default spike type
      hasEvolved: false, // Track if player has evolved to Tier 1
      tier2Evolved: false, // Track if player has evolved to Tier 2
      evolutionScoreOffset: 0, // Score offset for visual size reset on evolution
      lastAbilityTime: 0, // Track last time ability was used
      abilityActive: false, // Track if ability is currently active
      abilityProgress: 0, // Track ability animation progress (0 to 1)
      // AFK properties
      isAFK: false, // Track if player is AFK
      afkActivationStartTime: 0, // Track when AFK activation started
      afkActivationX: 0, // Track position when AFK activation started
      afkActivationY: 0, // Track position when AFK activation started
      // Customization properties
      activeNametag: activeNametag || 'nametag_default', // Active nametag customization
      activeSpike: activeSpike || 'spike_default', // Active spike customization
      // Chain system properties
      segments: createSegments(spawnPos.x, spawnPos.y, 0, GAME_CONFIG.PLAYER_SIZE, 10), // Initialize with 1 segment
    };

    // Load saved evolution progress for authenticated users
    if (authenticatedUserId) {
      const savedEvolution = await loadEvolutionProgress(authenticatedUserId);
      if (savedEvolution) {
        player.spikeType = savedEvolution.spikeType;
        player.hasEvolved = savedEvolution.hasEvolved;
        player.tier2Evolved = savedEvolution.tier2Evolved;
        player.score = savedEvolution.score;
        player.evolutionScoreOffset = savedEvolution.evolutionScoreOffset;
        console.log(`✅ Restored evolution progress for ${player.username}: ${player.spikeType} (Score: ${player.score})`);
      }
    }

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
        teamBases: TEAMS.map(team => ({
          id: team.id,
          color: team.color,
          x: team.base.x,
          y: team.base.y,
          width: team.base.width,
          height: team.base.height,
        })),
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
      // Ignore input if player is dying or AFK
      if (player.isDying || player.isAFK) {
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
    if (!player || player.isDying || player.isAFK) return;

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
    const sizeMultiplier = getSizeMultiplier(player.score || 0, player.evolutionScoreOffset || 0);
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

  // Handle chat messages
  socket.on('chatMessage', (rawMessage) => {
    const player = players.get(socket.id);
    if (!player) return;

    // Check if player is AFK
    if (player.isAFK) {
      return;
    }

    // Check if player is timed out from chat
    const now = Date.now();
    const timeout = chatTimeouts.get(socket.id);
    if (timeout && now < timeout.until) {
      const remainingSeconds = Math.ceil((timeout.until - now) / 1000);
      socket.emit('chatError', {
        message: `You are timed out from chat for ${remainingSeconds} more seconds.`
      });
      return;
    }

    if (typeof rawMessage !== 'string') {
      rawMessage = String(rawMessage ?? '');
    }

    let text = rawMessage.trim();
    if (!text) return;

    // Limit length and strip newlines for safety
    if (text.length > 200) {
      text = text.slice(0, 200);
    }
    text = text.replace(/[\r\n]+/g, ' ');

    // Check for profanity in chat message
    if (isProfane(text)) {
      // Time out the player for 60 seconds
      const timeoutUntil = now + 60000; // 60 seconds
      chatTimeouts.set(socket.id, { until: timeoutUntil });

      // Broadcast system message about the timeout
      io.emit('chatMessage', {
        id: Math.random().toString(36).substring(2, 11),
        playerId: 'SYSTEM',
        username: '[HELPER]',
        text: `${player.username} timed out for 1 minute.`,
        timestamp: now,
        teamId: null,
        teamColor: '#ffd700', // Golden color for system messages
        isSystem: true,
      });

      // Notify the player they were timed out
      socket.emit('chatError', {
        message: 'Your message contained inappropriate language. You have been timed out for 60 seconds.'
      });

      return;
    }

    const team = player.teamId ? TEAMS.find(t => t.id === player.teamId) : null;
    const teamColor = team ? team.color : player.color;

    io.emit('chatMessage', {
      id: Math.random().toString(36).substring(2, 11),
      playerId: socket.id,
      username: player.username || 'Unknown',
      text,
      timestamp: Date.now(),
      teamId: player.teamId || null,
      teamColor,
    });
  });

  // Handle AFK toggle
  socket.on('toggleAFK', () => {
    const player = players.get(socket.id);
    if (!player || player.isDying || player.isAI) return;

    // If already AFK, exit AFK mode immediately
    if (player.isAFK) {
      player.isAFK = false;
      player.afkActivationStartTime = 0;
      afkActivationTimers.delete(socket.id);

      socket.emit('afkStatusChanged', { isAFK: false });
      console.log(`Player ${player.username} exited AFK mode`);
      return;
    }

    // Check if player is inside their own team base
    if (!isPlayerInsideOwnBase(player)) {
      socket.emit('afkError', {
        message: 'You must be in your team\'s base to go AFK'
      });
      return;
    }

    // Start AFK activation timer
    player.afkActivationStartTime = Date.now();
    player.afkActivationX = player.x;
    player.afkActivationY = player.y;

    socket.emit('afkActivationStarted', {
      duration: AFK_ACTIVATION_TIME_MS
    });

    console.log(`Player ${player.username} started AFK activation`);
  });

  // Handle evolution selection
  socket.on('evolve', (spikeType) => {
    const player = players.get(socket.id);
    if (!player || player.isDying) return;

    // Validate spike type exists in config
    if (!EVOLUTION_CONFIG[spikeType]) return;

    // Determine which tier this spike belongs to
    const tier1Spikes = ['Prickle', 'Thorn', 'Bristle', 'Bulwark', 'Starflare', 'Mauler'];
    const isTier1 = tier1Spikes.includes(spikeType);
    const isTier2 = !isTier1;

    // Check if player can evolve to this tier
    const canEvolveTier1 = !player.hasEvolved && player.score >= EVOLUTION_THRESHOLD && isTier1;
    const canEvolveTier2 = player.hasEvolved && !player.tier2Evolved && player.score >= TIER_2_THRESHOLD && isTier2;

    if (canEvolveTier1 || canEvolveTier2) {
      player.spikeType = spikeType;

      if (isTier1) {
        player.hasEvolved = true;
        // Set visual size offset to tier 1 threshold
        // This makes the player appear as if they evolved at 5k and grew to current score
        player.evolutionScoreOffset = EVOLUTION_THRESHOLD;
      } else if (isTier2) {
        player.tier2Evolved = true;
        // Set visual size offset to tier 2 threshold
        // This makes the player appear as if they evolved at 15k and grew to current score
        player.evolutionScoreOffset = TIER_2_THRESHOLD;
      }

      // Stat multipliers (speed/damage/health) are applied dynamically in movement,
      // collision, and max-HP calculations based on EVOLUTION_CONFIG[spikeType].
    }
  });

  // Handle ability usage
  socket.on('useAbility', () => {
    const player = players.get(socket.id);
    if (!player || player.isDying || player.isAFK) return;

    // Check if player has evolved
    if (!player.hasEvolved || !player.spikeType || player.spikeType === 'Spike') return;

    const config = EVOLUTION_CONFIG[player.spikeType];
    if (!config) return;

    const now = Date.now();
    const cooldown = config.abilityCooldown;

    // Check cooldown
    if (now - player.lastAbilityTime < cooldown) {
      socket.emit('abilityError', {
        message: 'Ability is on cooldown.'
      });
      return;
    }

    // Double Speed (Bristle and variants) can only be used while moving
    const speedAbilities = ['Bristle', 'BristleBlitz', 'BristleStrider', 'BristleSkirmisher'];
    if (speedAbilities.includes(player.spikeType)) {
      const isMoving = player.inputs.up || player.inputs.down || player.inputs.left || player.inputs.right;
      if (!isMoving) {
        socket.emit('abilityError', {
          message: 'Must be moving to use speed ability.'
        });
        return;
      }
    }

    // Activate ability based on spike type
    player.lastAbilityTime = now;
    player.abilityActive = true;
    player.abilityProgress = 0;

    // Notify client that ability was successfully used
    socket.emit('abilityUsed', {
      cooldownMs: cooldown,
      usedAt: now,
      duration: config.abilityDuration,
      abilityType: player.spikeType,
    });

    // Handle specific ability effects
    switch (player.spikeType) {
      // Tier 1 abilities
      case 'Prickle': // Super Density - orange shield visual
        // Effect handled in collision detection
        break;
      case 'Thorn': // Ghost Mode - pass through spikes
        // Effect handled in collision detection
        break;
      case 'Bristle': // Double Speed
        // Effect handled in movement calculation
        break;
      case 'Bulwark': // Invincibility
        // Effect handled in collision detection
        break;
      case 'Starflare': // Teleportation to base
        {
          const team = TEAMS.find(t => t.id === player.teamId);
          if (team) {
            const base = team.base;
            const padding = 100;
            player.x = base.x + padding + Math.random() * (base.width - padding * 2);
            player.y = base.y + padding + Math.random() * (base.height - padding * 2);
            player.vx = 0;
            player.vy = 0;
          }
        }
        break;
      case 'Mauler': // Fortress - defense shield
        // Effect handled in collision detection
        break;

      // Tier 2 - Prickle variants
      case 'PrickleVanguard': // Overdensity - 2.2x damage + shield + 30% damage reduction
        // Effect handled in collision detection
        break;
      case 'PrickleSwarm': // Spine Storm - rapid contact damage ticks
        // Mark that this player has spine storm active
        player.spineStormActive = true;
        player.spineStormLastTick = now;
        break;
      case 'PrickleBastion': // Spine Bulwark - 50% damage reduction + 25% reflect
        // Effect handled in collision detection
        break;

      // Tier 2 - Thorn variants
      case 'ThornWraith': // Wraith Walk - enhanced ghost mode
        // Effect handled in collision detection
        break;
      case 'ThornReaper': // Execution Lunge - next hit +40% damage + slow
        // Mark that this player will slow enemies on hit
        player.executionLungeActive = true;
        break;
      case 'ThornShade': // Shadow Slip - instant dash
        {
          // Instant dash in the direction of movement
          const isMoving = player.inputs.up || player.inputs.down || player.inputs.left || player.inputs.right;
          if (isMoving) {
            let dashX = 0;
            let dashY = 0;
            if (player.inputs.up) dashY -= 1;
            if (player.inputs.down) dashY += 1;
            if (player.inputs.left) dashX -= 1;
            if (player.inputs.right) dashX += 1;

            // Normalize direction
            const dashDist = Math.sqrt(dashX * dashX + dashY * dashY);
            if (dashDist > 0) {
              dashX /= dashDist;
              dashY /= dashDist;

              // Dash distance
              const dashLength = 150;
              player.x += dashX * dashLength;
              player.y += dashY * dashLength;

              // Clamp to map bounds
              player.x = Math.max(50, Math.min(GAME_CONFIG.MAP_WIDTH - 50, player.x));
              player.y = Math.max(50, Math.min(GAME_CONFIG.MAP_HEIGHT - 50, player.y));
            }
          }
        }
        break;

      // Tier 2 - Bristle variants
      case 'BristleBlitz': // Triple Rush - 2.3x speed
        // Effect handled in movement calculation
        break;
      case 'BristleStrider': // Trailing Surge - 2x speed + damaging trail
        // Initialize trail array if not exists
        if (!player.damageTrail) {
          player.damageTrail = [];
        }
        break;
      case 'BristleSkirmisher': // Kinetic Guard - 1.8x speed + 20% damage reduction
        // Effect handled in movement calculation and collision
        break;

      // Tier 2 - Bulwark variants
      case 'BulwarkAegis': // Fortified Aegis - invincibility + knockback resistance
        // Effect handled in collision detection
        break;
      case 'BulwarkCitadel': // Bastion Field - aura that helps allies
        // Effect handled in collision detection
        break;
      case 'BulwarkJuggernaut': // Unstoppable - invincible + no slow/knockback
        // Effect handled in collision detection
        break;

      // Tier 2 - Starflare variants
      case 'StarflarePulsar': // Offensive Warp - teleport + shockwave
        {
          const team = TEAMS.find(t => t.id === player.teamId);
          if (team) {
            const base = team.base;
            const padding = 100;
            player.x = base.x + padding + Math.random() * (base.width - padding * 2);
            player.y = base.y + padding + Math.random() * (base.height - padding * 2);
            player.vx = 0;
            player.vy = 0;
            // Mark shockwave position and time
            player.shockwaveX = player.x;
            player.shockwaveY = player.y;
            player.shockwaveTime = now;
          }
        }
        break;
      case 'StarflareHorizon': // Short Blink - short-range teleport
        {
          // Blink in the direction of movement
          const isMoving = player.inputs.up || player.inputs.down || player.inputs.left || player.inputs.right;
          if (isMoving) {
            let blinkX = 0;
            let blinkY = 0;
            if (player.inputs.up) blinkY -= 1;
            if (player.inputs.down) blinkY += 1;
            if (player.inputs.left) blinkX -= 1;
            if (player.inputs.right) blinkX += 1;

            // Normalize direction
            const blinkDist = Math.sqrt(blinkX * blinkX + blinkY * blinkY);
            if (blinkDist > 0) {
              blinkX /= blinkDist;
              blinkY /= blinkDist;

              // Blink distance
              const blinkLength = 300;
              player.x += blinkX * blinkLength;
              player.y += blinkY * blinkLength;

              // Clamp to map bounds
              player.x = Math.max(50, Math.min(GAME_CONFIG.MAP_WIDTH - 50, player.x));
              player.y = Math.max(50, Math.min(GAME_CONFIG.MAP_HEIGHT - 50, player.y));
            }
          }
        }
        break;
      case 'StarflareNova': // Nova Shift - teleport to base + delayed explosion at origin
        {
          // Store old position for explosion
          const oldX = player.x;
          const oldY = player.y;

          // Teleport to base (like StarflarePulsar but without shockwave)
          const team = TEAMS.find(t => t.id === player.teamId);
          if (team) {
            const base = team.base;
            const padding = 100;
            player.x = base.x + padding + Math.random() * (base.width - padding * 2);
            player.y = base.y + padding + Math.random() * (base.height - padding * 2);
            player.vx = 0;
            player.vy = 0;
          }

          // Create delayed explosion at old position
          player.novaExplosionX = oldX;
          player.novaExplosionY = oldY;
          player.novaExplosionTime = now + 700; // Detonate after 0.7s
        }
        break;

      // Tier 2 - Mauler variants
      case 'MaulerRavager': // Rend - apply bleed on hits
        // Effect handled in collision detection
        break;
      case 'MaulerBulwark': // Fortified Fortress - stronger shield + thorns
        // Effect handled in collision detection
        break;
      case 'MaulerApex': // Blood Frenzy - +25% damage, +15% speed, +15% damage taken
        // Effect handled in collision and movement
        break;
    }

    // Schedule ability deactivation
    setTimeout(() => {
      if (players.has(socket.id)) {
        const p = players.get(socket.id);
        p.abilityActive = false;
        p.abilityProgress = 0;
        // Clear ability-specific flags
        p.executionLungeActive = false;
        p.spineStormActive = false;
        if (p.damageTrail) {
          p.damageTrail = [];
        }
      }
    }, config.abilityDuration);
  });

  // Handle respawn request
  socket.on('respawn', (username) => {
    // Validate and sanitize username
    let playerName = username?.trim() || '';

    if (!playerName || playerName.toLowerCase() === 'noname') {
      playerName = generateRandomUsername();
    }

    playerName = playerName.substring(0, 20);

    // Create new player object (respawn) on a random team
    const team = getRandomTeam();
    const spawnPos = getRandomSpawnPositionForTeam(team);
    const player = {
      id: socket.id,
      username: playerName,
      x: spawnPos.x,
      y: spawnPos.y,
      vx: 0,
      vy: 0,
      size: GAME_CONFIG.PLAYER_SIZE,
      color: team.color,
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
      isAI: false,
      teamId: team.id,
      // Evolution properties (reset on respawn)
      spikeType: 'Spike',
      hasEvolved: false,
      tier2Evolved: false,
      evolutionScoreOffset: 0,
      lastAbilityTime: 0,
      abilityActive: false,
      abilityProgress: 0,
      // AFK properties (reset on respawn)
      isAFK: false,
      afkActivationStartTime: 0,
      afkActivationX: 0,
      afkActivationY: 0,
      // Chain system properties
      segments: createSegments(spawnPos.x, spawnPos.y, 0, GAME_CONFIG.PLAYER_SIZE, 10), // Initialize with 1 segment
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
        teamBases: TEAMS.map(team => ({
          id: team.id,
          color: team.color,
          x: team.base.x,
          y: team.base.y,
          width: team.base.width,
          height: team.base.height,
        })),
      },
    });

    // Notify other players
    socket.broadcast.emit('playerJoined', player);

    console.log(`Player respawned: ${playerName} (${socket.id})`);
  });

  // Handle player leaving game (going to menu without disconnecting)
  socket.on('leaveGame', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`Player leaving game: ${player.username} (${socket.id})`);

      // Save player stats to database (for authenticated users)
      // No death, so deaths = 0
      savePlayerStats(player, {
        kills: player.kills,
        deaths: 0,
        foodEaten: player.foodEaten,
        premiumOrbsEaten: player.premiumOrbsEaten,
        score: player.score,
      });

      // Save evolution progress to database (for authenticated users)
      saveEvolutionProgress(player);

      // Remove player from game
      players.delete(socket.id);

      // Clean up AFK timer if exists
      afkActivationTimers.delete(socket.id);

      // Clean up chat timeout if exists
      chatTimeouts.delete(socket.id);

      // Notify all clients about player leaving
      io.emit('playerLeft', socket.id);
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    const player = players.get(socket.id);
    if (player) {
      console.log(`Player disconnected: ${player.username} (${socket.id}) from IP: ${clientIP}`);

      // Don't save AI players or players that are already in a death
      // animation for reconnection. If they were dying when the socket
      // dropped, they should respawn fresh instead of resurrecting a
      // nearly-dead state.
      if (!player.isAI && !player.isDying) {
        // Determine reconnection key - prioritize user ID for authenticated users
        const reconnectionKey = player.userId ? `user:${player.userId}` : `ip:${clientIP}`;

        // Set a timeout to remove the player after 60 seconds
        const timeoutId = setTimeout(() => {
          const disconnectedData = disconnectedPlayers.get(reconnectionKey);
          if (disconnectedData && disconnectedData.player.id === socket.id) {
            // Remove from disconnected players
            disconnectedPlayers.delete(reconnectionKey);

            // Remove from active players if still there
            if (players.has(socket.id)) {
              players.delete(socket.id);

              // Notify all clients about player leaving
              io.emit('playerLeft', socket.id);
            }

            console.log(`⏱️ Reconnection window expired for ${player.username} (${reconnectionKey})`);
          }
        }, RECONNECTION_TIMEOUT_MS);

        // Store player data with reconnection key
        disconnectedPlayers.set(reconnectionKey, {
          player: player,
          disconnectTime: Date.now(),
          timeoutId: timeoutId,
          reconnectionKey: reconnectionKey,
        });

        console.log(`💾 Player ${player.username} saved for reconnection (${reconnectionKey}). Entity remains in game for 60 seconds.`);

        // Save evolution progress to database (for authenticated users)
        saveEvolutionProgress(player);

        // DON'T remove from active players yet - keep the entity in the game
        // This allows the player to see their spike when they reconnect
        // The entity will be removed after 60 seconds if they don't reconnect
      } else {
        // AI players or dying players - remove immediately
        players.delete(socket.id);

        // Clean up AFK timer if exists
        afkActivationTimers.delete(socket.id);

        // Clean up chat timeout if exists
        chatTimeouts.delete(socket.id);

        // Notify all clients about player leaving
        io.emit('playerLeft', socket.id);
      }
    }
  });

  // Socket error handling
  socket.on('error', (error) => {
    console.error('❌ Socket error:', {
      socketId: socket.id,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString(),
    });
  });

  socket.on('connect_error', (error) => {
    console.error('❌ Socket connection error:', {
      socketId: socket.id,
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  });
});

// Socket.IO error handling
io.engine.on('connection_error', (err) => {
  console.error('❌ Engine.IO connection error:', {
    code: err.code,
    message: err.message,
    context: err.context,
    timestamp: new Date().toISOString(),
  });
});

// Game loop - update game state and broadcast to all clients
function gameLoop() {
  // Single timestamp for this tick
  const now = Date.now();

  // Ensure AI entities are present
  ensureAIEntities();

  // Track how many AI hunters are targeting each player so we can spread aggro
  const targetCounts = new Map();

  // Update all players based on their inputs / AI behaviour
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

    // Check AFK activation progress (for non-AI players)
    if (!player.isAI && player.afkActivationStartTime > 0 && !player.isAFK) {
      const elapsed = now - player.afkActivationStartTime;
      const distanceMoved = Math.sqrt(
        Math.pow(player.x - player.afkActivationX, 2) +
        Math.pow(player.y - player.afkActivationY, 2)
      );

      // Check if player moved or left base during activation
      if (distanceMoved > 5 || !isPlayerInsideOwnBase(player)) {
        // Cancel AFK activation
        player.afkActivationStartTime = 0;
        io.to(player.id).emit('afkActivationCancelled', {
          reason: distanceMoved > 5 ? 'You moved' : 'You left your base'
        });
      } else if (elapsed >= AFK_ACTIVATION_TIME_MS) {
        // Activate AFK mode
        player.isAFK = true;
        player.afkActivationStartTime = 0;
        io.to(player.id).emit('afkStatusChanged', { isAFK: true });
        console.log(`Player ${player.username} is now AFK`);
      }
    }

    // Skip movement for AFK players
    if (player.isAFK) {
      return;
    }

    // Calculate size multiplier for speed scaling
    const effectiveScoreForSize = player.isAI ? AI_CONFIG.BASE_SCORE : player.score;
    const evolutionOffset = player.isAI ? 0 : (player.evolutionScoreOffset || 0);
    const sizeMultiplier = getSizeMultiplier(effectiveScoreForSize, evolutionOffset);
    // Calculate player's actual size based on score (needed for trail damage radius)
    const actualSize = GAME_CONFIG.PLAYER_SIZE * sizeMultiplier;
    // Bigger players are slower (inverse relationship)
    // At 1x size: 100% speed, at 2x size: ~71% speed, at 3x size: ~58% speed
    let speedMultiplier = 1 / Math.sqrt(sizeMultiplier);
    // AI hunters are slightly slower than players
    if (player.isAI) {
      speedMultiplier *= AI_CONFIG.SPEED_FACTOR || 0.85;
    }
    // Apply evolution speed multiplier
    if (player.spikeType && EVOLUTION_CONFIG[player.spikeType]) {
      speedMultiplier *= EVOLUTION_CONFIG[player.spikeType].speed;
    }
    // Bristle: Double Speed ability
    if (player.abilityActive && player.spikeType === 'Bristle') {
      speedMultiplier *= 2;
    }
    // BristleBlitz: Triple Rush - 2.3x speed
    if (player.abilityActive && player.spikeType === 'BristleBlitz') {
      speedMultiplier *= 2.3;
    }
    // BristleStrider: Trailing Surge - 2x speed
    if (player.abilityActive && player.spikeType === 'BristleStrider') {
      speedMultiplier *= 2;
    }
    // BristleSkirmisher: Kinetic Guard - 1.8x speed
    if (player.abilityActive && player.spikeType === 'BristleSkirmisher') {
      speedMultiplier *= 1.8;
    }
    // MaulerApex: Blood Frenzy - +15% speed
    if (player.abilityActive && player.spikeType === 'MaulerApex') {
      speedMultiplier *= 1.15;
    }
    // Apply slow effect from ThornReaper's Execution Lunge
    if (player.slowedUntil && now < player.slowedUntil) {
      speedMultiplier *= (player.slowFactor || 0.5);
    } else if (player.slowedUntil) {
      // Clear slow effect when expired
      player.slowedUntil = null;
      player.slowFactor = null;
    }
    const adjustedSpeed = GAME_CONFIG.PLAYER_SPEED * speedMultiplier;

    // Calculate target velocity based on inputs (players) or AI behaviour
    let targetVx = 0;
    let targetVy = 0;

    if (player.isAI) {
      // Smarter chase: move toward nearby non-AI players, but spread aggro and
      // never chase players who are safely inside any team base.
      let targetPlayer = null;
      let closestDist = Infinity;
      let bestScore = Infinity;

      players.forEach((other) => {
        if (!other || other.id === player.id) return;
        if (other.isAI) return; // AI do not target each other
        if (other.isDying) return;
        if (isPlayerInsideAnyBase(other)) return; // Don't chase players inside bases

        const dx = other.x - player.x;
        const dy = other.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > AI_CONFIG.FOV_RADIUS) return;

        // Spread AI targets across players: prefer players with fewer AI already chasing them.
        const currentTargets = targetCounts.get(other.id) || 0;
        const spreadWeight = 300; // Tuned so multiple AI don't all hard-focus one player
        const score = dist + currentTargets * spreadWeight;

        if (score < bestScore) {
          bestScore = score;
          closestDist = dist;
          targetPlayer = other;
        }
      });

      if (targetPlayer && closestDist > 0) {
        const dx = targetPlayer.x - player.x;
        const dy = targetPlayer.y - player.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const dirX = dx / dist;
        const dirY = dy / dist;

        targetVx = dirX * adjustedSpeed;
        targetVy = dirY * adjustedSpeed;

        // Record that this target now has one more AI focusing it
        const count = targetCounts.get(targetPlayer.id) || 0;
        targetCounts.set(targetPlayer.id, count + 1);
      } else {
        // No target in view – gradually slow down via deceleration below
        targetVx = 0;
        targetVy = 0;
      }
    } else {
      // Human player controlled via inputs
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
    }

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

    // BristleStrider: Trailing Surge - record damage trail positions
    if (player.abilityActive && player.spikeType === 'BristleStrider') {
      if (!player.damageTrail) {
        player.damageTrail = [];
      }
      // Add current position to trail
      player.damageTrail.push({
        x: player.x,
        y: player.y,
        timestamp: now,
        radius: actualSize * 0.8, // Trail damage radius
      });
      // Keep only recent trail positions (last 500ms)
      player.damageTrail = player.damageTrail.filter(pos => now - pos.timestamp < 500);
    }

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

    // Enforce map boundaries (actualSize already calculated above)
    const totalSize = actualSize * 1.29; // body radius + thorn length (scaled)
    player.x = Math.max(totalSize, Math.min(GAME_CONFIG.MAP_WIDTH - totalSize, player.x));
    player.y = Math.max(totalSize, Math.min(GAME_CONFIG.MAP_HEIGHT - totalSize, player.y));

    // Enforce team base boundaries
    // Human players can move freely inside their own base, but touching any other
    // team's base is instantly lethal. AI hunters die on contact with any base
    // so they never camp near spawn areas.
    TEAMS.forEach((team) => {
      const base = team.base;
      const circleOverlaps = isCircleOverlappingBase(base, player.x, player.y, totalSize);

      if (!circleOverlaps) return;

      const isPlayerOnThisTeam = !player.isAI && player.teamId === team.id;

      // Players are allowed inside their own base
      if (isPlayerOnThisTeam) {
        return;
      }

      // Lethal base contact for AI and for players entering another team's base
      if (player.isAI || (player.teamId && player.teamId !== team.id)) {
        if (!player.isDying) {
          const currentTime = Date.now();
          const timeSurvived = Math.floor((currentTime - player.spawnTime) / 1000); // in seconds

          player.isDying = true;
          player.deathStartTime = currentTime;
          player.deathProgress = 0;
          // Stop all movement immediately
          player.vx = 0;
          player.vy = 0;
          player.targetVx = 0;
          player.targetVy = 0;

          // Environment kill: no killer, no score distribution
          io.emit('playerDied', {
            playerId: player.id,
            killedBy: null,
            assists: [],
            stats: {
              timeSurvived: timeSurvived,
              kills: player.kills,
              foodEaten: player.foodEaten,
              premiumOrbsEaten: player.premiumOrbsEaten,
              score: player.score,
            },
            killerScore: 0,
          });

          // Save player stats to database (for authenticated users)
          savePlayerStats(player, {
            kills: player.kills,
            deaths: 1,
            foodEaten: player.foodEaten,
            premiumOrbsEaten: player.premiumOrbsEaten,
            score: player.score,
          });
        }

        return;
      }

      // Fallback: if a player without a team somehow exists, gently push them out
      const leftDist = player.x - base.x;
      const rightDist = base.x + base.width - player.x;
      const topDist = player.y - base.y;
      const bottomDist = base.y + base.height - player.y;
      const minDist = Math.min(leftDist, rightDist, topDist, bottomDist);

      if (minDist === leftDist) {
        player.x = base.x - totalSize;
      } else if (minDist === rightDist) {
        player.x = base.x + base.width + totalSize;
      } else if (minDist === topDist) {
        player.y = base.y - totalSize;
      } else {
        player.y = base.y + base.height + totalSize;
      }
    });

    // If this player was killed by base contact this tick, skip further updates
    if (player.isDying) {
      return;
    }

    if (!player.isAI) {
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
    }

    // Update max HP based on score and evolution health multiplier (AI use fixed 500-score baseline for toughness)
    const effectiveScoreForHP = player.isAI ? AI_CONFIG.BASE_SCORE : player.score;
    const baseMaxHP = getMaxHP(effectiveScoreForHP);
    const healthMultiplier = (player.spikeType && EVOLUTION_CONFIG[player.spikeType])
      ? EVOLUTION_CONFIG[player.spikeType].health
      : 1;
    const newMaxHP = Math.max(1, Math.floor(baseMaxHP * healthMultiplier));

    if (!player.maxHP) {
      player.maxHP = newMaxHP;
      player.currentHP = newMaxHP;
    } else if (player.maxHP !== newMaxHP) {
      const hpRatio = player.currentHP / player.maxHP;
      player.maxHP = newMaxHP;
      player.currentHP = Math.max(1, Math.floor(newMaxHP * Math.max(0, Math.min(1, hpRatio))));
    }

    // Keep health percentage in sync for UI and regen
    player.health = Math.min(100, Math.max(0, (player.currentHP / player.maxHP) * 100));

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

  // PrickleSwarm: Spine Storm - rapid damage ticks to nearby enemies
  players.forEach((player) => {
    if (player.spineStormActive && player.abilityActive && player.spikeType === 'PrickleSwarm') {
      const currentTime = Date.now();
      const tickInterval = 200; // Damage tick every 200ms
      if (!player.spineStormLastTick || currentTime - player.spineStormLastTick >= tickInterval) {
        player.spineStormLastTick = currentTime;

        const effectiveScore = player.isAI ? AI_CONFIG.BASE_SCORE : player.score;
        const evolutionOffset = player.isAI ? 0 : (player.evolutionScoreOffset || 0);
        const playerSize = GAME_CONFIG.PLAYER_SIZE * getSizeMultiplier(effectiveScore, evolutionOffset);
        const stormRadius = playerSize * 2.5; // Short radius around player

        // Deal damage to all nearby enemies
        players.forEach((target) => {
          if (target.id === player.id) return;
          if (target.isDying) return;
          if (player.isAI && target.isAI) return; // AI don't damage each other
          if (player.teamId && player.teamId === target.teamId) return; // Same team

          const dx = target.x - player.x;
          const dy = target.y - player.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < stormRadius) {
            // Deal small rapid damage
            const tickDamage = Math.max(1, Math.round(getDamagePoints(effectiveScore) * 0.3));
            target.currentHP -= tickDamage;
            target.currentHP = Math.max(0, target.currentHP);
            target.health = (target.currentHP / target.maxHP) * 100;

            // Track damage for assists
            const currentDamage = target.damageDealt.get(player.id) || 0;
            target.damageDealt.set(player.id, currentDamage + tickDamage);
          }
        });
      }
    }
  });

  // BristleStrider: Trailing Surge - check trail collisions
  players.forEach((player) => {
    if (player.damageTrail && player.damageTrail.length > 0 && player.abilityActive && player.spikeType === 'BristleStrider') {
      const effectiveScore = player.isAI ? AI_CONFIG.BASE_SCORE : player.score;

      players.forEach((target) => {
        if (target.id === player.id) return;
        if (target.isDying) return;
        if (player.isAI && target.isAI) return;
        if (player.teamId && player.teamId === target.teamId) return;

        // Check if target is touching any trail position
        for (const trailPos of player.damageTrail) {
          const dx = target.x - trailPos.x;
          const dy = target.y - trailPos.y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < trailPos.radius) {
            // Deal trail damage (once per trail segment to avoid spam)
            if (!target.lastTrailDamageTime || Date.now() - target.lastTrailDamageTime > 300) {
              const trailDamage = Math.max(1, Math.round(getDamagePoints(effectiveScore) * 0.5));
              target.currentHP -= trailDamage;
              target.currentHP = Math.max(0, target.currentHP);
              target.health = (target.currentHP / target.maxHP) * 100;
              target.lastTrailDamageTime = Date.now();

              // Track damage for assists
              const currentDamage = target.damageDealt.get(player.id) || 0;
              target.damageDealt.set(player.id, currentDamage + trailDamage);
            }
            break; // Only damage once per frame
          }
        }
      });
    }
  });

  // StarflarePulsar: Offensive Warp - shockwave damage on arrival
  players.forEach((player) => {
    if (player.shockwaveTime && Date.now() - player.shockwaveTime < 500) {
      // Shockwave lasts for 500ms after teleport
      const shockwaveX = player.shockwaveX;
      const shockwaveY = player.shockwaveY;
      const shockwaveRadius = 150;
      const effectiveScore = player.isAI ? AI_CONFIG.BASE_SCORE : player.score;
      const baseDamage = getDamagePoints(effectiveScore);

      // Deal damage to all enemies in shockwave radius (once per shockwave)
      if (!player.shockwaveDamaged) {
        player.shockwaveDamaged = new Set();
      }

      players.forEach((target) => {
        if (target.id === player.id) return;
        if (target.isDying) return;
        if (player.isAI && target.isAI) return;
        if (player.teamId && player.teamId === target.teamId) return;
        if (player.shockwaveDamaged.has(target.id)) return; // Already damaged by this shockwave

        const dx = target.x - shockwaveX;
        const dy = target.y - shockwaveY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < shockwaveRadius) {
          const shockwaveDamage = Math.max(1, Math.round(baseDamage * 2)); // 2x base damage

          target.currentHP -= shockwaveDamage;
          target.currentHP = Math.max(0, target.currentHP);
          target.health = (target.currentHP / target.maxHP) * 100;

          // Track damage for assists
          const currentDamage = target.damageDealt.get(player.id) || 0;
          target.damageDealt.set(player.id, currentDamage + shockwaveDamage);

          // Mark as damaged by this shockwave
          player.shockwaveDamaged.add(target.id);

          // Apply knockback
          if (distance > 0) {
            const knockbackStrength = 12;
            const nx = dx / distance;
            const ny = dy / distance;
            target.vx += nx * knockbackStrength;
            target.vy += ny * knockbackStrength;
          }
        }
      });
    } else if (player.shockwaveTime && Date.now() - player.shockwaveTime >= 500) {
      // Clear shockwave data after it expires
      player.shockwaveX = null;
      player.shockwaveY = null;
      player.shockwaveTime = null;
      player.shockwaveDamaged = null;
    }
  });

  // StarflareNova: Nova Shift - check for delayed explosions
  players.forEach((player) => {
    if (player.novaExplosionTime && Date.now() >= player.novaExplosionTime) {
      const explosionX = player.novaExplosionX;
      const explosionY = player.novaExplosionY;
      const explosionRadius = 200; // Large AoE explosion
      const effectiveScore = player.isAI ? AI_CONFIG.BASE_SCORE : player.score;
      const baseDamage = getDamagePoints(effectiveScore);

      // Deal damage to all enemies in explosion radius
      players.forEach((target) => {
        if (target.id === player.id) return;
        if (target.isDying) return;
        if (player.isAI && target.isAI) return;
        if (player.teamId && player.teamId === target.teamId) return;

        const dx = target.x - explosionX;
        const dy = target.y - explosionY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < explosionRadius) {
          // Damage falls off with distance
          const damageFalloff = 1 - (distance / explosionRadius);
          const explosionDamage = Math.max(1, Math.round(baseDamage * 0.2 * damageFalloff)); // 20% base damage at center

          target.currentHP -= explosionDamage;
          target.currentHP = Math.max(0, target.currentHP);
          target.health = (target.currentHP / target.maxHP) * 100;

          // Track damage for assists
          const currentDamage = target.damageDealt.get(player.id) || 0;
          target.damageDealt.set(player.id, currentDamage + explosionDamage);

          // Apply knockback from explosion
          if (distance > 0) {
            const knockbackStrength = 15 * damageFalloff;
            const nx = dx / distance;
            const ny = dy / distance;
            target.vx += nx * knockbackStrength;
            target.vy += ny * knockbackStrength;
          }
        }
      });

      // Clear explosion data
      player.novaExplosionX = null;
      player.novaExplosionY = null;
      player.novaExplosionTime = null;
    }
  });

  // Check player-to-player collisions
  const playerArray = Array.from(players.values());
  for (let i = 0; i < playerArray.length; i++) {
    const player1 = playerArray[i];
    if (player1.isDying) continue;
    const evolutionOffset1 = player1.isAI ? 0 : (player1.evolutionScoreOffset || 0);
    const size1 = GAME_CONFIG.PLAYER_SIZE * getSizeMultiplier(player1.isAI ? AI_CONFIG.BASE_SCORE : player1.score, evolutionOffset1);

    for (let j = i + 1; j < playerArray.length; j++) {
      const player2 = playerArray[j];
      if (player2.isDying) continue;
      const evolutionOffset2 = player2.isAI ? 0 : (player2.evolutionScoreOffset || 0);
      const size2 = GAME_CONFIG.PLAYER_SIZE * getSizeMultiplier(player2.isAI ? AI_CONFIG.BASE_SCORE : player2.score, evolutionOffset2);

      // Calculate distance between players
      const dx = player2.x - player1.x;
      const dy = player2.y - player1.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // Check if players are colliding (using outer spike radius)
      const collisionDistance = size1 * 1.29 + size2 * 1.29;

      if (distance < collisionDistance) {
        // Collision detected!
        const currentTime = Date.now();

        // Check for Ghost Mode ability (Thorn and variants) - pass through spikes
        const ghostModeSpikes = ['Thorn', 'ThornWraith', 'ThornShade'];
        const player1GhostMode = player1.abilityActive && ghostModeSpikes.includes(player1.spikeType);
        const player2GhostMode = player2.abilityActive && ghostModeSpikes.includes(player2.spikeType);

        // If either player has ghost mode, skip collision entirely
        if (player1GhostMode || player2GhostMode) {
          continue;
        }

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
        let baseImpulse = 4; // tuned for noticeable push at current speeds

        // Mauler: Fortress ability - 3x knockback
        if (player1.abilityActive && player1.spikeType === 'Mauler') {
          baseImpulse *= 3;
        }
        if (player2.abilityActive && player2.spikeType === 'Mauler') {
          baseImpulse *= 3;
        }

        // MaulerBulwark: Fortified Fortress - 3x knockback
        if (player1.abilityActive && player1.spikeType === 'MaulerBulwark') {
          baseImpulse *= 3;
        }
        if (player2.abilityActive && player2.spikeType === 'MaulerBulwark') {
          baseImpulse *= 3;
        }

        // BulwarkCitadel: Bastion Field - knockback enemies
        if (player1.abilityActive && player1.spikeType === 'BulwarkCitadel') {
          baseImpulse *= 2;
        }
        if (player2.abilityActive && player2.spikeType === 'BulwarkCitadel') {
          baseImpulse *= 2;
        }

        const depthFactor = Math.min(overlap / (GAME_CONFIG.PLAYER_SIZE * 0.8), 2); // 0..2
        const impulseStrength = baseImpulse * (1 + 0.5 * depthFactor);

        player1.vx -= nx * impulseStrength;
        player1.vy -= ny * impulseStrength;
        player2.vx += nx * impulseStrength;
        player2.vy += ny * impulseStrength;

        // Only apply damage if enough time has passed since last collision (cooldown: 0.5s)
        // AI entities never damage each other
        const bothAI = Boolean(player1.isAI && player2.isAI);
        const sameTeam = Boolean(player1.teamId && player1.teamId === player2.teamId);
        const canDamage1 = !bothAI && !sameTeam && (currentTime - player1.lastCollisionTime) > 500;
        const canDamage2 = !bothAI && !sameTeam && (currentTime - player2.lastCollisionTime) > 500;

        if (canDamage1 || canDamage2) {
          // Base damage from score progression (AI use fixed 500-score baseline)
          const effectiveScore1 = player1.isAI ? AI_CONFIG.BASE_SCORE : player1.score;
          const effectiveScore2 = player2.isAI ? AI_CONFIG.BASE_SCORE : player2.score;
          const baseDamageFrom1To2 = getDamagePoints(effectiveScore1);
          const baseDamageFrom2To1 = getDamagePoints(effectiveScore2);

          // Current speeds (magnitude of velocity vector)
          const speed1 = Math.sqrt((player1.vx || 0) * (player1.vx || 0) + (player1.vy || 0) * (player1.vy || 0));
          const speed2 = Math.sqrt((player2.vx || 0) * (player2.vx || 0) + (player2.vy || 0) * (player2.vy || 0));

          // Normalize speeds relative to base max speed
          const maxBaseSpeed = GAME_CONFIG.PLAYER_SPEED || 1;
          const speedNorm1 = Math.min(speed1 / maxBaseSpeed, 1);
          const speedNorm2 = Math.min(speed2 / maxBaseSpeed, 1);

          // Momentum-based damage scaling (balanced)
          // At 0 speed -> 0.7x base damage, at max speed -> 1.8x base damage
          let factor1 = 0.7 + speedNorm1 * 1.1;
          let factor2 = 0.7 + speedNorm2 * 1.1;

          // Apply evolution damage multipliers
          if (player1.spikeType && EVOLUTION_CONFIG[player1.spikeType]) {
            factor1 *= EVOLUTION_CONFIG[player1.spikeType].damage;
          }
          if (player2.spikeType && EVOLUTION_CONFIG[player2.spikeType]) {
            factor2 *= EVOLUTION_CONFIG[player2.spikeType].damage;
          }

          // Apply ability damage multipliers
          // Prickle: Super Density - 2x damage dealt
          if (player1.abilityActive && player1.spikeType === 'Prickle') {
            factor1 *= 2;
          }
          if (player2.abilityActive && player2.spikeType === 'Prickle') {
            factor2 *= 2;
          }

          // PrickleVanguard: Overdensity - 2.2x damage dealt
          if (player1.abilityActive && player1.spikeType === 'PrickleVanguard') {
            factor1 *= 2.2;
          }
          if (player2.abilityActive && player2.spikeType === 'PrickleVanguard') {
            factor2 *= 2.2;
          }

          // ThornReaper: Execution Lunge - +40% damage on next hit
          if (player1.abilityActive && player1.spikeType === 'ThornReaper') {
            factor1 *= 1.4;
          }
          if (player2.abilityActive && player2.spikeType === 'ThornReaper') {
            factor2 *= 1.4;
          }

          // MaulerApex: Blood Frenzy - +25% damage dealt
          if (player1.abilityActive && player1.spikeType === 'MaulerApex') {
            factor1 *= 1.25;
          }
          if (player2.abilityActive && player2.spikeType === 'MaulerApex') {
            factor2 *= 1.25;
          }

          // Mauler: Fortress - pushes opponents away (handled in knockback)
          // Bulwark: Invincibility - no damage taken
          const player1Invincible = player1.abilityActive && (player1.spikeType === 'Bulwark' || player1.spikeType === 'BulwarkAegis' || player1.spikeType === 'BulwarkJuggernaut');
          const player2Invincible = player2.abilityActive && (player2.spikeType === 'Bulwark' || player2.spikeType === 'BulwarkAegis' || player2.spikeType === 'BulwarkJuggernaut');

          let damageFrom1To2 = Math.max(1, Math.round(baseDamageFrom1To2 * factor1));
          let damageFrom2To1 = Math.max(1, Math.round(baseDamageFrom2To1 * factor2));

          // Invincibility negates all damage
          if (player2Invincible) damageFrom1To2 = 0;
          if (player1Invincible) damageFrom2To1 = 0;

          // Damage reduction abilities
          // PrickleVanguard: Overdensity - 30% damage reduction
          if (player1.abilityActive && player1.spikeType === 'PrickleVanguard') {
            damageFrom2To1 = Math.round(damageFrom2To1 * 0.7);
          }
          if (player2.abilityActive && player2.spikeType === 'PrickleVanguard') {
            damageFrom1To2 = Math.round(damageFrom1To2 * 0.7);
          }

          // PrickleBastion: Spine Bulwark - 50% damage reduction + 25% reflect
          if (player1.abilityActive && player1.spikeType === 'PrickleBastion') {
            const reducedDamage = Math.round(damageFrom2To1 * 0.5);
            const reflectDamage = Math.round(damageFrom2To1 * 0.25);
            damageFrom2To1 = reducedDamage;
            damageFrom1To2 += reflectDamage; // Reflect damage back
          }
          if (player2.abilityActive && player2.spikeType === 'PrickleBastion') {
            const reducedDamage = Math.round(damageFrom1To2 * 0.5);
            const reflectDamage = Math.round(damageFrom1To2 * 0.25);
            damageFrom1To2 = reducedDamage;
            damageFrom2To1 += reflectDamage; // Reflect damage back
          }

          // BristleSkirmisher: Kinetic Guard - 20% damage reduction
          if (player1.abilityActive && player1.spikeType === 'BristleSkirmisher') {
            damageFrom2To1 = Math.round(damageFrom2To1 * 0.8);
          }
          if (player2.abilityActive && player2.spikeType === 'BristleSkirmisher') {
            damageFrom1To2 = Math.round(damageFrom1To2 * 0.8);
          }

          // MaulerBulwark: Fortified Fortress - 35% damage reduction + thorns
          if (player1.abilityActive && player1.spikeType === 'MaulerBulwark') {
            const reducedDamage = Math.round(damageFrom2To1 * 0.65);
            const thornsDamage = Math.round(damageFrom2To1 * 0.2);
            damageFrom2To1 = reducedDamage;
            damageFrom1To2 += thornsDamage; // Thorns damage back
          }
          if (player2.abilityActive && player2.spikeType === 'MaulerBulwark') {
            const reducedDamage = Math.round(damageFrom1To2 * 0.65);
            const thornsDamage = Math.round(damageFrom1To2 * 0.2);
            damageFrom1To2 = reducedDamage;
            damageFrom2To1 += thornsDamage; // Thorns damage back
          }

          // MaulerApex: Blood Frenzy - +15% damage taken
          if (player1.abilityActive && player1.spikeType === 'MaulerApex') {
            damageFrom2To1 = Math.round(damageFrom2To1 * 1.15);
          }
          if (player2.abilityActive && player2.spikeType === 'MaulerApex') {
            damageFrom1To2 = Math.round(damageFrom1To2 * 1.15);
          }

          // Apply damage to both players and track damage dealt
          if (canDamage2 && damageFrom1To2 > 0) {
            // Player2 receives damage based on player1's momentum
            player2.currentHP -= damageFrom1To2;
            player2.currentHP = Math.max(0, player2.currentHP);
            player2.health = (player2.currentHP / player2.maxHP) * 100;
            player2.isAngry = true;
            player2.lastCollisionTime = currentTime;
            player2.angryProgress = 0;

            // Track damage dealt by player1 to player2 (for assists)
            const currentDamage = player2.damageDealt.get(player1.id) || 0;
            player2.damageDealt.set(player1.id, currentDamage + damageFrom1To2);

            // ThornReaper: Execution Lunge - slow enemy for 3s after hit
            if (player1.executionLungeActive && player1.spikeType === 'ThornReaper') {
              player2.slowedUntil = currentTime + 3000;
              player2.slowFactor = 0.5; // 50% speed reduction
            }
          }

          if (canDamage1 && damageFrom2To1 > 0) {
            // Player1 receives damage based on player2's momentum
            player1.currentHP -= damageFrom2To1;
            player1.currentHP = Math.max(0, player1.currentHP);
            player1.health = (player1.currentHP / player1.maxHP) * 100;
            player1.isAngry = true;
            player1.lastCollisionTime = currentTime;
            player1.angryProgress = 0;

            // Track damage dealt by player2 to player1 (for assists)
            const currentDamage = player1.damageDealt.get(player2.id) || 0;
            player1.damageDealt.set(player2.id, currentDamage + damageFrom2To1);

            // ThornReaper: Execution Lunge - slow enemy for 3s after hit
            if (player2.executionLungeActive && player2.spikeType === 'ThornReaper') {
              player1.slowedUntil = currentTime + 3000;
              player1.slowFactor = 0.5; // 50% speed reduction
            }
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
            if (player1.isAI) {
              // Killing an AI hunter always grants a flat 500 points to the killer
              if (killer) {
                killer.score += 500;
                killer.kills += 1;
              }
            } else {
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

            // Save player stats to database (for authenticated users)
            savePlayerStats(player1, {
              kills: player1.kills,
              deaths: 1,
              foodEaten: player1.foodEaten,
              premiumOrbsEaten: player1.premiumOrbsEaten,
              score: deadPlayerScore,
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
            if (player2.isAI) {
              // Killing an AI hunter always grants a flat 500 points to the killer
              if (killer) {
                killer.score += 500;
                killer.kills += 1;
              }
            } else {
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

            // Save player stats to database (for authenticated users)
            savePlayerStats(player2, {
              kills: player2.kills,
              deaths: 1,
              foodEaten: player2.foodEaten,
              premiumOrbsEaten: player2.premiumOrbsEaten,
              score: deadPlayerScore,
            });

            // Player will be removed after death animation completes (in game loop)
          }
        }
      }
    }
  }

  // Update premium orbs - fleeing behavior and rotation
  premiumOrbs.forEach((orb) => {
    // Update rotation for visual effect
    orb.rotation += 0.02;

    // Calculate flee direction based on nearby players
    let fleeVx = 0;
    let fleeVy = 0;
    let nearbyPlayerCount = 0;

    players.forEach((player) => {
      if (player.isDying) return;

      const dx = orb.x - player.x;
      const dy = orb.y - player.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      // If player is within flee distance, calculate flee direction
      if (distance < GAME_CONFIG.PREMIUM_ORB_FLEE_DISTANCE && distance > 0) {
        // Flee away from player (normalized direction)
        const fleeStrength = 1 - (distance / GAME_CONFIG.PREMIUM_ORB_FLEE_DISTANCE);
        fleeVx += (dx / distance) * fleeStrength;
        fleeVy += (dy / distance) * fleeStrength;
        nearbyPlayerCount++;
      }
    });

    // Apply flee velocity if there are nearby players
    if (nearbyPlayerCount > 0) {
      // Normalize the combined flee direction
      const fleeMagnitude = Math.sqrt(fleeVx * fleeVx + fleeVy * fleeVy);
      if (fleeMagnitude > 0) {
        fleeVx = (fleeVx / fleeMagnitude) * GAME_CONFIG.PREMIUM_ORB_FLEE_SPEED;
        fleeVy = (fleeVy / fleeMagnitude) * GAME_CONFIG.PREMIUM_ORB_FLEE_SPEED;
      }

      // Apply acceleration to current velocity (smooth movement)
      orb.vx += (fleeVx - orb.vx) * 0.15;
      orb.vy += (fleeVy - orb.vy) * 0.15;
    } else {
      // Apply damping when no players nearby (slow down gradually)
      orb.vx *= 0.92;
      orb.vy *= 0.92;
    }

    // Update position based on velocity
    orb.x += orb.vx;
    orb.y += orb.vy;

    // Keep orb within map boundaries with soft bounce
    const padding = orb.size;
    if (orb.x < padding) {
      orb.x = padding;
      orb.vx = Math.abs(orb.vx) * 0.5; // Bounce with damping
    } else if (orb.x > GAME_CONFIG.MAP_WIDTH - padding) {
      orb.x = GAME_CONFIG.MAP_WIDTH - padding;
      orb.vx = -Math.abs(orb.vx) * 0.5; // Bounce with damping
    }

    if (orb.y < padding) {
      orb.y = padding;
      orb.vy = Math.abs(orb.vy) * 0.5; // Bounce with damping
    } else if (orb.y > GAME_CONFIG.MAP_HEIGHT - padding) {
      orb.y = GAME_CONFIG.MAP_HEIGHT - padding;
      orb.vy = -Math.abs(orb.vy) * 0.5; // Bounce with damping
    }
  });

  // Update global player count for status endpoint (exclude AI players)
  global.playerCount = Array.from(players.values()).filter(p => !p.isAI).length;
}

// Broadcast counter - only broadcast every N ticks to reduce network load
let broadcastCounter = 0;
const BROADCAST_INTERVAL = Math.floor(GAME_CONFIG.TICK_RATE / GAME_CONFIG.BROADCAST_RATE);

// Broadcast game state to clients at reduced rate
function broadcastGameState() {
  if (players.size > 0) {
    io.emit('gameState', {
      players: Array.from(players.values()),
      // Premium orbs are few (20), so we can safely sync them every broadcast
      // to keep fleeing movement smooth without heavy bandwidth cost.
      premiumOrbs: Array.from(premiumOrbs.values()),
    });
  }
}

// Start game loop at 60 ticks/second for physics
const gameLoopInterval = setInterval(() => {
  gameLoop();

  // Only broadcast to clients at reduced rate (30 times/second instead of 60)
  broadcastCounter++;
  if (broadcastCounter >= BROADCAST_INTERVAL) {
    broadcastGameState();
    broadcastCounter = 0;
  }
}, 1000 / GAME_CONFIG.TICK_RATE);

// Start server
httpServer.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log(`🎮 burrs.io Game Server Started`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏱️  Tick Rate: ${GAME_CONFIG.TICK_RATE} ticks/second`);
  console.log(`👥 Max Players: ${GAME_CONFIG.MAX_PLAYERS_PER_SERVER}`);
  console.log(`🗺️  Map Size: ${GAME_CONFIG.MAP_WIDTH}x${GAME_CONFIG.MAP_HEIGHT}`);
  console.log(`⏰ Started at: ${new Date().toISOString()}`);
  console.log('🚀 ========================================');
});

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('❌ UNCAUGHT EXCEPTION:', {
    error: error.message,
    stack: error.stack,
    timestamp: new Date().toISOString(),
  });
  // Don't exit - log and continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ UNHANDLED PROMISE REJECTION:', {
    reason: reason,
    promise: promise,
    timestamp: new Date().toISOString(),
  });
  // Don't exit - log and continue
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server gracefully...');
  clearInterval(gameLoopInterval);
  io.close(() => {
    console.log('✅ Socket.IO server closed');
  });
  httpServer.close(() => {
    console.log('✅ HTTP server closed');
  });
  mongoClient.close().then(() => {
    console.log('✅ MongoDB connection closed');
    process.exit(0);
  }).catch((err) => {
    console.error('❌ Error closing MongoDB connection:', err);
    process.exit(1);
  });
});

process.on('SIGTERM', () => {
  console.log('\n🛑 SIGTERM received, shutting down gracefully...');
  clearInterval(gameLoopInterval);
  io.close();
  httpServer.close();
  mongoClient.close().then(() => {
    process.exit(0);
  }).catch(() => {
    process.exit(1);
  });
});

