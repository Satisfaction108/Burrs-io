import { useState, useEffect, useRef, useMemo } from 'react'
import { io, Socket } from 'socket.io-client'
import './App.css'
import { audioManager } from './AudioManager'
import { AudioSettings } from './AudioSettings'
import { Settings, KeyBindings, getKeybindings } from './Settings'
import { ServerSelector } from './ServerSelector'
import { hapticManager } from './haptics'
import { getNametagById, getSpikeById } from './customizations'

// Loading screen tips
const LOADING_TIPS = [
  'Collect food orbs to grow bigger and stronger!',
  'Premium orbs (glowing) give you more points!',
  'Press B to use your speed boost ability',
  'Press N to activate your special ability',
  'Stay in your team\'s colored base to go AFK safely',
  'Evolve at 1000 points to unlock tier 1 spikes',
  'Each tier 1 spike has unique abilities and stats',
  'Tier 2 evolutions unlock at 5000 points',
  'Colliding with other players deals damage based on size',
  'Bigger spikes deal more damage in collisions',
  'Your health regenerates slowly over time',
  'Press H to toggle the controls guide',
  'Use chat to communicate with other players',
  'Team bases provide a safe zone from attacks',
  'Special abilities have cooldowns - use them wisely!',
  'Some spikes are faster, others are tankier',
  'Watch out for angry spikes - they\'re dangerous!',
  'Premium orbs spawn randomly across the map',
  'Evolution choices are permanent - choose carefully!',
  'Coordinate with your team for better survival',
]

type SpikeType =
  | 'Spike'
  // Tier 1
  | 'Prickle' | 'Thorn' | 'Bristle' | 'Bulwark' | 'Starflare' | 'Mauler'
  // Tier 2 - Prickle variants
  | 'PrickleVanguard' | 'PrickleSwarm' | 'PrickleBastion'
  // Tier 2 - Thorn variants
  | 'ThornWraith' | 'ThornReaper' | 'ThornShade'
  // Tier 2 - Bristle variants
  | 'BristleBlitz' | 'BristleStrider' | 'BristleSkirmisher'
  // Tier 2 - Bulwark variants
  | 'BulwarkAegis' | 'BulwarkCitadel' | 'BulwarkJuggernaut'
  // Tier 2 - Starflare variants
  | 'StarflarePulsar' | 'StarflareHorizon' | 'StarflareNova'
  // Tier 2 - Mauler variants
  | 'MaulerRavager' | 'MaulerBulwark' | 'MaulerApex'

// Segment in a spike chain
interface SpikeSegment {
  x: number
  y: number
  rotation: number
  health: number
  size: number
}

interface Player {
  id: string
  username: string
  x: number  // Head position X
  y: number  // Head position Y
  vx: number
  vy: number
  size: number  // Base size for segments
  rotation: number  // Shared rotation for all segments
  rotationSpeed: number
  color: string
  score: number
  health: number  // Head health (for backward compatibility)
  maxHP?: number
  currentHP?: number
  isEating: boolean
  eatingProgress: number
  isAngry?: boolean
  angryProgress?: number
  isDying?: boolean
  deathProgress?: number
  lastCollisionTime?: number
  isAI?: boolean
  teamId?: string
  spikeType?: SpikeType
  evolutionScoreOffset?: number
  abilityActive?: boolean
  abilityProgress?: number
  lastAbilityTime?: number
  // Tier 2 ability-specific properties
  damageTrail?: Array<{ x: number; y: number; timestamp: number; radius: number }>
  novaExplosionX?: number
  novaExplosionY?: number
  novaExplosionTime?: number
  shockwaveX?: number
  shockwaveY?: number
  shockwaveTime?: number
  spineStormActive?: boolean
  executionLungeActive?: boolean
  // AFK properties
  isAFK?: boolean
  // Chain system properties
  segments?: SpikeSegment[]  // Array of spike segments (head is segments[0])
  // Spawn animation properties
  isSpawning?: boolean
  spawnProgress?: number
}

interface TeamBase {
  id: string
  color: string
  x: number
  y: number
  width: number
  height: number
}

interface MapConfig {
  width: number
  height: number
  teamBases?: TeamBase[]
}

interface Food {
  id: string
  x: number
  y: number
  size: number
  color: string
  xp: number
  tier: number
  absorbing?: boolean
  absorbProgress?: number
  absorbTargetX?: number
  absorbTargetY?: number
  originalSize?: number
}

interface PremiumOrb {
  id: string
  x: number
  y: number
  vx?: number
  vy?: number
  size: number
  rotation: number
  color: string
  xp: number
  absorbing?: boolean
  absorbProgress?: number
  absorbTargetX?: number
  absorbTargetY?: number
  originalSize?: number
}

interface Notification {
  id: string
  message: string
  timestamp: number
  opacity: number
}

interface ScorePopup {
  id: string
  x: number
  y: number
  score: number
  startTime: number
  duration: number
  color: string
}

type DamageSeverity = 'normal' | 'heavy' | 'critical' | 'extreme' | 'kill'

interface DamagePopup {
  id: string
  x: number
  y: number
  text: string
  severity: DamageSeverity
  startTime: number
  duration: number
}

interface ChatMessage {
  id: string
  playerId: string
  username: string
  text: string
  timestamp: number
  teamId?: string | null
  teamColor?: string
  isSystem?: boolean
}



interface CollisionParticle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  color: string
  life: number
  maxLife: number
}


type GameState = 'menu' | 'connecting' | 'playing' | 'dead'

interface DeathStats {
  timeSurvived: number
  kills: number
  foodEaten: number
  premiumOrbsEaten: number
  score: number
  killedBy?: string
  assists?: string[]
}

const DEFAULT_SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://burrs-io.onrender.com'

// Game constants (match server settings)
const PLAYER_SIZE = 30 // Base size for spikes (reduced from 35 for smaller spawn size)
const PLAYER_SPEED = 5

// Calculate size multiplier based on score (3x slower progression)
// Score 0: 1x, Score 3000: 2x, Score 15000: 3x, Score 75000: 4x
const getSizeMultiplier = (score: number, evolutionScoreOffset: number = 0): number => {
  // If player has evolved, calculate visual size based on score gained since evolution
  const visualScore = Math.max(0, score - evolutionScoreOffset)

  if (visualScore < 3000) {
    // 0-3000: interpolate from 1x to 2x
    return 1 + (visualScore / 3000)
  } else if (visualScore < 15000) {
    // 3000-15000: interpolate from 2x to 3x
    return 2 + ((visualScore - 3000) / 12000)
  } else if (visualScore < 75000) {
    // 15000-75000: interpolate from 3x to 4x
    return 3 + ((visualScore - 15000) / 60000)
  } else {
    // 75000+: cap at 4x
    return 4
  }
}

// Generate random neon color
const getRandomColor = () => {
  const colors = [
    '#ff0055', '#00ffff', '#00d4ff', '#ffff00', '#b000ff',
    '#ff00ff', '#ff6600', '#ff4500', '#00ccff', '#cc00ff'
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

// Evolution configuration
const EVOLUTION_THRESHOLD = 5000
const TIER_2_THRESHOLD = 15000

// Tier 1 Evolution Options
const TIER_1_OPTIONS = [
  {
    type: 'Prickle' as SpikeType,
    name: 'Prickle',
    description: 'Many short spikes — lots of tiny pricks',
    stats: { speed: -10, damage: 20, health: 0 },
    ability: 'Super Density',
    abilityDescription: '2x body damage + orange shield for 2s',
    abilityCooldown: 20000,
    abilityDuration: 2000,
  },
  {
    type: 'Thorn' as SpikeType,
    name: 'Thorn',
    description: 'Few long spikes',
    stats: { speed: 0, damage: 15, health: -10 },
    ability: 'Ghost Mode',
    abilityDescription: 'Pass through spikes for 3s',
    abilityCooldown: 30000,
    abilityDuration: 3000,
  },
  {
    type: 'Bristle' as SpikeType,
    name: 'Bristle',
    description: 'Dense medium spikes—balanced, lots of contact area',
    stats: { speed: 20, damage: 0, health: 0 },
    ability: 'Double Speed',
    abilityDescription: '2x speed for 3s',
    abilityCooldown: 30000,
    abilityDuration: 3000,
  },
  {
    type: 'Bulwark' as SpikeType,
    name: 'Bulwark',
    description: 'Thick, blunt spikes — tanky and chunky',
    stats: { speed: -30, damage: 5, health: 20 },
    ability: 'Invincibility',
    abilityDescription: 'Invulnerable for 3s',
    abilityCooldown: 30000,
    abilityDuration: 3000,
  },
  {
    type: 'Starflare' as SpikeType,
    name: 'Starflare',
    description: 'Thin very many long spikes',
    stats: { speed: 0, damage: 15, health: -10 },
    ability: 'Teleportation',
    abilityDescription: 'Teleport to base',
    abilityCooldown: 180000,
    abilityDuration: 3000,
  },
  {
    type: 'Mauler' as SpikeType,
    name: 'Mauler',
    description: 'Jagged, irregular spikes',
    stats: { speed: 0, damage: 5, health: 5 },
    ability: 'Fortress',
    abilityDescription: 'Defense shield for 3s',
    abilityCooldown: 60000,
    abilityDuration: 3000,
  },
]

// Tier 2 Evolution Options - Prickle variants
const TIER_2_PRICKLE_OPTIONS = [
  {
    type: 'PrickleVanguard' as SpikeType,
    name: 'Prickle Vanguard',
    description: 'Tankier Prickle that can dive and survive',
    stats: { speed: 5, damage: 5, health: 5 },
    ability: 'Overdensity',
    abilityDescription: '2.2x damage + shield + 30% damage reduction for 2.5s',
    abilityCooldown: 18000,
    abilityDuration: 2500,
  },
  {
    type: 'PrickleSwarm' as SpikeType,
    name: 'Prickle Swarm',
    description: 'More spikes and better contact DPS',
    stats: { speed: 10, damage: 5, health: 0 },
    ability: 'Spine Storm',
    abilityDescription: 'Rapid contact damage ticks in short radius for 2s',
    abilityCooldown: 18000,
    abilityDuration: 2000,
  },
  {
    type: 'PrickleBastion' as SpikeType,
    name: 'Prickle Bastion',
    description: 'Defensive Prickle; wins trades, slower',
    stats: { speed: -5, damage: 10, health: 10 },
    ability: 'Spine Bulwark',
    abilityDescription: '50% damage reduction + 25% reflect for 2.5s',
    abilityCooldown: 22000,
    abilityDuration: 2500,
  },
]

// Tier 2 Evolution Options - Thorn variants
const TIER_2_THORN_OPTIONS = [
  {
    type: 'ThornWraith' as SpikeType,
    name: 'Thorn Wraith',
    description: 'Classic assassin — better Ghost',
    stats: { speed: 5, damage: 5, health: 0 },
    ability: 'Wraith Walk',
    abilityDescription: 'Pass through spikes for 3.5s',
    abilityCooldown: 27000,
    abilityDuration: 3500,
  },
  {
    type: 'ThornReaper' as SpikeType,
    name: 'Thorn Reaper',
    description: 'Burst finisher: big first hit',
    stats: { speed: 5, damage: 10, health: -2 },
    ability: 'Execution Lunge',
    abilityDescription: 'Next hit +40% damage + slow for 3s',
    abilityCooldown: 26000,
    abilityDuration: 3000,
  },
  {
    type: 'ThornShade' as SpikeType,
    name: 'Thorn Shade',
    description: 'Flanker with disengage',
    stats: { speed: 10, damage: 5, health: 0 },
    ability: 'Shadow Slip',
    abilityDescription: 'Instant dash, phase through enemies',
    abilityCooldown: 24000,
    abilityDuration: 300,
  },
]

// Tier 2 Evolution Options - Bristle variants
const TIER_2_BRISTLE_OPTIONS = [
  {
    type: 'BristleBlitz' as SpikeType,
    name: 'Bristle Blitz',
    description: 'Pure chaser; faster boost',
    stats: { speed: 10, damage: 5, health: 0 },
    ability: 'Triple Rush',
    abilityDescription: '2.3x speed for 3.5s',
    abilityCooldown: 28000,
    abilityDuration: 3500,
  },
  {
    type: 'BristleStrider' as SpikeType,
    name: 'Bristle Strider',
    description: 'Mobility and sustained pressure',
    stats: { speed: 5, damage: 5, health: 5 },
    ability: 'Trailing Surge',
    abilityDescription: '2x speed + damaging trail for 4s',
    abilityCooldown: 32000,
    abilityDuration: 4000,
  },
  {
    type: 'BristleSkirmisher' as SpikeType,
    name: 'Bristle Skirmisher',
    description: 'More durable brawler, still mobile',
    stats: { speed: 5, damage: 0, health: 8 },
    ability: 'Kinetic Guard',
    abilityDescription: '1.8x speed + 20% damage reduction for 3s',
    abilityCooldown: 28000,
    abilityDuration: 3000,
  },
]

// Tier 2 Evolution Options - Bulwark variants
const TIER_2_BULWARK_OPTIONS = [
  {
    type: 'BulwarkAegis' as SpikeType,
    name: 'Bulwark Aegis',
    description: 'Premium tank, stronger invuln',
    stats: { speed: 5, damage: 5, health: 10 },
    ability: 'Fortified Aegis',
    abilityDescription: '3.5s invincibility + knockback resistance',
    abilityCooldown: 32000,
    abilityDuration: 3500,
  },
  {
    type: 'BulwarkCitadel' as SpikeType,
    name: 'Bulwark Citadel',
    description: 'Zone controller near bases',
    stats: { speed: 0, damage: 5, health: 15 },
    ability: 'Bastion Field',
    abilityDescription: 'Aura: 20% ally damage reduction + knockback for 3s',
    abilityCooldown: 35000,
    abilityDuration: 3000,
  },
  {
    type: 'BulwarkJuggernaut' as SpikeType,
    name: 'Bulwark Juggernaut',
    description: 'Slow raid boss',
    stats: { speed: 3, damage: 10, health: 10 },
    ability: 'Unstoppable',
    abilityDescription: 'Invincible + no slow/knockback for 3s',
    abilityCooldown: 32000,
    abilityDuration: 3000,
  },
]

// Tier 2 Evolution Options - Starflare variants
const TIER_2_STARFLARE_OPTIONS = [
  {
    type: 'StarflarePulsar' as SpikeType,
    name: 'Starflare Pulsar',
    description: 'More offensive teleport',
    stats: { speed: 5, damage: 5, health: 0 },
    ability: 'Offensive Warp',
    abilityDescription: 'Teleport to base + shockwave on arrival',
    abilityCooldown: 165000,
    abilityDuration: 3000,
  },
  {
    type: 'StarflareHorizon' as SpikeType,
    name: 'Starflare Horizon',
    description: 'More frequent reposition',
    stats: { speed: 10, damage: 0, health: 5 },
    ability: 'Short Blink',
    abilityDescription: 'Short-range teleport in aim direction',
    abilityCooldown: 45000,
    abilityDuration: 2500,
  },
  {
    type: 'StarflareNova' as SpikeType,
    name: 'Starflare Nova',
    description: 'AoE burst mage',
    stats: { speed: 5, damage: 10, health: 0 },
    ability: 'Nova Shift',
    abilityDescription: 'Teleport + delayed explosion (0.7s)',
    abilityCooldown: 60000,
    abilityDuration: 2500,
  },
]

// Tier 2 Evolution Options - Mauler variants
const TIER_2_MAULER_OPTIONS = [
  {
    type: 'MaulerRavager' as SpikeType,
    name: 'Mauler Ravager',
    description: 'Pure aggression',
    stats: { speed: 5, damage: 10, health: 0 },
    ability: 'Rend',
    abilityDescription: 'Each hit applies bleed (extra damage over 2s) for 3s',
    abilityCooldown: 55000,
    abilityDuration: 3000,
  },
  {
    type: 'MaulerBulwark' as SpikeType,
    name: 'Mauler Bulwark',
    description: 'Offensive tank hybrid',
    stats: { speed: 0, damage: 5, health: 10 },
    ability: 'Fortified Fortress',
    abilityDescription: '35% damage reduction + thorns for 3.5s',
    abilityCooldown: 65000,
    abilityDuration: 3500,
  },
  {
    type: 'MaulerApex' as SpikeType,
    name: 'Mauler Apex',
    description: 'High-risk, high-reward finisher',
    stats: { speed: 8, damage: 12, health: 0 },
    ability: 'Blood Frenzy',
    abilityDescription: '+25% damage, +15% speed, +15% damage taken for 4s',
    abilityCooldown: 60000,
    abilityDuration: 4000,
  },
]

// Combined evolution options (for ability HUD / cooldown, includes Tier 1 and Tier 2)
const EVOLUTION_OPTIONS = [
  ...TIER_1_OPTIONS,
  ...TIER_2_PRICKLE_OPTIONS,
  ...TIER_2_THORN_OPTIONS,
  ...TIER_2_BRISTLE_OPTIONS,
  ...TIER_2_BULWARK_OPTIONS,
  ...TIER_2_STARFLARE_OPTIONS,
  ...TIER_2_MAULER_OPTIONS,
]

const getAbilityDisplayConfig = (spikeType: SpikeType | null | undefined) => {
  if (!spikeType) {
    return { name: 'Ability', label: 'Ability' }
  }
  const config = EVOLUTION_OPTIONS.find(opt => opt.type === spikeType)
  if (!config) {
    return { name: 'Ability', label: 'Ability' }
  }
  const baseName = config.ability
  const durationMs = config.abilityDuration
  if (!durationMs || durationMs < 1000) {
    return { name: baseName, label: baseName }
  }
  const seconds = durationMs / 1000
  const formatted = seconds % 1 === 0 ? `${seconds.toFixed(0)}s` : `${seconds.toFixed(1)}s`
  return { name: baseName, label: `${baseName} ${formatted}` }
}

// Food tier configuration is defined on the server side

// Food generation is now handled server-side

// Draw spike visual effects (glow, particles, etc.)
const drawSpikeEffects = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  spikeEffectId: string
) => {
  const spikeCustomization = getSpikeById(spikeEffectId)
  if (!spikeCustomization || spikeCustomization.effect.type === 'none') return

  const effect = spikeCustomization.effect

  ctx.save()

  switch (effect.type) {
    case 'glow':
      // Draw glowing outline
      ctx.shadowColor = effect.color || '#00ffff'
      ctx.shadowBlur = effect.intensity || 15
      ctx.strokeStyle = effect.color || '#00ffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, size + 5, 0, Math.PI * 2)
      ctx.stroke()
      break

    case 'trail':
      // Trail effect is handled separately in the game loop
      break

    case 'particles':
      // Draw simple particle effect
      const particleCount = effect.count || 5
      const time = Date.now() / 1000
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2 + time
        const distance = size + 10 + Math.sin(time * 2 + i) * 5
        const px = x + Math.cos(angle) * distance
        const py = y + Math.sin(angle) * distance

        ctx.fillStyle = effect.color || '#ffff00'
        ctx.shadowColor = effect.color || '#ffff00'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(px, py, 3, 0, Math.PI * 2)
        ctx.fill()
      }
      break

    case 'electric':
      // Draw electric bolts
      const bolts = effect.bolts || 3
      const boltTime = Date.now() / 100
      for (let i = 0; i < bolts; i++) {
        const angle = (i / bolts) * Math.PI * 2 + boltTime
        const startX = x + Math.cos(angle) * (size * 0.5)
        const startY = y + Math.sin(angle) * (size * 0.5)
        const endX = x + Math.cos(angle) * (size + 15)
        const endY = y + Math.sin(angle) * (size + 15)

        ctx.strokeStyle = effect.color || '#00d4ff'
        ctx.shadowColor = effect.color || '#00d4ff'
        ctx.shadowBlur = 8
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(startX, startY)
        ctx.lineTo(endX, endY)
        ctx.stroke()
      }
      break

    case 'cosmic':
      // Draw swirling cosmic energy
      const colors = effect.colors || ['#b000ff', '#ff00ff', '#00ffff']
      const cosmicTime = Date.now() / 1000
      const rings = 3

      for (let ring = 0; ring < rings; ring++) {
        const ringRadius = size + 10 + ring * 8
        const colorIndex = ring % colors.length
        const rotation = effect.rotation ? cosmicTime + ring : 0

        ctx.strokeStyle = colors[colorIndex]
        ctx.shadowColor = colors[colorIndex]
        ctx.shadowBlur = 12
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.6

        ctx.beginPath()
        for (let i = 0; i <= 8; i++) {
          const angle = (i / 8) * Math.PI * 2 + rotation
          const r = ringRadius + Math.sin(angle * 3 + cosmicTime) * 5
          const px = x + Math.cos(angle) * r
          const py = y + Math.sin(angle) * r

          if (i === 0) {
            ctx.moveTo(px, py)
          } else {
            ctx.lineTo(px, py)
          }
        }
        ctx.stroke()
      }
      break
  }

  ctx.restore()
}

// ═══════════════════════════════════════════════════════════════
// CHAIN RENDERING - Draw spike chain with connections
// ═══════════════════════════════════════════════════════════════
const drawSpikeChain = (
  ctx: CanvasRenderingContext2D,
  player: Player,
  eatingProgress: number,
  skipUsername: boolean,
  opacity: number,
  spikeEffectId: string
) => {
  const segments = player.segments || []

  // If no segments, fall back to single spike rendering
  if (segments.length === 0) {
    const baseScoreForSize = player.isAI ? 500 : (player.score || 0)
    const evolutionOffset = player.isAI ? 0 : (player.evolutionScoreOffset || 0)
    const sizeMultiplier = getSizeMultiplier(baseScoreForSize, evolutionOffset)
    const scaledSize = PLAYER_SIZE * sizeMultiplier

    drawSpikeEffects(ctx, player.x, player.y, scaledSize, spikeEffectId)
    drawSpike(
      ctx,
      player.x,
      player.y,
      scaledSize,
      player.rotation,
      player.color,
      player.username,
      eatingProgress,
      player.health || 100,
      player.angryProgress || 0,
      player.deathProgress || 0,
      skipUsername,
      player.isAI ?? false,
      player.spikeType || 'Spike',
      opacity
    )
    return
  }

  // Draw connections between segments first (behind spikes) - removed per user request
  // Spikes look connected naturally when thorns touch

  // Apply spawn animation effects
  const spawnProgress = player.isSpawning ? (player.spawnProgress || 0) : 1
  const spawnScale = 0.3 + (spawnProgress * 0.7) // Scale from 30% to 100%
  const spawnOpacity = opacity * spawnProgress // Fade in

  // Draw all segments (all share the same rotation from player.rotation)
  segments.forEach((segment, index) => {
    ctx.save()

    // Check if this individual segment is spawning
    const segmentIsSpawning = (segment as any).isSpawning || false
    const segmentSpawnProgress = segmentIsSpawning ? ((segment as any).spawnProgress || 0) : 1

    // Calculate spawn animation for this segment
    const segmentSpawnScale = segmentIsSpawning
      ? 0.3 + (segmentSpawnProgress * 0.7) // Scale from 30% to 100%
      : (player.isSpawning ? spawnScale : 1)
    const segmentSpawnOpacity = segmentIsSpawning
      ? opacity * segmentSpawnProgress // Fade in
      : (player.isSpawning ? spawnOpacity : opacity)

    // Apply spawn animation scale (either player spawn or segment spawn)
    if (player.isSpawning || segmentIsSpawning) {
      ctx.translate(segment.x, segment.y)
      ctx.scale(segmentSpawnScale, segmentSpawnScale)
      ctx.translate(-segment.x, -segment.y)
    }

    // Apply spike customization effects to all segments
    drawSpikeEffects(ctx, segment.x, segment.y, segment.size, spikeEffectId)

    // Draw the spike segment
    // Only show username on head (index 0), but show health bar on all segments
    const showUsername = index === 0 ? player.username : ''

    // Calculate health percentage for display
    // segment.health is the raw HP value, need to convert to percentage
    const maxHP = player.maxHP || 10
    const currentHP = segment.health || maxHP
    const healthPercentage = (currentHP / maxHP) * 100

    drawSpike(
      ctx,
      segment.x,
      segment.y,
      segment.size,
      player.rotation, // All segments share the same rotation
      player.color,
      showUsername,
      index === 0 ? eatingProgress : 0, // Only head shows eating animation
      healthPercentage, // Convert raw HP to percentage for health bar
      index === 0 ? (player.angryProgress || 0) : 0, // Only head shows angry animation
      player.deathProgress || 0,
      index === 0 ? skipUsername : true, // Skip username for non-head segments
      player.isAI ?? false,
      player.spikeType || 'Spike',
      segmentSpawnOpacity, // Apply spawn fade-in (either player or segment)
      index !== 0 // Show core for all segments except head (index 0)
    )

    // Draw particle effect for spawning segment
    if (segmentIsSpawning && segmentSpawnProgress < 1) {
      const particleCount = 8
      const particleRadius = segment.size * 1.5

      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2 + segmentSpawnProgress * Math.PI
        const distance = particleRadius * (1 - segmentSpawnProgress)
        const px = segment.x + Math.cos(angle) * distance
        const py = segment.y + Math.sin(angle) * distance

        ctx.beginPath()
        ctx.arc(px, py, 2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(0, 255, 255, ${(1 - segmentSpawnProgress) * 0.8})`
        ctx.fill()
      }
    }

    ctx.restore()
  })

  // Draw spawn animation ring effect
  if (player.isSpawning && segments.length > 0) {
    const headSegment = segments[0]
    ctx.save()
    ctx.globalAlpha = (1 - spawnProgress) * 0.6
    ctx.strokeStyle = player.color
    ctx.lineWidth = 3
    ctx.shadowColor = player.color
    ctx.shadowBlur = 15
    ctx.beginPath()
    ctx.arc(headSegment.x, headSegment.y, headSegment.size * (2 - spawnProgress), 0, Math.PI * 2)
    ctx.stroke()
    ctx.restore()
  }
}

// Draw a spike using Canvas2D
const drawSpike = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  rotation: number,
  color: string,
  username?: string,
  eatingProgress?: number,
  health: number = 100,
  angryProgress?: number,
  deathProgress?: number,
  skipUsername: boolean = false,
  isAI: boolean = false,
  spikeType: SpikeType = 'Spike',
  opacity: number = 1, // Add opacity parameter for ghost mode
  showCore: boolean = true, // Show white energy core (false for head spike in chain)
) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)

  // Apply death animation effects
  if (deathProgress && deathProgress > 0) {
    // Fade out
    ctx.globalAlpha = (1 - deathProgress) * opacity

    // Shrink and spin faster
    const shrinkScale = 1 - (deathProgress * 0.8) // Shrink to 20% size
    ctx.scale(shrinkScale, shrinkScale)

    // Extra rotation during death
    ctx.rotate(deathProgress * Math.PI * 4) // 2 full rotations
  } else {
    // Apply opacity for ghost mode
    ctx.globalAlpha = opacity
  }

  // Draw white star spikes based on spike type
  let outerRadius = size * 1.29
  let innerRadius = size * 0.83
  let spikes = 8

  // Customize spike pattern based on type
  switch (spikeType) {
    // Tier 1
    case 'Prickle': // Many short spikes
      spikes = 16
      outerRadius = size * 1.15
      innerRadius = size * 0.88
      break
    case 'Thorn': // Few VERY long spikes
      spikes = 5
      outerRadius = size * 1.7 // Much longer
      innerRadius = size * 0.7
      break
    case 'Bristle': // Dense medium spikes
      spikes = 12
      outerRadius = size * 1.25
      innerRadius = size * 0.85
      break
    case 'Bulwark': // Thick, blunt spikes
      spikes = 6
      outerRadius = size * 1.2
      innerRadius = size * 0.9
      break
    case 'Starflare': // Thin very many long spikes
      spikes = 20
      outerRadius = size * 1.4
      innerRadius = size * 0.82
      break
    case 'Mauler': // Fewer, thicker, more aggressive spikes
      spikes = 7
      outerRadius = size * 1.45
      innerRadius = size * 0.75
      break

    // Tier 2 - Prickle variants
    case 'PrickleVanguard': // Tankier with denser spikes
      spikes = 18
      outerRadius = size * 1.22
      innerRadius = size * 0.88
      break
    case 'PrickleSwarm': // Even more spikes - very dense
      spikes = 24
      outerRadius = size * 1.10
      innerRadius = size * 0.90
      break
    case 'PrickleBastion': // Thicker defensive spikes - fewer but thicker
      spikes = 12
      outerRadius = size * 1.25
      innerRadius = size * 0.93
      break

    // Tier 2 - Thorn variants
    case 'ThornWraith': // Longer, thinner spikes - ethereal
      spikes = 6
      outerRadius = size * 1.80
      innerRadius = size * 0.65
      break
    case 'ThornReaper': // Aggressive long spikes - executioner
      spikes = 4
      outerRadius = size * 1.95
      innerRadius = size * 0.60
      break
    case 'ThornShade': // Fast, sleek spikes - more spikes for speed
      spikes = 8
      outerRadius = size * 1.60
      innerRadius = size * 0.75
      break

    // Tier 2 - Bristle variants
    case 'BristleBlitz': // Streamlined for speed - fewer, longer spikes
      spikes = 10
      outerRadius = size * 1.35
      innerRadius = size * 0.84
      break
    case 'BristleStrider': // Balanced dense spikes - medium count
      spikes = 14
      outerRadius = size * 1.24
      innerRadius = size * 0.86
      break
    case 'BristleSkirmisher': // Durable medium spikes - more defensive
      spikes = 16
      outerRadius = size * 1.20
      innerRadius = size * 0.89
      break

    // Tier 2 - Bulwark variants
    case 'BulwarkAegis': // Premium tank spikes - balanced defense
      spikes = 8
      outerRadius = size * 1.24
      innerRadius = size * 0.91
      break
    case 'BulwarkCitadel': // Zone control spikes - more spikes for area control
      spikes = 10
      outerRadius = size * 1.22
      innerRadius = size * 0.90
      break
    case 'BulwarkJuggernaut': // Massive blunt spikes - fewer, thicker
      spikes = 5
      outerRadius = size * 1.28
      innerRadius = size * 0.94
      break

    // Tier 2 - Starflare variants
    case 'StarflarePulsar': // Explosive star pattern - medium spikes
      spikes = 16
      outerRadius = size * 1.48
      innerRadius = size * 0.78
      break
    case 'StarflareHorizon': // Sleek teleporter - balanced
      spikes = 20
      outerRadius = size * 1.38
      innerRadius = size * 0.82
      break
    case 'StarflareNova': // Burst mage pattern - MANY thin spikes
      spikes = 28
      outerRadius = size * 1.42
      innerRadius = size * 0.80
      break

    // Tier 2 - Mauler variants
    case 'MaulerRavager': // Aggressive jagged - more spikes for aggression
      spikes = 9
      outerRadius = size * 1.52
      innerRadius = size * 0.70
      break
    case 'MaulerBulwark': // Defensive jagged - fewer, thicker
      spikes = 6
      outerRadius = size * 1.40
      innerRadius = size * 0.80
      break
    case 'MaulerApex': // High-risk high-reward - extreme spikes
      spikes = 10
      outerRadius = size * 1.58
      innerRadius = size * 0.65
      break

    default: // Spike (default)
      spikes = 8
      outerRadius = size * 1.29
      innerRadius = size * 0.83
  }

  // ═══════════════════════════════════════════════════════════════
  // COSMIC SPIKE RENDERING - Clean with Focused Center Shine
  // ═══════════════════════════════════════════════════════════════

  // Draw main white spikes (no outer glow)
  ctx.save()

  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    let radius = i % 2 === 0 ? outerRadius : innerRadius

    // Add irregularity for Mauler variants
    if ((spikeType === 'Mauler' || spikeType === 'MaulerRavager' || spikeType === 'MaulerBulwark' || spikeType === 'MaulerApex') && i % 2 === 0) {
      radius *= 0.8 + Math.sin(i * 2.3) * 0.25
    }

    const angle = (Math.PI * i) / spikes
    const px = Math.cos(angle) * radius
    const py = Math.sin(angle) * radius
    if (i === 0) {
      ctx.moveTo(px, py)
    } else {
      ctx.lineTo(px, py)
    }
  }
  ctx.closePath()
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.restore()

  // Draw colored circle body with health-based glow
  ctx.save()

  // Add health-based glow effect
  const healthPercent = Math.max(0, Math.min(100, health)) / 100
  if (healthPercent < 0.5) {
    // Low health: red pulsing glow
    const pulseTime = Date.now() / 200
    const pulseFactor = Math.sin(pulseTime) * 0.5 + 0.5
    const glowIntensity = (0.5 - healthPercent) * 2 * pulseFactor // 0 to 1

    ctx.shadowColor = `rgba(255, 107, 107, ${glowIntensity * 0.8})`
    ctx.shadowBlur = size * 0.5 * glowIntensity
  } else if (healthPercent > 0.9) {
    // High health: subtle cyan glow
    ctx.shadowColor = 'rgba(78, 205, 196, 0.3)'
    ctx.shadowBlur = size * 0.2
  }

  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()

  // Draw small bright energy core at center only (skip for head spike in chain)
  if (showCore) {
    ctx.save()
    const coreTime = Date.now() / 1000
    const corePulse = Math.sin(coreTime * 3) * 0.3 + 0.7
    const coreSize = size * 0.2 * corePulse

    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = '#ffffff'
    ctx.shadowBlur = 6
    ctx.globalAlpha = 0.9 * (deathProgress ? 1 - deathProgress : 1) * opacity
    ctx.beginPath()
    ctx.arc(0, 0, coreSize, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.restore()

  // Draw face (players + AI spikes)
  // Face doesn't rotate - always faces straight up
  if ((username || isAI) && (!deathProgress || deathProgress < 1)) {
    ctx.save()

    // Fade face out as the spike dies
    const overlayAlpha = deathProgress ? 1 - deathProgress : 1
    ctx.globalAlpha = overlayAlpha

    const eating = eatingProgress || 0
    const angry = angryProgress || 0

    // Extra outer ring to visually tag AI entities
    if (isAI) {
      ctx.save()
      ctx.lineWidth = size * 0.14
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.85)'
      ctx.shadowColor = 'rgba(0, 229, 255, 0.6)'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(x, y, size * 1.1, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    // Base face color
    ctx.fillStyle = '#000000'

    // Interpolate between happy and angry expressions (AI are always angry)
    const isAngry = isAI || angry > 0

    if (isAngry) {
      // ANGRY / SAD FACE
      // Strong eyebrows like "\ /" and a clear frown
      ctx.save()
      ctx.lineWidth = size * 0.08
      ctx.strokeStyle = isAI ? '#ff1744' : '#000000'
      ctx.fillStyle = isAI ? '#ff1744' : '#000000'

      // Left eyebrow: downward toward center (\)
      ctx.beginPath()
      ctx.moveTo(x - size * 0.45, y - size * 0.4)
      ctx.lineTo(x - size * 0.15, y - size * 0.25)
      ctx.stroke()

      // Right eyebrow: downward toward center (/)
      ctx.beginPath()
      ctx.moveTo(x + size * 0.15, y - size * 0.25)
      ctx.lineTo(x + size * 0.45, y - size * 0.4)
      ctx.stroke()

      // Simple eyes under the brows
      const eyeRadius = size * 0.08
      ctx.beginPath()
      ctx.arc(x - size * 0.25, y - size * 0.2, eyeRadius, 0, Math.PI * 2)
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x + size * 0.25, y - size * 0.2, eyeRadius, 0, Math.PI * 2)
      ctx.fill()

      // Frowning mouth (arc curving downward)
      ctx.beginPath()
      ctx.lineWidth = size * 0.09
      const mouthRadius = size * 0.32
      const mouthCenterY = y + size * 0.35
      // Bottom arc (1.2π to 1.8π) gives a clear frown
      ctx.arc(x, mouthCenterY, mouthRadius, 1.2 * Math.PI, 1.8 * Math.PI)
      ctx.stroke()

      ctx.restore()
    } else {
      // HAPPY FACE (only non-AI spikes)
      // Eyes squint when eating (scale down vertically)
      const eyeScaleY = 1.4 - (eating * 0.8) // Squints from 1.4 to 0.6

      // Left eye (oval with squint)
      ctx.save()
      ctx.translate(x - size * 0.3, y - size * 0.25)
      ctx.scale(1, eyeScaleY)
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.12, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Right eye (oval with squint)
      ctx.save()
      ctx.translate(x + size * 0.3, y - size * 0.25)
      ctx.scale(1, eyeScaleY)
      ctx.beginPath()
      ctx.arc(0, 0, size * 0.12, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Mouth with eating animation (simple enlarging semicircle)
      const baseRadius = size * 0.35
      const baseYOffset = size * 0.1

      // Mouth enlarges when eating
      const mouthRadius = baseRadius + (eating * size * 0.15)
      const mouthYOffset = baseYOffset + (eating * size * 0.05)
      const mouthOpenAngle = Math.PI + (eating * Math.PI * 0.3)

      ctx.beginPath()
      const startAngle = -eating * Math.PI * 0.15
      const endAngle = startAngle + mouthOpenAngle
      ctx.arc(x, y + mouthYOffset, mouthRadius, startAngle, endAngle)
      ctx.fill()
    }

    ctx.restore()
  }

  // Draw death particles (reduced for performance)
  if (deathProgress && deathProgress > 0) {
    const particleCount = 12
    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2
      const distance = deathProgress * size * 3
      const px = Math.cos(angle) * distance
      const py = Math.sin(angle) * distance

      const particleSize = size * 0.15 * (1 - deathProgress)

      ctx.save()
      ctx.globalAlpha = (1 - deathProgress) * 0.8
      ctx.fillStyle = color
      ctx.shadowBlur = 15
      ctx.shadowColor = color
      ctx.beginPath()
      ctx.arc(px, py, particleSize, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // Draw username above spike - sleek minimal design
  if (username && !skipUsername && (!deathProgress || deathProgress < 1)) {
    ctx.save()

    // Fade username out as the spike dies
    const overlayAlpha = deathProgress ? 1 - deathProgress : 1
    ctx.globalAlpha = overlayAlpha

    // Scale elements based on spike size
    const sizeScale = size / 30
    const fontSize = Math.max(9, 11 * sizeScale)
    const badgeOffset = 42 * sizeScale

    // Measure text
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

    const badgeY = y - size - badgeOffset

    // Draw username text with strong black outline
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Thick black stroke for maximum readability
    ctx.strokeStyle = '#000000'
    ctx.lineWidth = 4 * sizeScale
    ctx.lineJoin = 'round'
    ctx.strokeText(username, x, badgeY)

    // White text on top
    ctx.fillStyle = '#ffffff'
    ctx.fillText(username, x, badgeY)

    ctx.restore()
  }

  // Draw health bar below spike (visible to all players, only for player spikes, scaled with size)
  // Show health bar if username is defined (even if empty string for non-head segments)
  if (username !== undefined && (!deathProgress || deathProgress < 1)) {
    ctx.save()

    // Fade health bar out as the spike dies
    const overlayAlpha = deathProgress ? 1 - deathProgress : 1
    ctx.globalAlpha = overlayAlpha

    // Scale health bar based on spike size (base size = 30)
    const sizeScale = size / 30
    const healthBarWidth = 50 * sizeScale
    const healthBarHeight = 5 * sizeScale
    const healthBarRadius = 2.5 * sizeScale
    const healthBarOffset = 8 * sizeScale
    const healthBarY = y + size + healthBarOffset + 10
    const healthBarX = x - healthBarWidth / 2

    // Health bar background (dark)
    drawRoundedRect(ctx, healthBarX, healthBarY, healthBarWidth, healthBarHeight, healthBarRadius)
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
    ctx.fill()

    // Health bar border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'
    ctx.lineWidth = 1
    ctx.stroke()

    // Health bar fill (solid color based on health level)
    const healthPercent = Math.max(0, Math.min(100, health)) / 100
    const healthFillWidth = healthBarWidth * healthPercent

    if (healthFillWidth > 0) {
      ctx.save()

      // Adjust radius for small widths to prevent timeglass effect
      const healthFillRadius = Math.min(healthBarRadius, healthFillWidth / 2, healthBarHeight / 2)

      drawRoundedRect(ctx, healthBarX, healthBarY, healthFillWidth, healthBarHeight, healthFillRadius)
      ctx.clip()

      // Solid color based on health level
      let fillColor
      if (healthPercent > 0.6) {
        // Green for high health
        fillColor = '#4ecdc4'
      } else if (healthPercent > 0.3) {
        // Yellow for medium health
        fillColor = '#f9ca24'
      } else {
        // Red for low health
        fillColor = '#ff6b6b'
      }

      drawRoundedRect(ctx, healthBarX, healthBarY, healthFillWidth, healthBarHeight, healthFillRadius)
      ctx.fillStyle = fillColor
      ctx.fill()

      // Add subtle glow
      ctx.shadowColor = healthPercent > 0.6 ? 'rgba(78, 205, 196, 0.5)' :
                        healthPercent > 0.3 ? 'rgba(249, 202, 36, 0.5)' :
                        'rgba(255, 107, 107, 0.5)'
      ctx.shadowBlur = 4
      ctx.fill()

      ctx.restore()
    }

    ctx.restore()
  }
}

// ═══════════════════════════════════════════════════════════════
// COSMIC FOOD ORB - Clean with Focused Center Shine
// ═══════════════════════════════════════════════════════════════
const drawFood = (ctx: CanvasRenderingContext2D, food: Food, currentTime: number) => {
  ctx.save()

  // Calculate opacity based on absorption progress
  const opacity = food.absorbing ? 1 - (food.absorbProgress || 0) : 1

  // Pulsing effect
  const pulsePhase = (food.x + food.y) * 0.01
  const pulse = 0.7 + Math.sin(currentTime * 2 + pulsePhase) * 0.3

  // Floating animation - slow vertical movement
  const floatOffset = Math.sin(currentTime * 1.5 + pulsePhase) * 3
  const currentY = food.y + floatOffset

  // Draw subtle outer glow
  ctx.globalAlpha = opacity * 0.3
  ctx.beginPath()
  ctx.arc(food.x, currentY, food.size * 1.3, 0, Math.PI * 2)
  ctx.fillStyle = food.color
  ctx.shadowColor = food.color
  ctx.shadowBlur = 8
  ctx.fill()

  // Draw main orb (solid color, no gradient)
  ctx.globalAlpha = opacity
  ctx.shadowBlur = 0
  ctx.beginPath()
  ctx.arc(food.x, currentY, food.size, 0, Math.PI * 2)
  ctx.fillStyle = food.color
  ctx.fill()

  // Draw small bright center shine only
  ctx.globalAlpha = opacity * (0.9 + pulse * 0.1)
  ctx.beginPath()
  ctx.arc(food.x - food.size * 0.25, currentY - food.size * 0.25, food.size * 0.3, 0, Math.PI * 2)
  ctx.fillStyle = '#ffffff'
  ctx.shadowColor = '#ffffff'
  ctx.shadowBlur = 4
  ctx.fill()

  ctx.restore()
}

// Generate random premium orb
// Premium orb generation is now handled server-side

// ═══════════════════════════════════════════════════════════════
// COSMIC PREMIUM ORB - Clean with Focused Center Shine
// ═══════════════════════════════════════════════════════════════
const drawPremiumOrb = (ctx: CanvasRenderingContext2D, orb: PremiumOrb, currentTime: number) => {
  ctx.save()

  // Calculate opacity and size based on absorption progress
  const opacity = orb.absorbing ? 1 - (orb.absorbProgress || 0) : 1
  const currentSize = orb.absorbing ? orb.originalSize! * (1 - (orb.absorbProgress || 0)) : orb.size

  ctx.globalAlpha = opacity

  // Pulsing effect
  const pulsePhase = (orb.x + orb.y) * 0.01
  const pulse = 0.6 + Math.sin(currentTime * 2.5 + pulsePhase) * 0.4

  // Floating animation - slow circular movement
  const floatX = Math.sin(currentTime * 1.2 + pulsePhase) * 4
  const floatY = Math.cos(currentTime * 1.2 + pulsePhase) * 4

  // Move to orb position (absorption animation or floating)
  const currentX = orb.absorbing
    ? orb.x + (orb.absorbTargetX! - orb.x) * (orb.absorbProgress || 0) * 0.15
    : orb.x + floatX
  const currentY = orb.absorbing
    ? orb.y + (orb.absorbTargetY! - orb.y) * (orb.absorbProgress || 0) * 0.15
    : orb.y + floatY

  // Draw orbiting particles (reduced count for performance)
  if (!orb.absorbing) {
    const particleCount = 5
    const orbitRadius = currentSize * 1.8

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + currentTime * 2
      const px = currentX + Math.cos(angle) * orbitRadius
      const py = currentY + Math.sin(angle) * orbitRadius
      const particleSize = 2.5 + Math.sin(currentTime * 3 + i) * 1

      ctx.globalAlpha = opacity * (0.6 + 0.4 * pulse)
      ctx.beginPath()
      ctx.arc(px, py, particleSize, 0, Math.PI * 2)
      ctx.fillStyle = orb.color
      ctx.fill()
    }
  }

  ctx.translate(currentX, currentY)
  ctx.rotate(orb.rotation)

  // Draw subtle outer glow
  ctx.globalAlpha = opacity * 0.4
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i
    const x = Math.cos(angle) * currentSize * 1.4
    const y = Math.sin(angle) * currentSize * 1.4
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.closePath()
  ctx.fillStyle = orb.color
  ctx.shadowColor = orb.color
  ctx.shadowBlur = 12
  ctx.fill()

  // Draw main octagon (solid color, no shine)
  ctx.globalAlpha = opacity
  ctx.shadowBlur = 0
  ctx.beginPath()
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i
    const x = Math.cos(angle) * currentSize
    const y = Math.sin(angle) * currentSize
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.closePath()
  ctx.fillStyle = orb.color
  ctx.fill()

  ctx.restore()
}

// Draw minimap in bottom-right corner
const drawMinimap = (
  ctx: CanvasRenderingContext2D,
  playerX: number,
  playerY: number,
  mapWidth: number,
  mapHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  playerColor: string,
  teamBases?: TeamBase[],
  playerTeamId?: string,
  players?: Map<string, Player>,
  localPlayerId?: string | null,
) => {
  // Minimap configuration
  const minimapWidth = 180
  const minimapHeight = 180
  const minimapPadding = 20
  const minimapX = canvasWidth - minimapWidth - minimapPadding
  const minimapY = canvasHeight - minimapHeight - minimapPadding

  ctx.save()

  // Draw minimap background - sleek modern style
  const radius = 12
  drawRoundedRect(ctx, minimapX, minimapY, minimapWidth, minimapHeight, radius)
  ctx.fillStyle = 'rgba(15, 15, 30, 0.92)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Clip to rounded rectangle for clean edges
  ctx.save()
  drawRoundedRect(ctx, minimapX, minimapY, minimapWidth, minimapHeight, radius)
  ctx.clip()

  // Map area
  const mapPadding = 12
  const mapDisplayWidth = minimapWidth - mapPadding * 2
  const mapDisplayHeight = minimapHeight - mapPadding * 2
  const mapDisplayX = minimapX + mapPadding
  const mapDisplayY = minimapY + mapPadding

  // Subtle grid
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)'
  ctx.lineWidth = 1
  const gridLines = 3
  for (let i = 1; i < gridLines; i++) {
    const x = mapDisplayX + (mapDisplayWidth / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(x, mapDisplayY)
    ctx.lineTo(x, mapDisplayY + mapDisplayHeight)
    ctx.stroke()
  }
  for (let i = 1; i < gridLines; i++) {
    const y = mapDisplayY + (mapDisplayHeight / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(mapDisplayX, y)
    ctx.lineTo(mapDisplayX + mapDisplayWidth, y)
    ctx.stroke()
  }

  // Draw team bases
  if (teamBases && teamBases.length > 0) {
    teamBases.forEach((base) => {
      const baseMinimapX = mapDisplayX + (base.x / mapWidth) * mapDisplayWidth
      const baseMinimapY = mapDisplayY + (base.y / mapHeight) * mapDisplayHeight
      const baseMinimapWidth = (base.width / mapWidth) * mapDisplayWidth
      const baseMinimapHeight = (base.height / mapHeight) * mapDisplayHeight

      ctx.save()

      const isOwnBase = playerTeamId && base.id === playerTeamId

      // Soft fill with team color
      ctx.globalAlpha = isOwnBase ? 0.25 : 0.16
      ctx.fillStyle = base.color
      drawRoundedRect(ctx, baseMinimapX, baseMinimapY, baseMinimapWidth, baseMinimapHeight, 8)
      ctx.fill()

      // Outline - slightly brighter for your own base
      ctx.globalAlpha = 1
      ctx.lineWidth = isOwnBase ? 3 : 2
      ctx.strokeStyle = isOwnBase
        ? 'rgba(255, 255, 255, 0.85)'
        : 'rgba(255, 255, 255, 0.35)'
      drawRoundedRect(ctx, baseMinimapX, baseMinimapY, baseMinimapWidth, baseMinimapHeight, 8)
      ctx.stroke()

      ctx.restore()
    })
  }

  // Draw same-team players as small pips
  if (players && playerTeamId) {
    players.forEach((player) => {
      if (!player.teamId || player.teamId !== playerTeamId) return
      if (localPlayerId && player.id === localPlayerId) return

      const teammateMinimapX = mapDisplayX + (player.x / mapWidth) * mapDisplayWidth
      const teammateMinimapY = mapDisplayY + (player.y / mapHeight) * mapDisplayHeight

      ctx.save()
      ctx.globalAlpha = 0.9
      ctx.fillStyle = playerColor || '#00ffff'
      ctx.beginPath()
      ctx.arc(teammateMinimapX, teammateMinimapY, 3, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    })
  }

  // Player position
  const playerMinimapX = mapDisplayX + (playerX / mapWidth) * mapDisplayWidth
  const playerMinimapY = mapDisplayY + (playerY / mapHeight) * mapDisplayHeight

  // Pulsing MINI SPIKE indicator (mini version of main spike)
  const pulseTime = Date.now() / 500
  const pulse = 0.7 + Math.sin(pulseTime) * 0.3
  const baseRadius = 6
  const outerRadius = baseRadius * pulse
  const innerRadius = outerRadius * 0.6
  const miniSpikes = 8

  ctx.save()

  const markerColor = playerColor || '#00ffff'

  // Soft neon glow
  ctx.shadowColor = markerColor
  ctx.shadowBlur = 12
  ctx.fillStyle = '#ffffff'

  // Draw white star spikes (mini version of main spike outline)
  ctx.beginPath()
  for (let i = 0; i < miniSpikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius
    const angle = (Math.PI * i) / miniSpikes
    const px = playerMinimapX + Math.cos(angle) * radius
    const py = playerMinimapY + Math.sin(angle) * radius
    if (i === 0) {
      ctx.moveTo(px, py)
    } else {
      ctx.lineTo(px, py)
    }
  }
  ctx.closePath()
  ctx.fill()

  // Inner colored body (matches player spike style)
  ctx.shadowBlur = 6
  ctx.fillStyle = markerColor
  ctx.beginPath()
  ctx.arc(playerMinimapX, playerMinimapY, innerRadius * 0.9, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()

  ctx.restore() // Remove clip
  ctx.restore()
}

// Draw notifications - simple, flat neon banners
const drawNotifications = (ctx: CanvasRenderingContext2D, notifications: Notification[], canvasWidth: number) => {
  const now = Date.now()
  const notificationHeight = 44
  const horizontalMargin = 10
  const verticalMargin = 10

  notifications.forEach((notification, index) => {
    const age = now - notification.timestamp
    const fadeInDuration = 200 // Fade in over 200ms
    const fadeOutStart = 2700 // Start fading at 2.7 seconds
    const duration = 3000 // Total duration 3 seconds

    // Calculate opacity with fade-in and fade-out
    let opacity = 1
    if (age < fadeInDuration) {
      opacity = age / fadeInDuration
    } else if (age > fadeOutStart) {
      opacity = 1 - ((age - fadeOutStart) / (duration - fadeOutStart))
    }
    notification.opacity = Math.max(0, Math.min(1, opacity))

    // Measure text to determine dynamic width
    ctx.save()
    ctx.font = '700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    const iconSpace = 24 // space reserved for a small icon
    const textPaddingX = 18
    const maxWidth = canvasWidth - horizontalMargin * 2
    const textMetrics = ctx.measureText(notification.message)
    const rawWidth = iconSpace + textPaddingX * 2 + textMetrics.width
    const notificationWidth = Math.min(maxWidth, rawWidth)

    // Center horizontally with 10px margin from canvas edges
    const x = Math.max(horizontalMargin, (canvasWidth - notificationWidth) / 2)
    const y = verticalMargin + index * (notificationHeight + 10)

    ctx.globalAlpha = notification.opacity

    // Background - flat dark rounded rectangle
    const radius = 10
    ctx.fillStyle = 'rgba(10, 10, 25, 0.96)'
    drawRoundedRect(ctx, x, y, notificationWidth, notificationHeight, radius)
    ctx.fill()

    // Border - subtle neon blue
    ctx.strokeStyle = 'rgba(0, 217, 255, 0.75)'
    ctx.lineWidth = 1.5
    drawRoundedRect(ctx, x, y, notificationWidth, notificationHeight, radius)
    ctx.stroke()

    // Optional left icon: simple small cyan circle
    const iconCenterX = x + textPaddingX
    const iconCenterY = y + notificationHeight / 2
    const iconRadius = 6
    ctx.beginPath()
    ctx.arc(iconCenterX, iconCenterY, iconRadius, 0, Math.PI * 2)
    ctx.fillStyle = '#00d9ff'
    ctx.fill()

    // Text - neon blue, left-aligned
    ctx.fillStyle = '#00e5ff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
    ctx.shadowBlur = 3
    const textX = iconCenterX + iconRadius + 10
    const textY = y + notificationHeight / 2
    ctx.fillText(notification.message, textX, textY)

    ctx.restore()
  })
}

// Handle spike collisions for background
const handleBackgroundCollision = (spike1: Player, spike2: Player) => {
  const dx = spike2.x - spike1.x
  const dy = spike2.y - spike1.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const minDistance = spike1.size + spike2.size + 20

  if (distance < minDistance) {
    const angle = Math.atan2(dy, dx)
    const targetX = spike1.x + Math.cos(angle) * minDistance
    const targetY = spike1.y + Math.sin(angle) * minDistance
    const ax = (targetX - spike2.x) * 0.05
    const ay = (targetY - spike2.y) * 0.05

    spike1.vx -= ax
    spike1.vy -= ay
    spike2.vx += ax
    spike2.vy += ay
  }
}

// Helper function to draw rounded rectangle
const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + width - radius, y)
  ctx.arcTo(x + width, y, x + width, y + radius, radius)
  ctx.lineTo(x + width, y + height - radius)
  ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
  ctx.lineTo(x + radius, y + height)
  ctx.arcTo(x, y + height, x, y + height - radius, radius)
  ctx.lineTo(x, y + radius)
  ctx.arcTo(x, y, x + radius, y, radius)
  ctx.closePath()
}

// Draw status bars (HP and Score) - Modern, sleek design
const drawStatusBars = (
  ctx: CanvasRenderingContext2D,
  health: number,
  score: number,
  canvasWidth: number,
  canvasHeight: number
) => {
  ctx.save()

  // Container dimensions
  const containerWidth = 450
  const containerHeight = 90
  const containerX = (canvasWidth - containerWidth) / 2
  const containerY = canvasHeight - containerHeight - 25
  const containerRadius = 15

  // Draw container shadow for depth
  ctx.save()
  drawRoundedRect(ctx, containerX, containerY + 2, containerWidth, containerHeight, containerRadius)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 20
  ctx.shadowOffsetY = 4
  ctx.fill()
  ctx.restore()

  // Draw container background (flat, no gradients)
  drawRoundedRect(ctx, containerX, containerY, containerWidth, containerHeight, containerRadius)
  ctx.fillStyle = 'rgba(15, 15, 30, 0.95)'
  ctx.fill()

  // Container border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Inner padding
  const padding = 25
  const innerX = containerX + padding
  const innerY = containerY + padding
  const innerWidth = containerWidth - padding * 2

  // Bar dimensions - taller and more prominent
  const barWidth = (innerWidth - 30) / 2
  const barHeight = 16
  const barRadius = 8

  // HP Bar (Left side)
  const hpX = innerX
  const hpY = innerY + 26

  // HP Icon and Label - improved typography
  ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.letterSpacing = '0.5px'
  ctx.fillText('HEALTH', hpX, innerY)

  // HP Value - larger and more prominent
  ctx.font = '700 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'right'
  ctx.shadowColor = 'rgba(78, 205, 196, 0.6)'
  ctx.shadowBlur = 10
  ctx.fillText(`${Math.round(health)}%`, hpX + barWidth, innerY - 3)
  ctx.shadowBlur = 0

  // HP Bar background with border
  drawRoundedRect(ctx, hpX, hpY, barWidth, barHeight, barRadius)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fill()

  // Add border to background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // HP Bar fill (flat, no gradients or glow)
  const hpFillWidth = barWidth * (health / 100)
  if (hpFillWidth > 0) {
    ctx.save()

    // Adjust radius for small widths to prevent timeglass effect
    const hpFillRadius = Math.min(barRadius, hpFillWidth / 2, barHeight / 2)

    drawRoundedRect(ctx, hpX, hpY, hpFillWidth, barHeight, hpFillRadius)
    ctx.clip()

    // Single vibrant color based on health level
    let hpColor
    if (health > 60) {
      // High health - cyan
      hpColor = '#00d9ff'
    } else if (health > 30) {
      // Medium health - gold
      hpColor = '#ffd700'
    } else {
      // Low health - red
      hpColor = '#ff4444'
    }

    drawRoundedRect(ctx, hpX, hpY, hpFillWidth, barHeight, hpFillRadius)
    ctx.fillStyle = hpColor
    ctx.fill()

    ctx.restore()
  }

  // Vertical separator line (flat, no gradient)
  const separatorX = innerX + barWidth + 15
  ctx.beginPath()
  ctx.moveTo(separatorX, innerY)
  ctx.lineTo(separatorX, innerY + barHeight + 28)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1
  ctx.stroke()

  // Score Bar (Right side)
  const scoreX = innerX + barWidth + 30
  const scoreY = innerY + 26

  // Score Icon and Label - improved typography
  ctx.font = '700 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.letterSpacing = '0.5px'
  ctx.fillText('SCORE', scoreX, innerY)

  // Score Value - larger and more prominent with number formatting
  ctx.font = '700 20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'right'
  ctx.shadowColor = 'rgba(255, 215, 0, 0.6)'
  ctx.shadowBlur = 10
  // Format score with commas for readability
  const formattedScore = score.toLocaleString()
  ctx.fillText(formattedScore, scoreX + barWidth, innerY - 3)
  ctx.shadowBlur = 0

  // Score Bar background with border
  drawRoundedRect(ctx, scoreX, scoreY, barWidth, barHeight, barRadius)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
  ctx.fill()

  // Add border to background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Score Bar fill - always show full bar (flat, no gradients or glow)
  const scoreFillWidth = barWidth

  if (scoreFillWidth > 0) {
    ctx.save()
    drawRoundedRect(ctx, scoreX, scoreY, scoreFillWidth, barHeight, barRadius)
    ctx.clip()

    // Single vibrant gold color
    drawRoundedRect(ctx, scoreX, scoreY, scoreFillWidth, barHeight, barRadius)
    ctx.fillStyle = '#ffd700'
    ctx.fill()

    ctx.restore()
  }

  ctx.restore()
}

// Draw progress hints (segment spawning and evolution)
const drawProgressHints = (
  ctx: CanvasRenderingContext2D,
  score: number,
  hasEvolved: boolean,
  tier2Evolved: boolean,
  canvasWidth: number,
  canvasHeight: number
) => {
  ctx.save()

  // Position below the status bars
  const hintY = canvasHeight - 100
  const hintX = canvasWidth / 2

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'

  // Determine what hint to show
  let hintText = ''
  let hintColor = '#00ffff'
  let progress = 0

  if (!hasEvolved && score < EVOLUTION_THRESHOLD) {
    // Show progress to tier 1 evolution
    const remaining = EVOLUTION_THRESHOLD - score
    progress = score / EVOLUTION_THRESHOLD
    hintText = `${remaining.toLocaleString()} to Tier 1 Evolution`
    hintColor = '#ffd700'
  } else if (hasEvolved && !tier2Evolved && score < TIER_2_THRESHOLD) {
    // Show progress to tier 2 evolution
    const remaining = TIER_2_THRESHOLD - score
    progress = (score - EVOLUTION_THRESHOLD) / (TIER_2_THRESHOLD - EVOLUTION_THRESHOLD)
    hintText = `${remaining.toLocaleString()} to Tier 2 Evolution`
    hintColor = '#ff00ff'
  } else {
    // Show progress to next segment
    const nextSegmentScore = Math.ceil(score / 500) * 500
    const remaining = nextSegmentScore - score
    progress = (score % 500) / 500
    hintText = `${remaining} to next segment`
    hintColor = '#00ffff'
  }

  // Draw progress bar
  const barWidth = 200
  const barHeight = 4
  const barX = hintX - barWidth / 2
  const barY = hintY

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
  ctx.fillRect(barX, barY, barWidth, barHeight)

  // Progress fill
  ctx.fillStyle = hintColor
  ctx.fillRect(barX, barY, barWidth * progress, barHeight)

  // Hint text
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = 4
  ctx.fillText(hintText, hintX, barY + barHeight + 6)

  ctx.restore()
}

// Draw leaderboard
const drawLeaderboard = (
  ctx: CanvasRenderingContext2D,
  players: Map<string, Player>,
  localPlayerId: string | null,
  canvasWidth: number
) => {
  // Get top 10 non-AI players sorted by score
  const sortedPlayers = Array.from(players.values())
    .filter((p) => !p.isAI)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  if (sortedPlayers.length === 0) return

  ctx.save()

  // Leaderboard dimensions
  const width = 250
  const headerHeight = 40
  const rowHeight = 32
  const totalHeight = headerHeight + sortedPlayers.length * rowHeight
  const x = canvasWidth - width - 20
  const y = 20
  const radius = 12

  // Background
  drawRoundedRect(ctx, x, y, width, totalHeight, radius)
  ctx.fillStyle = 'rgba(20, 20, 40, 0.85)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'
  ctx.lineWidth = 2
  ctx.stroke()

  // Clip all leaderboard content (header + rows) to rounded rectangle
  ctx.save()
  drawRoundedRect(ctx, x, y, width, totalHeight, radius)
  ctx.clip()

  // Header background
  ctx.fillStyle = 'rgba(255, 70, 70, 0.2)'
  ctx.fillRect(x, y, width, headerHeight)

  // Header title
  ctx.font = '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  ctx.fillStyle = '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('LEADERBOARD', x + width / 2, y + headerHeight / 2)

  // Player rows
  sortedPlayers.forEach((player, index) => {
    const rowY = y + headerHeight + index * rowHeight
    const isLocalPlayer = player.id === localPlayerId
    const isTopThree = index < 3

    // Special highlight for top 3
    if (isTopThree) {
      const pulseTime = Date.now() / 1000
      const pulseAlpha = 0.08 + Math.sin(pulseTime * 2 + index) * 0.04
      const topColors = ['rgba(255, 215, 0, ', 'rgba(192, 192, 192, ', 'rgba(205, 127, 50, ']
      ctx.fillStyle = topColors[index] + pulseAlpha + ')'
      ctx.fillRect(x, rowY, width, rowHeight)
    }

    // Highlight local player row in their team color
    if (isLocalPlayer) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
      ctx.fillRect(x, rowY, width, rowHeight)
    }

    // Rank number (1, 2, 3...) instead of medals
    ctx.font = '700 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    // Top 3: solid white rank number for clarity
    if (isTopThree) {
      ctx.fillStyle = '#ffffff'
      ctx.fillText(`${index + 1}`, x + 15, rowY + rowHeight / 2)
    } else {
      // Others: slightly dimmer white
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)'
      ctx.fillText(`${index + 1}`, x + 15, rowY + rowHeight / 2)
    }

    // Player name - show in their team color
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    const playerColor = player.color || '#ffd700'
    ctx.fillStyle = playerColor
    const maxNameWidth = 120
    let displayName = player.username
    ctx.textAlign = 'left'

    // Truncate name if too long
    let nameWidth = ctx.measureText(displayName).width
    if (nameWidth > maxNameWidth) {
      while (nameWidth > maxNameWidth && displayName.length > 0) {
        displayName = displayName.slice(0, -1)
        nameWidth = ctx.measureText(displayName + '...').width
      }
      displayName += '...'
    }

    ctx.fillText(displayName, x + 45, rowY + rowHeight / 2)

    // Score - show in their team color
    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.fillStyle = playerColor
    ctx.textAlign = 'right'
    ctx.fillText(player.score.toLocaleString(), x + width - 15, rowY + rowHeight / 2)
  })

  ctx.restore() // remove clipping
  ctx.restore()
}

// Draw collision effects (in world space, camera transform already applied)
const drawCollisionEffects = (
  ctx: CanvasRenderingContext2D,
  effects: Array<{ x: number; y: number; startTime: number; duration: number }>
) => {
  const currentTime = Date.now()

  effects.forEach((effect) => {
    const elapsed = currentTime - effect.startTime
    const progress = Math.min(elapsed / effect.duration, 1)

    if (progress < 1) {
      ctx.save()

      // World position (camera transform already applied by caller)
      const worldX = effect.x
      const worldY = effect.y

      // Expanding ring effect
      const maxRadius = 80
      const radius = progress * maxRadius
      const opacity = 1 - progress

      // Outer ring (red)
      ctx.beginPath()
      ctx.arc(worldX, worldY, radius, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255, 50, 50, ${opacity * 0.8})`
      ctx.lineWidth = 6
      ctx.stroke()

      // Inner ring (white)
      ctx.beginPath()
      ctx.arc(worldX, worldY, radius * 0.7, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.6})`
      ctx.lineWidth = 3
      ctx.stroke()

      // Impact particles (small dots radiating outward)
      const particleCount = 12
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2
        const particleRadius = radius * 1.3
        const px = worldX + Math.cos(angle) * particleRadius
        const py = worldY + Math.sin(angle) * particleRadius

        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 100, 100, ${opacity})`
        ctx.fill()
      }

      ctx.restore()
    }
  })

  // Remove finished effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const elapsed = currentTime - effects[i].startTime
    if (elapsed >= effects[i].duration) {
      effects.splice(i, 1)
    }
  }
}


// Draw evolution effects (spectacular upgrade animation)
const drawEvolutionEffects = (
  ctx: CanvasRenderingContext2D,
  effects: Array<{ x: number; y: number; startTime: number; duration: number; spikeType: SpikeType }>
) => {
  const currentTime = Date.now()

  effects.forEach((effect) => {
    const elapsed = currentTime - effect.startTime
    const progress = Math.min(elapsed / effect.duration, 1)

    if (progress < 1) {
      ctx.save()

      const opacity = 1 - progress
      const expandRadius = 150 * progress

      // Determine color based on spike type
      let color1 = '255, 200, 50'
      let color2 = '255, 150, 0'

      switch (effect.spikeType) {
        case 'Prickle': color1 = '255, 140, 0'; color2 = '255, 100, 0'; break
        case 'Thorn': color1 = '150, 200, 255'; color2 = '100, 150, 255'; break
        case 'Bristle': color1 = '0, 255, 255'; color2 = '0, 200, 255'; break
        case 'Bulwark': color1 = '255, 215, 0'; color2 = '255, 180, 0'; break
        case 'Starflare': color1 = '255, 230, 100'; color2 = '200, 150, 255'; break
        case 'Mauler': color1 = '255, 50, 50'; color2 = '200, 0, 0'; break
      }

      // Expanding energy rings
      for (let ring = 0; ring < 5; ring++) {
        const ringProgress = (progress + ring * 0.1) % 1
        const ringRadius = expandRadius * ringProgress
        const ringOpacity = opacity * (1 - ringProgress)

        ctx.beginPath()
        ctx.arc(effect.x, effect.y, ringRadius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${color1}, ${ringOpacity * 0.8})`
        ctx.lineWidth = 6
        ctx.stroke()
      }

      // Central burst
      const burstGrad = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, expandRadius * 0.5)
      burstGrad.addColorStop(0, `rgba(${color1}, ${opacity * 0.9})`)
      burstGrad.addColorStop(0.5, `rgba(${color2}, ${opacity * 0.6})`)
      burstGrad.addColorStop(1, `rgba(${color2}, 0)`)

      ctx.fillStyle = burstGrad
      ctx.beginPath()
      ctx.arc(effect.x, effect.y, expandRadius * 0.5, 0, Math.PI * 2)
      ctx.fill()

      // Radiating particles (reduced for performance)
      const particleCount = 16
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2
        const particleDist = expandRadius * 0.8
        const px = effect.x + Math.cos(angle) * particleDist
        const py = effect.y + Math.sin(angle) * particleDist

        const particleGrad = ctx.createRadialGradient(px, py, 0, px, py, 8)
        particleGrad.addColorStop(0, `rgba(${color1}, ${opacity})`)
        particleGrad.addColorStop(1, `rgba(${color1}, 0)`)

        ctx.fillStyle = particleGrad
        ctx.beginPath()
        ctx.arc(px, py, 8, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }
  })

  // Remove completed effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const elapsed = currentTime - effects[i].startTime
    if (elapsed >= effects[i].duration) {
      effects.splice(i, 1)
    }
  }
}

// Draw speed boost effects (cyan energy burst)
const drawBoostEffects = (
  ctx: CanvasRenderingContext2D,
  effects: Array<{ x: number; y: number; startTime: number; duration: number; vx?: number; vy?: number }>
) => {
  const currentTime = Date.now()

  effects.forEach((effect) => {
    const elapsed = currentTime - effect.startTime
    const progress = Math.min(elapsed / effect.duration, 1)

    if (progress < 1) {
      ctx.save()

      const worldX = effect.x
      const worldY = effect.y
      const vx = effect.vx || 0
      const vy = effect.vy || 0
      const speed = Math.sqrt(vx * vx + vy * vy)
      const opacity = 1 - progress

      if (speed > 0.1) {
        // Directional trail segment aligned with player movement
        const angle = Math.atan2(vy, vx)
        const baseLength = 40
        const length = baseLength + speed * 4
        const thickness = 10 * (1 - progress * 0.6)

        ctx.translate(worldX, worldY)
        ctx.rotate(angle)

        const grad = ctx.createLinearGradient(-length, 0, 0, 0)
        grad.addColorStop(0, 'rgba(0, 255, 255, 0)')
        grad.addColorStop(0.4, `rgba(0, 255, 255, ${0.85 * opacity})`)
        grad.addColorStop(1, 'rgba(255, 0, 200, 0)')

        ctx.strokeStyle = grad
        ctx.lineWidth = thickness
        ctx.lineCap = 'round'

        ctx.beginPath()
        ctx.moveTo(-length, 0)
        ctx.lineTo(0, 0)
        ctx.stroke()
      } else {
        // Soft cyan radial burst at boost start
        const maxRadius = 90
        const radius = (0.4 + progress * 0.6) * maxRadius
        const innerRadius = radius * 0.5

        const glowGradient = ctx.createRadialGradient(worldX, worldY, 0, worldX, worldY, radius)
        glowGradient.addColorStop(0, `rgba(0, 255, 255, ${0.45 * opacity})`)
        glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
        ctx.fillStyle = glowGradient
        ctx.beginPath()
        ctx.arc(worldX, worldY, radius, 0, Math.PI * 2)
        ctx.fill()

        ctx.beginPath()
        ctx.arc(worldX, worldY, innerRadius, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(0, 255, 255, ${0.8 * opacity})`
        ctx.lineWidth = 3
        ctx.stroke()
      }

      ctx.restore()
    }
  })

  // Remove finished effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const elapsed = currentTime - effects[i].startTime
    if (elapsed >= effects[i].duration) {
      effects.splice(i, 1)
    }
  }
}


// Draw score popups (floating +X text)
const drawScorePopups = (ctx: CanvasRenderingContext2D, popups: ScorePopup[]) => {
  const currentTime = Date.now()

  popups.forEach((popup) => {
    const elapsed = currentTime - popup.startTime
    const progress = Math.min(elapsed / popup.duration, 1)

    if (progress < 1) {
      ctx.save()

      // Float upward with easing and fade out
      const easeProgress = 1 - Math.pow(1 - progress, 3) // Ease out cubic
      const yOffset = -easeProgress * 40
      const opacity = 1 - progress // Fully fade out by the end of duration

      // Slight scale effect for subtle pop
      const scale = 1 + (1 - progress) * 0.1

      ctx.globalAlpha = opacity
      ctx.translate(popup.x, popup.y + yOffset)
      ctx.scale(scale, scale)

      // Smaller, sleek neon blue font
      ctx.font = '800 16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // Black outline for readability
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeText(`+${popup.score}`, 0, 0)

      // Neon blue glow
      const neonBlue = '#00e5ff'
      ctx.shadowColor = neonBlue
      ctx.shadowBlur = 8
      ctx.shadowOffsetX = 0
      ctx.shadowOffsetY = 0

      ctx.fillStyle = neonBlue
      ctx.fillText(`+${popup.score}`, 0, 0)

      ctx.restore()
    }
  })

  // Remove finished popups
  for (let i = popups.length - 1; i >= 0; i--) {
    const elapsed = currentTime - popups[i].startTime
    if (elapsed >= popups[i].duration) {
      popups.splice(i, 1)
    }
  }
}

// Draw damage popups (collision feedback for local player)
const drawDamagePopups = (ctx: CanvasRenderingContext2D, popups: DamagePopup[]) => {
  const currentTime = Date.now()

  popups.forEach((popup) => {
    const elapsed = currentTime - popup.startTime
    const progress = Math.min(elapsed / popup.duration, 1)

    if (progress < 1) {
      ctx.save()

      const easeProgress = 1 - Math.pow(1 - progress, 3)
      const yOffset = -easeProgress * 35
      const opacity = 1 - progress

      ctx.globalAlpha = opacity
      ctx.translate(popup.x, popup.y + yOffset)

      let fontSize = 16
      let color = '#ff6666'
      let glow = '#ff3333'

      switch (popup.severity) {
        case 'heavy':
          fontSize = 18
          color = '#ff9f43'
          glow = '#ff9f43'
          break
        case 'critical':
          fontSize = 20
          color = '#ff4b5c'
          glow = '#ff4b5c'
          break
        case 'extreme':
          fontSize = 22
          color = '#ff00aa'
          glow = '#ff00aa'

          break
        case 'kill':
          fontSize = 24
          color = '#ffd54f'
          glow = '#ffd54f'
          break
      }

      ctx.font = `800 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      ctx.strokeStyle = 'rgba(0, 0, 0, 0.95)'
      ctx.lineWidth = 3
      ctx.lineJoin = 'round'
      ctx.strokeText(popup.text, 0, 0)

      ctx.shadowColor = glow
      ctx.shadowBlur = 10
      ctx.fillStyle = color
      ctx.fillText(popup.text, 0, 0)

      ctx.restore()
    }
  })

  // Remove finished popups
  for (let i = popups.length - 1; i >= 0; i--) {
    const elapsed = currentTime - popups[i].startTime
    if (elapsed >= popups[i].duration) {
      popups.splice(i, 1)
    }
  }
}


// Draw collision particles
const drawCollisionParticles = (ctx: CanvasRenderingContext2D, particles: CollisionParticle[]) => {
  particles.forEach((particle) => {
    const lifeProgress = particle.life / particle.maxLife
    const opacity = lifeProgress

    ctx.save()
    ctx.globalAlpha = opacity
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
    ctx.fillStyle = particle.color
    ctx.shadowColor = particle.color
    ctx.shadowBlur = 8
    ctx.fill()
    ctx.restore()

    // Update particle
    particle.x += particle.vx
    particle.y += particle.vy
    particle.life -= 1
  })

  // Remove dead particles
  for (let i = particles.length - 1; i >= 0; i--) {
    if (particles[i].life <= 0) {
      particles.splice(i, 1)
    }
  }
}



// Evolution Option Component with rotating spike preview
const EvolutionOption: React.FC<{
  option: typeof EVOLUTION_OPTIONS[0]
  onSelect: () => void
}> = ({ option, onSelect }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotationRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animationId: number

    const animate = () => {
      rotationRef.current += 0.02

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw rotating spike using the same helper as in-game so Tier 1 and Tier 2 previews match
      const centerX = canvas.width / 2
      const centerY = canvas.height / 2
      const size = 40

      drawSpike(
        ctx,
        centerX,
        centerY,
        size,
        rotationRef.current,
        '#4a9eff',
        undefined,
        0,
        100,
        0,
        0,
        true,
        false,
        option.type as SpikeType,
        1,
      )

      animationId = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationId) cancelAnimationFrame(animationId)
    }
  }, [option.type])

  return (
    <div className="evolution-option" onClick={onSelect}>
      <canvas ref={canvasRef} width={120} height={120} className="spike-preview" />
      <h3 className="evolution-option-name">{option.name}</h3>
      <p className="evolution-option-description">{option.description}</p>

      <div className="evolution-stats">
        <div className="stat-item">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" />
          </svg>
          <span className={`stat-text ${option.stats.speed > 0 ? 'positive' : option.stats.speed < 0 ? 'negative' : 'neutral'}`}>
            {option.stats.speed > 0 ? '+' : ''}{option.stats.speed}% Speed
          </span>
        </div>
        <div className="stat-item">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <span className={`stat-text ${option.stats.damage > 0 ? 'positive' : option.stats.damage < 0 ? 'negative' : 'neutral'}`}>
            {option.stats.damage > 0 ? '+' : ''}{option.stats.damage}% Damage
          </span>
        </div>
        <div className="stat-item">
          <svg className="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
          <span className={`stat-text ${option.stats.health > 0 ? 'positive' : option.stats.health < 0 ? 'negative' : 'neutral'}`}>
            {option.stats.health > 0 ? '+' : ''}{option.stats.health}% Health
          </span>
        </div>
      </div>

      <div className="evolution-ability">
        <div className="ability-name">{option.ability}</div>
        <div className="ability-description">{option.abilityDescription}</div>
      </div>
    </div>
  )
}

// Draw spawn particle effects
const drawSpawnEffects = (
  ctx: CanvasRenderingContext2D,
  effects: Array<{ x: number; y: number; startTime: number; duration: number }>
) => {
  const currentTime = Date.now()

  effects.forEach((effect) => {
    const elapsed = currentTime - effect.startTime
    const progress = Math.min(elapsed / effect.duration, 1)

    if (progress < 1) {
      ctx.save()

      const opacity = 1 - progress
      const radius = 20 + progress * 60

      // Expanding ring
      const gradient = ctx.createRadialGradient(effect.x, effect.y, radius * 0.5, effect.x, effect.y, radius)
      gradient.addColorStop(0, `rgba(0, 255, 200, ${opacity * 0.6})`)
      gradient.addColorStop(1, `rgba(0, 255, 200, 0)`)

      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2)
      ctx.fill()

      // Particles bursting outward
      const particleCount = 12
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2
        const dist = progress * 50
        const px = effect.x + Math.cos(angle) * dist
        const py = effect.y + Math.sin(angle) * dist

        ctx.fillStyle = `rgba(0, 255, 200, ${opacity})`
        ctx.beginPath()
        ctx.arc(px, py, 3, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }
  })

  // Remove completed effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const elapsed = currentTime - effects[i].startTime
    if (elapsed >= effects[i].duration) {
      effects.splice(i, 1)
    }
  }
}

// Draw ability activation particle effects
const drawAbilityEffects = (
  ctx: CanvasRenderingContext2D,
  effects: Array<{ x: number; y: number; startTime: number; duration: number; spikeType: SpikeType }>
) => {
  const currentTime = Date.now()

  effects.forEach((effect) => {
    const elapsed = currentTime - effect.startTime
    const progress = Math.min(elapsed / effect.duration, 1)

    if (progress < 1) {
      ctx.save()

      const opacity = 1 - progress
      const radius = 30 + progress * 70

      // Different colors based on spike type (Tier 1 and Tier 2 variants share a palette per line)
      let color1 = '255, 100, 0'
      let color2 = '255, 200, 0'

      const type = effect.spikeType
      if (type === 'Prickle' || type === 'PrickleVanguard' || type === 'PrickleSwarm' || type === 'PrickleBastion') {
        color1 = '255, 100, 0'
        color2 = '255, 200, 0'
      } else if (type === 'Thorn' || type === 'ThornWraith' || type === 'ThornShade') {
        color1 = '200, 0, 255'
        color2 = '255, 0, 255'
      } else if (type === 'Bristle' || type === 'BristleBlitz' || type === 'BristleStrider' || type === 'BristleSkirmisher') {
        color1 = '0, 200, 255'
        color2 = '0, 255, 255'
      } else if (type === 'Bulwark' || type === 'BulwarkAegis' || type === 'BulwarkCitadel' || type === 'BulwarkJuggernaut') {
        color1 = '100, 100, 255'
        color2 = '150, 150, 255'
      } else if (type === 'Starflare' || type === 'StarflarePulsar' || type === 'StarflareHorizon' || type === 'StarflareNova') {
        color1 = '255, 255, 0'
        color2 = '255, 200, 100'
      } else if (type === 'Mauler' || type === 'MaulerRavager' || type === 'MaulerBulwark' || type === 'MaulerApex') {
        color1 = '255, 0, 100'
        color2 = '255, 100, 150'
      }

      // Expanding burst
      const gradient = ctx.createRadialGradient(effect.x, effect.y, 0, effect.x, effect.y, radius)
      gradient.addColorStop(0, `rgba(${color1}, ${opacity * 0.8})`)
      gradient.addColorStop(0.5, `rgba(${color2}, ${opacity * 0.4})`)
      gradient.addColorStop(1, `rgba(${color2}, 0)`)

      ctx.fillStyle = gradient
      ctx.beginPath()
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2)
      ctx.fill()

      // Rotating particles
      const particleCount = 16
      for (let i = 0; i < particleCount; i++) {
        const angle = (i / particleCount) * Math.PI * 2 + progress * Math.PI * 4
        const dist = 20 + Math.sin(progress * Math.PI) * 30
        const px = effect.x + Math.cos(angle) * dist
        const py = effect.y + Math.sin(angle) * dist

        ctx.fillStyle = `rgba(${color1}, ${opacity})`
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()
    }
  })

  // Remove completed effects
  for (let i = effects.length - 1; i >= 0; i--) {
    const elapsed = currentTime - effects[i].startTime
    if (elapsed >= effects[i].duration) {
      effects.splice(i, 1)
    }
  }
}

function App() {
  const [displayName, setDisplayName] = useState('')
  const [gameState, setGameState] = useState<GameState>('menu')
  const [deathStats, setDeathStats] = useState<DeathStats | null>(null)
  const [deathAnimationProgress, setDeathAnimationProgress] = useState(0)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [isChatOpen, setIsChatOpen] = useState(true)
  const [showEvolutionTree, setShowEvolutionTree] = useState(false)
  const [hasEvolved, setHasEvolved] = useState(false)
  const [tier2Evolved, setTier2Evolved] = useState(false)
  const [currentSpikeType, setCurrentSpikeType] = useState<SpikeType>('Spike')
  const [showAudioSettings, setShowAudioSettings] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showControlsGuide, setShowControlsGuide] = useState(false)
  const [showHowToPlay, setShowHowToPlay] = useState(false)
  const [tutorialStep, setTutorialStep] = useState(0)
  // AFK state
  const [isAFK, setIsAFK] = useState(false)
  const [afkActivationProgress, setAfkActivationProgress] = useState(0)
  // Reconnection state
  const [isReconnected, setIsReconnected] = useState(false)
  const [showDisconnectScreen, setShowDisconnectScreen] = useState(false)
  // Loading screen state
  const [loadingTip, setLoadingTip] = useState('')
  // Keybindings state
  const [keybindings, setKeybindings] = useState<KeyBindings>(getKeybindings())
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [currentUser, setCurrentUser] = useState<{ username: string; id: string } | null>(null)
  const [showSignUp, setShowSignUp] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [showAuthSettings, setShowAuthSettings] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [authNotification, setAuthNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Server selection state
  const [showServerSelector, setShowServerSelector] = useState(false)
  const [selectedServerUrl, setSelectedServerUrl] = useState<string>(DEFAULT_SERVER_URL)

  // Customizations state
  const [showCustomizations, setShowCustomizations] = useState(false)
  const [customizationsTab, setCustomizationsTab] = useState<'nametags' | 'spikes'>('nametags')
  const [premiumOrbs, setPremiumOrbs] = useState(0)
  const [ownedCustomizations, setOwnedCustomizations] = useState<string[]>([])
  const [activeNametag, setActiveNametag] = useState<string | null>(null)
  const [activeSpike, setActiveSpike] = useState<string | null>(null)
  const [availableCustomizations, setAvailableCustomizations] = useState<any>(null)

  // Bug report state
  const [showBugReport, setShowBugReport] = useState(false)
  const [bugDescription, setBugDescription] = useState('')
  const [bugSteps, setBugSteps] = useState('')
  const [bugExpected, setBugExpected] = useState('')

  const hasEvolvedRef = useRef(false)
  const tier2EvolvedRef = useRef(false)
  // Health and score are now managed server-side and received via player object
  const chatLogRef = useRef<HTMLDivElement | null>(null)
  const chatInputRef = useRef<HTMLInputElement | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const playersRef = useRef<Map<string, Player>>(new Map())
  const localPlayerIdRef = useRef<string | null>(null)
  const keysRef = useRef({ w: false, a: false, s: false, d: false })
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 }) // Mouse position in world coordinates
  const backgroundSpikesRef = useRef<Player[]>([])
  const mapConfigRef = useRef<MapConfig>({ width: 8000, height: 8000 })
  const animationFrameRef = useRef<number | null>(null)
  const foodRef = useRef<Food[]>([])
  const premiumOrbsRef = useRef<PremiumOrb[]>([])
  const playerScoresRef = useRef<Map<string, number>>(new Map())
  // Eating animation is now handled server-side
  const notificationsRef = useRef<Notification[]>([])
  // Collision effects
  const collisionEffectsRef = useRef<Array<{
    x: number
    y: number
    startTime: number
    duration: number
  }>>([])

  // Touch / mobile controls
  const [isTouchDevice, setIsTouchDevice] = useState(false)
  const [isPortrait, setIsPortrait] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const touchCursorRef = useRef<{ x: number; y: number } | null>(null)

  // Joystick state
  const [joystickActive, setJoystickActive] = useState(false)
  const joystickBaseRef = useRef<{ x: number; y: number } | null>(null)
  const joystickVectorRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  // Local player score state for UI updates
  const [localPlayerScore, setLocalPlayerScore] = useState(0)
  const [localPlayerSpikeType, setLocalPlayerSpikeType] = useState('Spike')

  // Movement start state (Press P to start)
  const [hasStartedMoving, setHasStartedMoving] = useState(false)

  // Fullscreen functions
  const enterFullscreen = () => {
    const elem = document.documentElement
    if (elem.requestFullscreen) {
      elem.requestFullscreen()
    } else if ((elem as any).webkitRequestFullscreen) {
      (elem as any).webkitRequestFullscreen()
    } else if ((elem as any).mozRequestFullScreen) {
      (elem as any).mozRequestFullScreen()
    } else if ((elem as any).msRequestFullscreen) {
      (elem as any).msRequestFullscreen()
    }
  }

  const exitFullscreen = () => {
    if (document.exitFullscreen) {
      document.exitFullscreen()
    } else if ((document as any).webkitExitFullscreen) {
      (document as any).webkitExitFullscreen()
    } else if ((document as any).mozCancelFullScreen) {
      (document as any).mozCancelFullScreen()
    } else if ((document as any).msExitFullscreen) {
      (document as any).msExitFullscreen()
    }
  }

  const toggleFullscreen = () => {
    if (isFullscreen) {
      exitFullscreen()
    } else {
      enterFullscreen()
    }
  }

  // Detect touch-capable devices for mobile/iPad controls
  useEffect(() => {
    const hasTouch =
      'ontouchstart' in window || navigator.maxTouchPoints > 0 || (navigator as any).msMaxTouchPoints > 0
    setIsTouchDevice(hasTouch)
  }, [])

	  // Track orientation for touch devices (used to enforce landscape on mobile/tablet)
	  useEffect(() => {
	    const updateOrientation = () => {
	      if (typeof window === 'undefined') return
	      const { innerWidth, innerHeight } = window
	      setIsPortrait(innerHeight > innerWidth)
	    }

	    updateOrientation()

	    window.addEventListener('resize', updateOrientation)
	    window.addEventListener('orientationchange', updateOrientation as any)

	    return () => {
	      window.removeEventListener('resize', updateOrientation)
	      window.removeEventListener('orientationchange', updateOrientation as any)
	    }
	  }, [])

	  // Attempt to lock orientation to landscape on supported mobile browsers
	  useEffect(() => {
	    if (!isTouchDevice) return
	    const orientation = (screen as any).orientation
	    if (orientation && typeof orientation.lock === 'function') {
	      orientation.lock('landscape').catch(() => {
	        // Ignore errors (unsupported or not in fullscreen)
	      })
	    }
	  }, [isTouchDevice])

  // Track fullscreen state
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      )
      setIsFullscreen(isCurrentlyFullscreen)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange)
    document.addEventListener('mozfullscreenchange', handleFullscreenChange)
    document.addEventListener('MSFullscreenChange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange)
      document.removeEventListener('mozfullscreenchange', handleFullscreenChange)
      document.removeEventListener('MSFullscreenChange', handleFullscreenChange)
    }
  }, [])

  // Auto-enter fullscreen on mobile when starting to play
  useEffect(() => {
    if (isTouchDevice && gameState === 'playing' && !isFullscreen) {
      // Small delay to ensure user interaction has occurred
      const timer = setTimeout(() => {
        enterFullscreen()
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isTouchDevice, gameState, isFullscreen])

  // Score popups
  const scorePopupsRef = useRef<ScorePopup[]>([])
  // Collision particles
  const collisionParticlesRef = useRef<CollisionParticle[]>([])
  // Boost visual effects (bursts + trails)
  const boostEffectsRef = useRef<Array<{
    x: number
    y: number
    startTime: number
    duration: number
    vx?: number
    vy?: number
  }>>([])
  // Active boost trails (for motion streaks after a boost)
  const boostTrailsRef = useRef<Array<{
    playerId: string
    startTime: number
    duration: number
  }>>([])
  // Evolution effects
  const evolutionEffectsRef = useRef<Array<{
    x: number
    y: number
    startTime: number
    duration: number
    spikeType: SpikeType
  }>>([])
  // Damage popups (collision feedback)
  const damagePopupsRef = useRef<DamagePopup[]>([])

  // Speed boost cooldown UI state
  const [boostOnCooldown, setBoostOnCooldown] = useState(false)
  const boostCooldownTimeoutRef = useRef<number | null>(null)

  // Ability cooldown UI state
  const [abilityOnCooldown, setAbilityOnCooldown] = useState(false)
  const abilityCooldownTimeoutRef = useRef<number | null>(null)

  // Update local player score and spike type for UI at 10 FPS (every 100ms)
  useEffect(() => {
    if (gameState !== 'playing') return

    const updateInterval = setInterval(() => {
      const localPlayer = localPlayerIdRef.current
        ? playersRef.current.get(localPlayerIdRef.current)
        : null

      if (localPlayer) {
        const newScore = localPlayer.score || 0
        const newSpikeType = localPlayer.spikeType || 'Spike'

        // Only update if values changed to avoid unnecessary re-renders
        setLocalPlayerScore(prevScore => prevScore !== newScore ? newScore : prevScore)
        setLocalPlayerSpikeType(prevType => prevType !== newSpikeType ? newSpikeType : prevType)
      }
    }, 100) // Update 10 times per second (much less than 60 FPS render loop)

    return () => clearInterval(updateInterval)
  }, [gameState])

  // Calculate progress info using useMemo to ensure it updates when score changes
  const progressInfo = useMemo(() => {
    const currentScore = localPlayerScore
    const spikeType = localPlayerSpikeType

    // Calculate next segment spawn
    const nextSegmentScore = Math.ceil(currentScore / 500) * 500
    const scoreUntilSegment = nextSegmentScore - currentScore

    // Calculate evolution progress
    let evolutionText = ''
    if (!hasEvolvedRef.current && currentScore < EVOLUTION_THRESHOLD) {
      const remaining = EVOLUTION_THRESHOLD - currentScore
      evolutionText = `${remaining.toLocaleString()} score until Tier 1 Evolution`
    } else if (hasEvolvedRef.current && !tier2EvolvedRef.current && currentScore < TIER_2_THRESHOLD) {
      const remaining = TIER_2_THRESHOLD - currentScore
      evolutionText = `${remaining.toLocaleString()} score until Tier 2 Evolution`
    } else if (tier2EvolvedRef.current) {
      evolutionText = 'Max Evolution Reached'
    }

    return {
      spikeType,
      scoreUntilSegment,
      evolutionText
    }
  }, [localPlayerScore, localPlayerSpikeType])

  // Camera position for smooth interpolation
  const cameraRef = useRef({ x: 0, y: 0 })

  // Screen shake state
  const screenShakeRef = useRef({ x: 0, y: 0, intensity: 0, startTime: 0, duration: 0 })

  // Camera zoom based on player size
  const cameraZoomRef = useRef(1)

  // Spawn particle effects
  const spawnEffectsRef = useRef<Array<{
    x: number
    y: number
    startTime: number
    duration: number
  }>>([])

  // Ability activation particle effects
  const abilityEffectsRef = useRef<Array<{
    x: number
    y: number
    startTime: number
    duration: number
    spikeType: SpikeType
  }>>([])

  // Damage flash effect for local player
  const damageFlashRef = useRef({ active: false, startTime: 0, duration: 200 })

  // Initialize Canvas with proper DPI scaling for crisp rendering
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size with device pixel ratio for crisp rendering on high-DPI displays
    const resizeCanvas = () => {
      // Get device pixel ratio (2 on Retina displays, 1 on standard displays)
      const dpr = window.devicePixelRatio || 1

      // Get CSS size (viewport size)
      const displayWidth = window.innerWidth
      const displayHeight = window.innerHeight

      // Set canvas internal resolution to match physical pixels
      canvas.width = displayWidth * dpr
      canvas.height = displayHeight * dpr

      // Set CSS size to match viewport (this is what the user sees)
      canvas.style.width = `${displayWidth}px`
      canvas.style.height = `${displayHeight}px`

      // Scale all drawing operations by DPI to match the increased resolution
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.scale(dpr, dpr)
        // Disable image smoothing to prevent blur during fast movement
        ctx.imageSmoothingEnabled = false
      }
    }

    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    return () => {
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  // Prevent FOV hack via browser zoom
  useEffect(() => {
    // Prevent keyboard zoom shortcuts (Cmd/Ctrl + Plus/Minus/0)
    const preventZoomKeys = (e: KeyboardEvent) => {
      // Check for Ctrl or Cmd key
      if (e.ctrlKey || e.metaKey) {
        // Prevent zoom in: Ctrl/Cmd + Plus or Ctrl/Cmd + Equals (same key)
        if (e.key === '+' || e.key === '=' || e.code === 'Equal' || e.code === 'NumpadAdd') {
          e.preventDefault()
          return false
        }
        // Prevent zoom out: Ctrl/Cmd + Minus
        if (e.key === '-' || e.code === 'Minus' || e.code === 'NumpadSubtract') {
          e.preventDefault()
          return false
        }
        // Prevent reset zoom: Ctrl/Cmd + 0
        if (e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') {
          e.preventDefault()
          return false
        }
      }
    }

    // Prevent mouse wheel zoom (Ctrl/Cmd + scroll)
    const preventWheelZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        return false
      }
    }

    // Prevent pinch-to-zoom on touch devices
    const preventTouchZoom = (e: TouchEvent) => {
      if (e.touches.length > 1) {
        e.preventDefault()
        return false
      }
    }

    // Prevent gesturestart (Safari pinch-to-zoom)
    const preventGesture = (e: Event) => {
      e.preventDefault()
      return false
    }

    // Add event listeners
    document.addEventListener('keydown', preventZoomKeys, { passive: false })
    document.addEventListener('wheel', preventWheelZoom, { passive: false })
    document.addEventListener('touchmove', preventTouchZoom, { passive: false })
    document.addEventListener('gesturestart', preventGesture, { passive: false })
    document.addEventListener('gesturechange', preventGesture, { passive: false })
    document.addEventListener('gestureend', preventGesture, { passive: false })

    return () => {
      document.removeEventListener('keydown', preventZoomKeys)
      document.removeEventListener('wheel', preventWheelZoom)
      document.removeEventListener('touchmove', preventTouchZoom)
      document.removeEventListener('gesturestart', preventGesture)
      document.removeEventListener('gesturechange', preventGesture)
      document.removeEventListener('gestureend', preventGesture)
    }
  }, [])

  // Cosmic background animation for menu and connecting screens
  useEffect(() => {
    if (gameState === 'playing') {
      // Cancel any existing menu animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    // Track fade-out animation
    let fadeAlpha = 1.0
    const fadeStartTime = gameState === 'connecting' ? Date.now() : null
    const fadeDuration = 1000 // 1 second fade

    // Animation loop
    const animate = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Calculate fade alpha if connecting
      if (fadeStartTime) {
        const elapsed = Date.now() - fadeStartTime
        fadeAlpha = Math.max(0, 1 - elapsed / fadeDuration)
      }

      // Save context for global alpha
      ctx.save()
      ctx.globalAlpha = fadeAlpha

      // ═══════════════════════════════════════════════════════════════
      // COSMIC HOMEPAGE BACKGROUND - Enhanced Cosmic Scene
      // ═══════════════════════════════════════════════════════════════

      const time = Date.now() / 1000

      // Animated cosmic gradient background
      const gradient = ctx.createRadialGradient(
        canvas.width / 2 + Math.sin(time * 0.3) * 200,
        canvas.height / 2 + Math.cos(time * 0.2) * 200,
        0,
        canvas.width / 2,
        canvas.height / 2,
        Math.max(canvas.width, canvas.height) * 0.8
      )
      gradient.addColorStop(0, '#1a0033') // Deep purple
      gradient.addColorStop(0.3, '#0a0015') // Darker purple
      gradient.addColorStop(0.6, '#050010') // Very dark purple
      gradient.addColorStop(1, '#000005') // Almost black
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // Nebula clouds in background
      const nebulae = [
        { x: canvas.width * 0.2, y: canvas.height * 0.3, size: 300, color: '#ff00ff', alpha: 0.08 },
        { x: canvas.width * 0.7, y: canvas.height * 0.6, size: 400, color: '#00ffff', alpha: 0.06 },
        { x: canvas.width * 0.5, y: canvas.height * 0.8, size: 350, color: '#8800ff', alpha: 0.07 },
      ]

      nebulae.forEach((nebula, index) => {
        const nebulaX = nebula.x + Math.sin(time * 0.2 + index) * 50
        const nebulaY = nebula.y + Math.cos(time * 0.15 + index) * 50
        const nebulaPulse = Math.sin(time + index) * 0.3 + 0.7

        const nebulaGradient = ctx.createRadialGradient(
          nebulaX, nebulaY, 0,
          nebulaX, nebulaY, nebula.size * nebulaPulse
        )
        nebulaGradient.addColorStop(0, nebula.color + Math.floor(nebula.alpha * 255).toString(16).padStart(2, '0'))
        nebulaGradient.addColorStop(0.5, nebula.color + Math.floor(nebula.alpha * 128).toString(16).padStart(2, '0'))
        nebulaGradient.addColorStop(1, nebula.color + '00')

        ctx.fillStyle = nebulaGradient
        ctx.globalAlpha = fadeAlpha
        ctx.beginPath()
        ctx.arc(nebulaX, nebulaY, nebula.size * nebulaPulse, 0, Math.PI * 2)
        ctx.fill()
      })

      // Distant stars (background layer)
      for (let i = 0; i < 80; i++) {
        const x = (i * 421 % canvas.width)
        const y = (i * 631 % canvas.height)
        const size = 0.5 + (i % 3) * 0.3
        const twinkle = Math.sin(time * 1.5 + i * 0.7) * 0.3 + 0.5

        ctx.fillStyle = '#ffffff'
        ctx.globalAlpha = fadeAlpha * twinkle * 0.4
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      // Floating cosmic particles (medium layer)
      for (let i = 0; i < 120; i++) {
        const x = (i * 547 % canvas.width) + Math.sin(time * 0.5 + i) * 30
        const y = (i * 739 % canvas.height) + Math.cos(time * 0.3 + i) * 30
        const size = (i % 4) * 0.5 + 1
        const twinkle = Math.sin(time * 2 + i) * 0.5 + 0.5

        const colors = ['#ff00ff', '#00ffff', '#ff0088', '#00ff88', '#ffff00']
        const color = colors[i % colors.length]

        ctx.fillStyle = color
        ctx.globalAlpha = fadeAlpha * twinkle * 0.6
        ctx.shadowColor = color
        ctx.shadowBlur = 4
        ctx.beginPath()
        ctx.arc(x, y, size, 0, Math.PI * 2)
        ctx.fill()
      }

      // Shooting stars (top-left to bottom-right, facing bottom-right)
      for (let i = 0; i < 3; i++) {
        const shootingStarProgress = (time * 0.3 + i * 2) % 3
        if (shootingStarProgress < 1) {
          // Start from top-left, move to bottom-right
          const startX = (i * 300 + shootingStarProgress * canvas.width * 1.5) % canvas.width
          const startY = (i * 200 + shootingStarProgress * canvas.height * 0.5) % canvas.height
          const endX = startX + 100 // Move right (bottom-right direction)
          const endY = startY + 50  // Move down (bottom-right direction)

          // Gradient from tail (start) to head (end) - bright at the head
          const shootingGradient = ctx.createLinearGradient(startX, startY, endX, endY)
          shootingGradient.addColorStop(0, '#00ffff00') // Transparent tail
          shootingGradient.addColorStop(0.5, '#00ffff80') // Semi-transparent middle
          shootingGradient.addColorStop(1, '#ffffff') // Bright white head

          ctx.strokeStyle = shootingGradient
          ctx.lineWidth = 2
          ctx.globalAlpha = fadeAlpha * (1 - shootingStarProgress)
          ctx.beginPath()
          ctx.moveTo(startX, startY)
          ctx.lineTo(endX, endY)
          ctx.stroke()
        }
      }

      // Pulsing energy rings (multiple layers)
      const ringPulse = Math.sin(time * 1.5) * 0.3 + 0.7
      const ringPulse2 = Math.sin(time * 1.2 + 1) * 0.3 + 0.7

      // Outer ring
      ctx.globalAlpha = fadeAlpha * 0.1
      ctx.strokeStyle = '#8800ff'
      ctx.lineWidth = 2
      ctx.shadowColor = '#8800ff'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, 250 * ringPulse2, 0, Math.PI * 2)
      ctx.stroke()

      // Middle ring
      ctx.globalAlpha = fadeAlpha * 0.15
      ctx.strokeStyle = '#00ffff'
      ctx.lineWidth = 2
      ctx.shadowColor = '#00ffff'
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, 150 * ringPulse, 0, Math.PI * 2)
      ctx.stroke()

      // Inner ring
      ctx.strokeStyle = '#ff00ff'
      ctx.shadowColor = '#ff00ff'
      ctx.beginPath()
      ctx.arc(canvas.width / 2, canvas.height / 2, 225 * ringPulse, 0, Math.PI * 2)
      ctx.stroke()

      // Geometric cosmic pattern (hexagons)
      ctx.globalAlpha = fadeAlpha * 0.08
      ctx.strokeStyle = '#00ffff'
      ctx.lineWidth = 1
      const hexSize = 40
      const hexPulse = Math.sin(time) * 0.2 + 0.8

      for (let hx = 0; hx < 5; hx++) {
        for (let hy = 0; hy < 4; hy++) {
          const centerX = canvas.width / 2 + (hx - 2) * hexSize * 1.5 * hexPulse
          const centerY = canvas.height / 2 + (hy - 1.5) * hexSize * 1.3 * hexPulse

          ctx.beginPath()
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i
            const x = centerX + Math.cos(angle) * hexSize * hexPulse
            const y = centerY + Math.sin(angle) * hexSize * hexPulse
            if (i === 0) {
              ctx.moveTo(x, y)
            } else {
              ctx.lineTo(x, y)
            }
          }
          ctx.closePath()
          ctx.stroke()
        }
      }

      ctx.restore()

      animationFrameRef.current = requestAnimationFrame(animate)
    }

    animate()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [gameState])

  // Food and premium orbs are now initialized by the server in the 'init' event
  // No client-side initialization needed

  // Handle keyboard input (WASD + Arrow keys) - only when playing
  useEffect(() => {
    // Only attach keyboard listeners when actually playing
    if (gameState !== 'playing') return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept keys if user is typing in an input field
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }

      // Don't allow input during evolution tree or death
      const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
      const isDying = localPlayer?.isDying || false

      const key = e.key.toLowerCase()

      // Press P to start moving
      if (key === 'p' && !hasStartedMoving) {
        setHasStartedMoving(true)
        audioManager.playSFX('uiClick')
        e.preventDefault()
        return
      }

      // Press chat key to open/focus chat while playing
      if (key === keybindings.chat.toLowerCase()) {
        setIsChatOpen(true)
        setTimeout(() => {
          if (chatInputRef.current) {
            chatInputRef.current.focus()
          }
        }, 0)
        e.preventDefault()
        return
      }

      // Block movement and abilities during death or evolution tree
      if (isDying || showEvolutionTree) {
        e.preventDefault()
        return
      }

      if (key === keybindings.moveUp.toLowerCase() || key === 'arrowup') {
        keysRef.current.w = true
        e.preventDefault()
      }
      if (key === keybindings.moveLeft.toLowerCase() || key === 'arrowleft') {
        keysRef.current.a = true
        e.preventDefault()
      }
      if (key === keybindings.moveDown.toLowerCase() || key === 'arrowdown') {
        keysRef.current.s = true
        e.preventDefault()
      }
      if (key === keybindings.moveRight.toLowerCase() || key === 'arrowright') {
        keysRef.current.d = true
        e.preventDefault()
      }
      if (key === keybindings.speedBoost.toLowerCase()) {
        if (!e.repeat) {
          triggerSpeedBoost()
        }
        e.preventDefault()
      }
      if (key === keybindings.specialAbility.toLowerCase()) {
        if (!e.repeat) {
          triggerAbility()
        }
        e.preventDefault()
      }

      // Controls guide toggle
      if (key === keybindings.controlsGuide.toLowerCase()) {
        if (!e.repeat) {
          setShowControlsGuide(prev => !prev)
          audioManager.playSFX('uiClick')
        }
        e.preventDefault()
      }

      // AFK mode toggle
      if (key === keybindings.afkToggle.toLowerCase()) {
        if (!e.repeat && socketRef.current) {
          socketRef.current.emit('toggleAFK')
          audioManager.playSFX('uiClick')
        }
        e.preventDefault()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      // Don't intercept keys if user is typing in an input field
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return
      }

      const key = e.key.toLowerCase()
      if (key === keybindings.moveUp.toLowerCase() || key === 'arrowup') {
        keysRef.current.w = false
        e.preventDefault()
      }
      if (key === keybindings.moveLeft.toLowerCase() || key === 'arrowleft') {
        keysRef.current.a = false
        e.preventDefault()
      }
      if (key === keybindings.moveDown.toLowerCase() || key === 'arrowdown') {
        keysRef.current.s = false
        e.preventDefault()
      }
      if (key === keybindings.moveRight.toLowerCase() || key === 'arrowright') {
        keysRef.current.d = false
        e.preventDefault()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [gameState, keybindings])

  // Mouse tracking for cursor-based movement
  useEffect(() => {
    if (gameState !== 'playing') return

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
      if (!localPlayer) return

      // Get canvas bounding rect
      const rect = canvas.getBoundingClientRect()

      // Convert screen coordinates to canvas coordinates (CSS pixels)
      const canvasX = e.clientX - rect.left
      const canvasY = e.clientY - rect.top

      // Convert canvas coordinates to world coordinates
      // Account for camera offset (camera is centered on player)
      // Note: Use rect.width/height (CSS pixels) not canvas.width/height (physical pixels)
      const displayWidth = rect.width
      const displayHeight = rect.height

      const cameraX = localPlayer.x - displayWidth / 2
      const cameraY = localPlayer.y - displayHeight / 2

      const worldX = canvasX + cameraX
      const worldY = canvasY + cameraY

      mousePositionRef.current = { x: worldX, y: worldY }
    }

    // Joystick-based cursor control for mobile
    const updateCursorFromJoystick = () => {
      if (!isTouchDevice || !joystickActive) return

      const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
      if (!localPlayer) return

      const canvas = canvasRef.current
      if (!canvas) return

      const rect = canvas.getBoundingClientRect()

      // Get joystick vector (normalized direction)
      const joyX = joystickVectorRef.current.x
      const joyY = joystickVectorRef.current.y

      // Calculate cursor position based on joystick direction
      // Place cursor 200 pixels away from player in joystick direction
      const cursorDistance = 200
      const cursorOffsetX = joyX * cursorDistance
      const cursorOffsetY = joyY * cursorDistance

      // Calculate world position of cursor
      const worldX = localPlayer.x + cursorOffsetX
      const worldY = localPlayer.y + cursorOffsetY

      mousePositionRef.current = { x: worldX, y: worldY }

      // Calculate screen position for cursor indicator
      const cameraX = localPlayer.x - rect.width / 2
      const cameraY = localPlayer.y - rect.height / 2

      const screenX = (worldX - cameraX) + rect.left
      const screenY = (worldY - cameraY) + rect.top

      touchCursorRef.current = { x: screenX, y: screenY }
    }

    // Update cursor position continuously when joystick is active
    const joystickInterval = setInterval(() => {
      if (joystickActive) {
        updateCursorFromJoystick()
      }
    }, 16) // ~60 FPS

    return () => {
      clearInterval(joystickInterval)
    }
  }, [gameState, isTouchDevice, joystickActive])

  // Mouse movement handler
  useEffect(() => {
    if (gameState !== 'playing' || isTouchDevice) return

    const handleMouseMove = (e: MouseEvent) => {
      const canvas = canvasRef.current
      if (!canvas) return

      const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
      if (!localPlayer) return

      const rect = canvas.getBoundingClientRect()
      const canvasX = e.clientX - rect.left
      const canvasY = e.clientY - rect.top

      const displayWidth = rect.width
      const displayHeight = rect.height

      const cameraX = localPlayer.x - displayWidth / 2
      const cameraY = localPlayer.y - displayHeight / 2

      const worldX = canvasX + cameraX
      const worldY = canvasY + cameraY

      mousePositionRef.current = { x: worldX, y: worldY }
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }
  }, [gameState, isTouchDevice])

  // Socket.IO connection - connect once when leaving menu
  useEffect(() => {
    if (gameState === 'menu') {
      // DON'T disconnect when going to menu - keep the socket alive
      // This allows the user to stay authenticated and prevents the "Disconnected" error
      // The socket will only disconnect when the user explicitly logs out
      return
    }

    // Only connect if we don't have a socket yet
    if (socketRef.current) return

    console.log('Connecting to server...')

    // Get auth token if available
    const authToken = localStorage.getItem('authToken')

    // Create socket connection with auth token
    const socket = io(selectedServerUrl, {
      auth: authToken ? { token: authToken } : undefined
    })
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Connected to server')

      // When reconnecting from a closed tab within the 60s window, the
      // server will restore our previous spike based on the username we
      // send here. Using the same displayName is what makes reconnection
      // behave like "respawn back into the same spike".
      // Also send active customizations from localStorage
      const storedNametag = localStorage.getItem('activeNametag') || 'nametag_default'
      const storedSpike = localStorage.getItem('activeSpike') || 'spike_default'

      socket.emit('join', {
        username: displayName,
        activeNametag: storedNametag,
        activeSpike: storedSpike
      })
    })

    socket.on('init', (data: {
      playerId: string;
      player: Player;
      players: Player[];
      food: Food[];
      premiumOrbs: PremiumOrb[];
      mapConfig: MapConfig;
      reconnected?: boolean;
    }) => {
      localPlayerIdRef.current = data.playerId
      mapConfigRef.current = data.mapConfig

      // Reset movement state on spawn (unless reconnecting)
      if (!data.reconnected) {
        setHasStartedMoving(false)
      }

      // Successful init means we are now fully in the game.
      // If we were in the "connecting" state, advance to "playing".
      setGameState('playing')

      // Check if this is a reconnection
      if (data.reconnected) {
        setIsReconnected(true)
        setShowDisconnectScreen(false)

        // Restore evolution state from reconnected player
        const localPlayer = data.players.find((p) => p.id === data.playerId)
        if (localPlayer) {
          const spikeType = (localPlayer as any).spikeType || 'Spike'
          const hasEvolvedState = (localPlayer as any).hasEvolved || false
          const tier2EvolvedState = (localPlayer as any).tier2Evolved || false

          console.log(`🔄 Restoring evolution state: ${spikeType}, hasEvolved: ${hasEvolvedState}, tier2Evolved: ${tier2EvolvedState}`)

          setCurrentSpikeType(spikeType)
          setHasEvolved(hasEvolvedState)
          setTier2Evolved(tier2EvolvedState)
          hasEvolvedRef.current = hasEvolvedState
          tier2EvolvedRef.current = tier2EvolvedState
        }

        // Show reconnection notification
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'WELCOME BACK! RESUMING YOUR GAME...',
          timestamp: Date.now(),
          opacity: 1,
        })

        // Hide notification after 3 seconds
        setTimeout(() => {
          setIsReconnected(false)
        }, 3000)
      }

      // Reset camera to local player position to avoid jitter/shaking on spawn/respawn
      const canvas = canvasRef.current
      if (canvas) {
        const localPlayer = data.players.find((p) => p.id === data.playerId)
        if (localPlayer) {
          // Center camera directly on the player at spawn/respawn (use viewport dimensions)
          cameraRef.current.x = localPlayer.x - window.innerWidth / 2
          cameraRef.current.y = localPlayer.y - window.innerHeight / 2

          // Add spawn particle effect only if not reconnecting
          if (!data.reconnected) {
            spawnEffectsRef.current.push({
              x: localPlayer.x,
              y: localPlayer.y,
              startTime: Date.now(),
              duration: 800
            })

            // Play spawn sound
            audioManager.playSFX('spawn')
          }
        }
      }

      // Initialize players map
      playersRef.current.clear()
      playerScoresRef.current.clear()
      data.players.forEach((player) => {
        playersRef.current.set(player.id, player)
        // Use server-provided score
        playerScoresRef.current.set(player.id, (player as any).score || 0)
      })

      // Initialize food from server
      foodRef.current = data.food || []

      // Initialize premium orbs from server
      premiumOrbsRef.current = data.premiumOrbs || []
    })

    socket.on('gameState', (data: { players: Player[]; premiumOrbs: PremiumOrb[] }) => {
      // Rebuild players and scores maps from the latest server snapshot
      const newPlayers = new Map<string, Player>()
      const newScores = new Map<string, number>()

      data.players.forEach((player) => {
        newPlayers.set(player.id, player)
        newScores.set(player.id, player.score || 0)
      })

      playersRef.current = newPlayers
      playerScoresRef.current = newScores

      // Keep premium orbs in sync with the server so fleeing movement is smooth,
      // but we still don't stream the 2400+ food orbs each tick for performance.
      premiumOrbsRef.current = data.premiumOrbs || premiumOrbsRef.current
    })

    socket.on('playerJoined', (player: Player) => {
      playersRef.current.set(player.id, player)
      playerScoresRef.current.set(player.id, (player as any).score || 0)
    })

    socket.on('playerLeft', (playerId: string) => {
      playersRef.current.delete(playerId)
      playerScoresRef.current.delete(playerId)
    })

    // Handle food collection events (used for score popups)
    socket.on('foodCollected', (data: { playerId: string; foodId: string; newFood: Food; newScore: number }) => {
      const prevScore = playerScoresRef.current.get(data.playerId) || 0
      const newScore = data.newScore

      // Update food array: remove old food and add new food
      foodRef.current = foodRef.current.filter(f => f.id !== data.foodId)
      foodRef.current.push(data.newFood)

      // Show +X popup for the local player when they gain score from food
      if (data.playerId === localPlayerIdRef.current && newScore > prevScore) {
        const scoreDiff = newScore - prevScore
        const player = playersRef.current.get(data.playerId)

        if (player && scoreDiff > 0) {
          // Position popup just above the username badge
          const playerScoreForSize = player.score || newScore || 0
          const sizeMultiplier = getSizeMultiplier(playerScoreForSize, player.evolutionScoreOffset || 0)
          const scaledSize = PLAYER_SIZE * sizeMultiplier
          const sizeScale = scaledSize / 30
          const badgeHeight = 22 * sizeScale
          const badgeOffset = 45 * sizeScale
          const badgeY = player.y - scaledSize - badgeOffset
          const nameCenterY = badgeY + badgeHeight / 2

          scorePopupsRef.current.push({
            id: `${Date.now()}-${Math.random()}`,
            x: player.x,
            y: nameCenterY - badgeHeight * 0.6,
            score: scoreDiff,
            startTime: Date.now(),
            duration: 1500,
            // Neon blue color for all +score popups
            color: '#00e5ff'
          })

          // Enhanced particle burst effect for food collection
          const particleCount = 8
          const foodColor = data.newFood.color || '#00e5ff'
          for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2
            const speed = 2 + Math.random() * 3
            collisionParticlesRef.current.push({
              x: player.x,
              y: player.y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              size: 2 + Math.random() * 2,
              color: foodColor,
              life: 20 + Math.random() * 15,
              maxLife: 35
            })
          }

          // Play eat food sound effect
          audioManager.playSFX('eatFood')
        }
      }

      // Update player score for tracking
      playerScoresRef.current.set(data.playerId, newScore)

      // Check if local player reached evolution threshold
      if (data.playerId === localPlayerIdRef.current) {
        const hasEvolvedNow = hasEvolvedRef.current
        const tier2EvolvedNow = tier2EvolvedRef.current

        // Tier 1 evolution
        if (!hasEvolvedNow && newScore >= EVOLUTION_THRESHOLD && prevScore < EVOLUTION_THRESHOLD) {
          setShowEvolutionTree(true)
        }
        // Tier 2 evolution
        if (hasEvolvedNow && !tier2EvolvedNow && newScore >= TIER_2_THRESHOLD && prevScore < TIER_2_THRESHOLD) {
          setShowEvolutionTree(true)
        }
      }
    })

    // Handle premium orb collection events
    socket.on('premiumOrbCollected', (data: { playerId: string; orbId: string; newOrb: PremiumOrb; newScore: number }) => {
      const prevScore = playerScoresRef.current.get(data.playerId) || 0
      const newScore = data.newScore

      // Update premium orbs array: remove old orb and add new orb
      premiumOrbsRef.current = premiumOrbsRef.current.filter(o => o.id !== data.orbId)
      premiumOrbsRef.current.push(data.newOrb)

      // Add notification and score popup if it's the local player
      if (data.playerId === localPlayerIdRef.current && newScore > prevScore) {
        const scoreDiff = newScore - prevScore
        const player = playersRef.current.get(data.playerId)

        if (player && scoreDiff > 0) {
          // Position popup just above the username badge (same as food popups)
          const playerScoreForSize = player.score || newScore || 0
          const sizeMultiplier = getSizeMultiplier(playerScoreForSize, player.evolutionScoreOffset || 0)
          const scaledSize = PLAYER_SIZE * sizeMultiplier
          const sizeScale = scaledSize / 30
          const badgeHeight = 22 * sizeScale
          const badgeOffset = 45 * sizeScale
          const badgeY = player.y - scaledSize - badgeOffset
          const nameCenterY = badgeY + badgeHeight / 2

          scorePopupsRef.current.push({
            id: `${Date.now()}-${Math.random()}`,
            x: player.x,
            y: nameCenterY - badgeHeight * 0.6,
            score: scoreDiff,
            startTime: Date.now(),
            duration: 1500,
            // Neon blue color for all +score popups
            color: '#00e5ff'
          })

          // Enhanced particle burst effect for premium orb collection (reduced for performance)
          const particleCount = 10
          const orbColor = '#dd00ff' // Premium orb neon purple/magenta
          for (let i = 0; i < particleCount; i++) {
            const angle = (i / particleCount) * Math.PI * 2
            const speed = 3 + Math.random() * 4
            collisionParticlesRef.current.push({
              x: player.x,
              y: player.y,
              vx: Math.cos(angle) * speed,
              vy: Math.sin(angle) * speed,
              size: 3 + Math.random() * 3,
              color: orbColor,
              life: 30 + Math.random() * 20,
              maxLife: 50
            })
          }
        }

        // Premium orb notification banner
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'PREMIUM ORB COLLECTED',
          timestamp: Date.now(),
          opacity: 1
        })

        // Play premium orb sound effect
        audioManager.playSFX('premiumOrb')
      }

      // Update player score for tracking
      playerScoresRef.current.set(data.playerId, newScore)

      // Check if local player reached evolution threshold
      if (data.playerId === localPlayerIdRef.current) {
        const hasEvolvedNow = hasEvolvedRef.current
        const tier2EvolvedNow = tier2EvolvedRef.current

        // Tier 1 evolution
        if (!hasEvolvedNow && newScore >= EVOLUTION_THRESHOLD && prevScore < EVOLUTION_THRESHOLD) {
          setShowEvolutionTree(true)
        }
        // Tier 2 evolution
        if (hasEvolvedNow && !tier2EvolvedNow && newScore >= TIER_2_THRESHOLD && prevScore < TIER_2_THRESHOLD) {
          setShowEvolutionTree(true)
        }
      }
    })

    // Handle successful speed boost usage (for cooldown UI)
    socket.on('speedBoostUsed', (data: { cooldownMs: number; usedAt: number }) => {
      setBoostOnCooldown(true)

      if (boostCooldownTimeoutRef.current !== null) {
        window.clearTimeout(boostCooldownTimeoutRef.current)
      }

      boostCooldownTimeoutRef.current = window.setTimeout(() => {
        setBoostOnCooldown(false)
        boostCooldownTimeoutRef.current = null
      }, data.cooldownMs)
    })

    // Handle successful ability usage (for cooldown UI)
    socket.on('abilityUsed', (data: { cooldownMs: number; usedAt: number; duration: number; abilityType: string }) => {
      setAbilityOnCooldown(true)

      // Play ability sound effect
      audioManager.playSFX('abilityUse')

      // Add ability particle effect
      const localPlayer = playersRef.current.get(localPlayerIdRef.current || '')
      if (localPlayer) {
        abilityEffectsRef.current.push({
          x: localPlayer.x,
          y: localPlayer.y,
          startTime: Date.now(),
          duration: 600,
          spikeType: currentSpikeType
        })
      }

      if (abilityCooldownTimeoutRef.current !== null) {
        window.clearTimeout(abilityCooldownTimeoutRef.current)
      }

      abilityCooldownTimeoutRef.current = window.setTimeout(() => {
        setAbilityOnCooldown(false)
        abilityCooldownTimeoutRef.current = null
      }, data.cooldownMs)
    })

    // Handle visual boost effect for all players
    socket.on('playerBoosted', (data: { playerId: string; x: number; y: number }) => {
      const player = playersRef.current.get(data.playerId)
      const x = player ? player.x : data.x
      const y = player ? player.y : data.y
      const now = Date.now()

      // Play boost sound effect (only for local player)
      if (data.playerId === localPlayerIdRef.current) {
        audioManager.playSFX('boost')
      }

      // Initial burst at the boost start point
      boostEffectsRef.current.push({
        x,
        y,
        startTime: now,
        duration: 700,
      })

      // Short-lived trail that will spawn segments along the movement path
      boostTrailsRef.current.push({
        playerId: data.playerId,
        startTime: now,
        duration: 500,
      })
    })

    // Receive chat messages from server
    socket.on('chatMessage', (msg: ChatMessage) => {
      setChatMessages(prev => {
        const next = [...prev, msg]
        return next.slice(-40)
      })

      // Play chat message sound effect
      audioManager.playSFX('chatMessage', 0.5)
    })

    // Handle speed boost errors (e.g., not moving, on cooldown)
    socket.on('speedBoostError', (data: { message: string }) => {
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: data.message,
        timestamp: Date.now(),
        opacity: 1,
      })
    })

    // Handle player collision events
    socket.on('playerCollision', (data: {
      player1Id: string;
      player2Id: string;
      player1Health: number;
      player2Health: number;
      player1HP: number;
      player2HP: number;
      damage1: number;
      damage2: number;
    }) => {
      // Get both players
      const player1 = playersRef.current.get(data.player1Id)
      const player2 = playersRef.current.get(data.player2Id)

      if (player1 && player2) {
        // Add collision effect at midpoint between players
        const midX = (player1.x + player2.x) / 2
        const midY = (player1.y + player2.y) / 2

        collisionEffectsRef.current.push({
          x: midX,
          y: midY,
          startTime: Date.now(),
          duration: 500, // 500ms effect
        })

        // Play collision sound effect (only for local player)
        if (localPlayerIdRef.current && (localPlayerIdRef.current === data.player1Id || localPlayerIdRef.current === data.player2Id)) {
          audioManager.playSFX('collision')
        }

        // Create collision particles (reduced for performance)
        const particleCount = 12
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2
          const speed = 2 + Math.random() * 4
          collisionParticlesRef.current.push({
            x: midX,
            y: midY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 2 + Math.random() * 3,
            color: `rgba(255, ${100 + Math.random() * 100}, ${100 + Math.random() * 100}, 1)`,
            life: 30 + Math.random() * 20,
            maxLife: 50
          })
        }

        // Damage feedback for local player (show loss for both players)
        const localId = localPlayerIdRef.current
        if (localId && (localId === data.player1Id || localId === data.player2Id)) {
          const pushDamagePopup = (
            targetPlayer: Player,
            rawDamageHP: number,
            hpAfter: number,
            healthAfterPercent: number
          ) => {
            if (!targetPlayer || rawDamageHP <= 0) return

            // Convert HP damage into approximate health% damage for more readable numbers
            let damagePercent = rawDamageHP
            if (hpAfter > 0 && healthAfterPercent > 0) {
              damagePercent = Math.round((rawDamageHP * healthAfterPercent) / hpAfter)
            }

            if (damagePercent <= 0) damagePercent = 1

            let severity: DamageSeverity = 'normal'
            if (damagePercent >= 55) {
              severity = 'extreme'
            } else if (damagePercent >= 35) {
              severity = 'critical'
            } else if (damagePercent >= 20) {
              severity = 'heavy'
            }

            const label = severity === 'normal'
              ? `-${damagePercent}`
              : `${severity.toUpperCase()} (-${damagePercent})`

            damagePopupsRef.current.push({
              id: `${Date.now()}-${Math.random()}`,
              x: targetPlayer.x,
              y: targetPlayer.y,
              text: label,
              severity,
              startTime: Date.now(),
              duration: severity === 'extreme' ? 1500 : 1200,
            })

            // If this is the local player taking damage, add screen shake and damage flash
            if (targetPlayer.id === localPlayerIdRef.current) {
              // Screen shake intensity based on damage severity
              let shakeIntensity = 5
              let shakeDuration = 200

              switch (severity) {
                case 'heavy':
                  shakeIntensity = 8
                  shakeDuration = 250
                  break
                case 'critical':
                  shakeIntensity = 12
                  shakeDuration = 300
                  break
                case 'extreme':
                  shakeIntensity = 16
                  shakeDuration = 400
                  break
              }

              screenShakeRef.current = {
                x: 0,
                y: 0,
                intensity: shakeIntensity,
                startTime: Date.now(),
                duration: shakeDuration
              }

              // Damage flash
              damageFlashRef.current = {
                active: true,
                startTime: Date.now(),
                duration: 200
              }
            }
          }

          // Damage taken by player1 and player2 (from the perspective of this collision)
          pushDamagePopup(player1, data.damage1, data.player1HP, data.player1Health)
          pushDamagePopup(player2, data.damage2, data.player2HP, data.player2Health)
        }
      }
    })

    // Handle player death events
    socket.on('playerDied', (data: {
      playerId: string;
      killedBy: string | null;
      assists: string[];
      stats: {
        timeSurvived: number;
        kills: number;
        foodEaten: number;
        premiumOrbsEaten: number;
        score: number;
      };
      killerScore: number;
    }) => {
      const localId = localPlayerIdRef.current
      const victim = playersRef.current.get(data.playerId)

      // If an AI entity died, create a green burst effect at its position
      if (victim && victim.isAI) {
        boostEffectsRef.current.push({
          x: victim.x,
          y: victim.y,
          startTime: Date.now(),
          duration: 800,
        })

        // Create green particles for AI death (reduced for performance)
        const particleCount = 18
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2
          const speed = 3 + Math.random() * 5
          collisionParticlesRef.current.push({
            x: victim.x,
            y: victim.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 3 + Math.random() * 4,
            color: '#00ff88', // Green color for AI
            life: 40 + Math.random() * 30,
            maxLife: 70
          })
        }
      }

      // If local player is the killer, show a kill popup at the victim position
      if (localId && data.killedBy === localId) {
        // Play kill sound effect
        audioManager.playSFX('killEnemy')

        if (victim) {
          damagePopupsRef.current.push({
            id: `${Date.now()}-${Math.random()}`,
            x: victim.x,
            y: victim.y,
            text: 'KILLED',
            severity: 'kill',
            startTime: Date.now(),
            duration: 1600,
          })
        }
      }

      // Check if it's the local player who died
      if (data.playerId === localPlayerIdRef.current) {
        // Play death sound effect
        audioManager.playSFX('death')

        // If authenticated, save premium orbs to account
        if (isAuthenticated && data.stats.premiumOrbsEaten > 0) {
          const token = localStorage.getItem('authToken')
          if (token) {
            fetch(`${selectedServerUrl}/api/game/add-orbs`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ orbs: data.stats.premiumOrbsEaten })
            })
            .then(res => res.json())
            .then(orbData => {
              console.log(`✅ Saved ${data.stats.premiumOrbsEaten} premium orbs. New balance: ${orbData.totalOrbs}`)
              setPremiumOrbs(orbData.totalOrbs)
              showAuthNotification(`+${data.stats.premiumOrbsEaten} Premium Orbs earned!`, 'success')
            })
            .catch(err => {
              console.error('❌ Error saving premium orbs:', err)
            })
          }
        }

        // Reset ability cooldown on death
        setAbilityOnCooldown(false)
        if (abilityCooldownTimeoutRef.current !== null) {
          window.clearTimeout(abilityCooldownTimeoutRef.current)
          abilityCooldownTimeoutRef.current = null
        }

        // Start death animation
        setDeathAnimationProgress(0)

        // Animate death over 1 second
        const startTime = Date.now()
        const animateDeath = () => {
          const elapsed = Date.now() - startTime
          const progress = Math.min(elapsed / 1000, 1) // 1 second animation

          setDeathAnimationProgress(progress)

          if (progress < 1) {
            requestAnimationFrame(animateDeath)
          } else {
            // Animation complete, show death screen
            setDeathStats({
              timeSurvived: data.stats.timeSurvived,
              kills: data.stats.kills,
              foodEaten: data.stats.foodEaten,
              premiumOrbsEaten: data.stats.premiumOrbsEaten,
              score: data.stats.score,
              killedBy: data.killedBy || undefined,
              assists: data.assists,
            })
            setGameState('dead')
          }
        }

        requestAnimationFrame(animateDeath)
      }
    })

    // Handle join errors (e.g., profanity in username)
    socket.on('joinError', (data: { message: string }) => {
      console.log('Join error:', data.message)

      // Immediately return player to menu and show a sleek notification
      // instead of a blocking modal. This keeps the experience fast and
      // consistent with other in-game messaging.
      setGameState('menu')
      setShowDisconnectScreen(false)

      // Clear out any in-game state that depends on an active player
      localPlayerIdRef.current = null
      playersRef.current.clear()
      playerScoresRef.current.clear()

      // Disconnect the socket so a fresh connection will be created on next Play
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }

      // Show the actual server message instead of hardcoded text
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: data.message.toUpperCase(),
        timestamp: Date.now(),
        opacity: 1,
      })
    })

    // Handle chat errors (e.g., timeout)
    socket.on('chatError', (data: { message: string }) => {
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: data.message.toUpperCase(),
        timestamp: Date.now(),
        opacity: 1,
      })
    })

    // Handle AFK activation started
    socket.on('afkActivationStarted', () => {
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: 'STAY STILL FOR 10 SECONDS TO GO AFK...',
        timestamp: Date.now(),
        opacity: 1,
      })
    })

    // Handle AFK activation cancelled
    socket.on('afkActivationCancelled', (data: { reason: string }) => {
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: `AFK CANCELLED: ${data.reason.toUpperCase()}`,
        timestamp: Date.now(),
        opacity: 1,
      })
    })

    // Handle AFK status changed
    socket.on('afkStatusChanged', (data: { isAFK: boolean }) => {
      setIsAFK(data.isAFK)

      if (data.isAFK) {
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'YOU ARE NOW AFK. PRESS O TO RESUME.',
          timestamp: Date.now(),
          opacity: 1,
        })
      } else {
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'AFK MODE DISABLED',
          timestamp: Date.now(),
          opacity: 1,
        })
      }
    })

    // Handle AFK error (e.g., not in base)
    socket.on('afkError', (data: { message: string }) => {
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: data.message.toUpperCase(),
        timestamp: Date.now(),
        opacity: 1,
      })
    })

    socket.on('disconnect', (reason) => {
      console.log('Disconnected from server. Reason:', reason)
      // Show disconnect screen if we're in playing or connecting state
      // This prevents showing it when user intentionally goes to menu
      if (gameState === 'playing' || gameState === 'connecting') {
        setShowDisconnectScreen(true)

        // If we were in connecting state, move to playing so the disconnect screen shows properly
        if (gameState === 'connecting') {
          setGameState('playing')
        }
      }
    })

  }, [gameState, displayName])

  // Send input to server (mouse position for cursor-based movement)
  useEffect(() => {
    if (gameState !== 'playing' || !socketRef.current) return

    const sendInput = () => {
      const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null

      // Don't send input if player hasn't started moving yet, is dying, or evolution tree is open
      if (!hasStartedMoving || localPlayer?.isDying || showEvolutionTree) {
        // Send current position as target (no movement)
        socketRef.current?.emit('input', {
          mouseX: localPlayer?.x || 0,
          mouseY: localPlayer?.y || 0
        })
        return
      }

      // Send mouse position in world coordinates
      const input = {
        mouseX: mousePositionRef.current.x,
        mouseY: mousePositionRef.current.y,
      }

      socketRef.current?.emit('input', input)
    }

    const inputInterval = setInterval(sendInput, 1000 / 60) // 60 times per second

    return () => {
      clearInterval(inputInterval)
    }
  }, [gameState, showEvolutionTree, hasStartedMoving])

  // Rendering loop for playing state
  useEffect(() => {
    console.log('Render effect triggered, gameState:', gameState)

    if (gameState !== 'playing') return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Cancel any existing animation frame to prevent conflicts
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    // Animation/rendering loop
    const render = () => {
      // Get viewport dimensions (CSS size, not canvas internal resolution)
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // Clear canvas (use full internal resolution)
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Cache current time for performance (avoid repeated Date.now() calls)
      const currentTime = Date.now() / 1000

      // Get local player for camera
      const localPlayer = localPlayerIdRef.current
        ? playersRef.current.get(localPlayerIdRef.current)
        : null

      // Calculate target camera position (center on local player)
      let targetCameraX = 0
      let targetCameraY = 0

      if (localPlayer) {
        // Always center camera on local player (no edge clamping)
        // Use viewport dimensions for camera calculations
        targetCameraX = localPlayer.x - viewportWidth / 2
        targetCameraY = localPlayer.y - viewportHeight / 2
      }

      // Adaptive camera interpolation (lerp) - faster during high-speed movement to reduce blur
      // Calculate camera distance to target to determine movement speed
      const cameraDeltaX = targetCameraX - cameraRef.current.x
      const cameraDeltaY = targetCameraY - cameraRef.current.y
      const cameraDistance = Math.sqrt(cameraDeltaX * cameraDeltaX + cameraDeltaY * cameraDeltaY)

      // Adaptive lerp: higher factor when moving fast (reduces blur), lower when slow (smoother)
      // Distance < 50: 0.2 (smooth), Distance 50-200: 0.2-0.4, Distance > 200: 0.5 (fast, no blur)
      let lerpFactor = 0.2 // Base lerp factor
      if (cameraDistance > 200) {
        lerpFactor = 0.5 // Fast movement - high responsiveness to prevent blur
      } else if (cameraDistance > 50) {
        lerpFactor = 0.2 + ((cameraDistance - 50) / 150) * 0.3 // Interpolate between 0.2 and 0.5
      }

      cameraRef.current.x += cameraDeltaX * lerpFactor
      cameraRef.current.y += cameraDeltaY * lerpFactor

      let cameraX = cameraRef.current.x
      let cameraY = cameraRef.current.y

      // Update screen shake
      const currentTimeMs = Date.now()
      if (screenShakeRef.current.intensity > 0) {
        const elapsed = currentTimeMs - screenShakeRef.current.startTime
        if (elapsed < screenShakeRef.current.duration) {
          const progress = elapsed / screenShakeRef.current.duration
          const intensity = screenShakeRef.current.intensity * (1 - progress)
          screenShakeRef.current.x = (Math.random() - 0.5) * intensity * 2
          screenShakeRef.current.y = (Math.random() - 0.5) * intensity * 2
          cameraX += screenShakeRef.current.x
          cameraY += screenShakeRef.current.y
        } else {
          screenShakeRef.current.intensity = 0
          screenShakeRef.current.x = 0
          screenShakeRef.current.y = 0
        }
      }

      // Update camera zoom based on player size
      if (localPlayer) {
        const baseScoreForSize = localPlayer.score || 0
        const evolutionOffset = localPlayer.evolutionScoreOffset || 0
        const sizeMultiplier = getSizeMultiplier(baseScoreForSize, evolutionOffset)
        // Zoom out slightly as player grows (1.0 at size 1x, 0.85 at size 2x, 0.75 at size 3x)
        const targetZoom = Math.max(0.7, 1.0 - (sizeMultiplier - 1) * 0.15)
        cameraZoomRef.current += (targetZoom - cameraZoomRef.current) * 0.05
      }

      // Apply camera transform with zoom
      ctx.save()

      // Apply zoom from center of screen (use viewport dimensions)
      const centerX = viewportWidth / 2
      const centerY = viewportHeight / 2
      ctx.translate(centerX, centerY)
      ctx.scale(cameraZoomRef.current, cameraZoomRef.current)
      ctx.translate(-centerX, -centerY)

      ctx.translate(-cameraX, -cameraY)

      // ═══════════════════════════════════════════════════════════════
      // COSMIC BACKGROUND - Animated Starfield with Parallax & Nebulae
      // ═══════════════════════════════════════════════════════════════

      ctx.save()

      // Deep space background gradient
      const bgGradient = ctx.createRadialGradient(
        mapConfigRef.current.width / 2,
        mapConfigRef.current.height / 2,
        0,
        mapConfigRef.current.width / 2,
        mapConfigRef.current.height / 2,
        mapConfigRef.current.width * 0.8
      )
      bgGradient.addColorStop(0, '#0a0015') // Deep purple center
      bgGradient.addColorStop(0.5, '#050010') // Darker purple
      bgGradient.addColorStop(1, '#000005') // Almost black edges
      ctx.fillStyle = bgGradient
      ctx.fillRect(0, 0, mapConfigRef.current.width, mapConfigRef.current.height)

      // Animated nebula clouds (parallax layer 1 - slowest) - REDUCED COUNT
      const nebulaTime = currentTime * 0.1
      const nebulaParallaxX = cameraX * 0.1
      const nebulaParallaxY = cameraY * 0.1

      // Draw fewer nebula clouds for performance
      const nebulae = [
        { x: 2000, y: 1500, color: '#ff00ff', size: 1200, alpha: 0.05 }, // Magenta - reduced alpha
        { x: 5000, y: 3000, color: '#00ffff', size: 1500, alpha: 0.04 }, // Cyan - reduced alpha
        { x: 3500, y: 4000, color: '#8800ff', size: 1300, alpha: 0.04 }, // Purple - reduced alpha
      ]

      nebulae.forEach((nebula, index) => {
        const pulsePhase = nebulaTime + index * 2
        const pulse = Math.sin(pulsePhase) * 0.3 + 1
        const nebulaSize = nebula.size * pulse

        const gradient = ctx.createRadialGradient(
          nebula.x - nebulaParallaxX,
          nebula.y - nebulaParallaxY,
          0,
          nebula.x - nebulaParallaxX,
          nebula.y - nebulaParallaxY,
          nebulaSize
        )
        gradient.addColorStop(0, nebula.color + Math.floor(nebula.alpha * 255).toString(16).padStart(2, '0'))
        gradient.addColorStop(0.5, nebula.color + '08')
        gradient.addColorStop(1, nebula.color + '00')

        ctx.fillStyle = gradient
        ctx.fillRect(
          nebula.x - nebulaParallaxX - nebulaSize,
          nebula.y - nebulaParallaxY - nebulaSize,
          nebulaSize * 2,
          nebulaSize * 2
        )
      })

      // Distant stars (parallax layer 2 - slow) - REDUCED COUNT
      const distantStarParallaxX = cameraX * 0.2
      const distantStarParallaxY = cameraY * 0.2

      // Generate fewer distant stars for performance
      for (let i = 0; i < 80; i++) {
        const starX = (i * 547 % mapConfigRef.current.width) - distantStarParallaxX
        const starY = (i * 739 % mapConfigRef.current.height) - distantStarParallaxY
        const starSize = (i % 3) * 0.5 + 0.5
        const twinkle = Math.sin(currentTime * 2 + i) * 0.3 + 0.7

        ctx.fillStyle = `rgba(200, 220, 255, ${twinkle * 0.4})`
        ctx.beginPath()
        ctx.arc(starX, starY, starSize, 0, Math.PI * 2)
        ctx.fill()
      }

      // Medium stars (parallax layer 3 - medium speed) - REDUCED COUNT & BLUR
      const mediumStarParallaxX = cameraX * 0.4
      const mediumStarParallaxY = cameraY * 0.4

      for (let i = 0; i < 100; i++) {
        const starX = (i * 641 % mapConfigRef.current.width) - mediumStarParallaxX
        const starY = (i * 853 % mapConfigRef.current.height) - mediumStarParallaxY
        const starSize = (i % 4) * 0.3 + 0.8
        const twinkle = Math.sin(currentTime * 3 + i * 0.5) * 0.4 + 0.6

        // Colored stars
        const colors = ['#ffffff', '#ffccff', '#ccffff', '#ffffcc', '#ffcccc']
        const color = colors[i % colors.length]

        ctx.fillStyle = color
        ctx.globalAlpha = twinkle * 0.5
        // No shadow blur for performance
        ctx.beginPath()
        ctx.arc(starX, starY, starSize, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      // Close stars (parallax layer 4 - fast, moves with camera) - REDUCED COUNT & BLUR
      const closeStarParallaxX = cameraX * 0.7
      const closeStarParallaxY = cameraY * 0.7

      for (let i = 0; i < 50; i++) {
        const starX = (i * 751 % mapConfigRef.current.width) - closeStarParallaxX
        const starY = (i * 967 % mapConfigRef.current.height) - closeStarParallaxY
        const starSize = (i % 5) * 0.4 + 1.2
        const twinkle = Math.sin(currentTime * 4 + i * 0.3) * 0.5 + 0.5

        // Bright colored stars with minimal glow
        const colors = ['#ff00ff', '#00ffff', '#ffff00', '#ff0088', '#00ff88']
        const color = colors[i % colors.length]

        ctx.fillStyle = color
        ctx.globalAlpha = twinkle * 0.7
        ctx.shadowColor = color
        ctx.shadowBlur = 3 // Reduced from 6
        ctx.beginPath()
        ctx.arc(starX, starY, starSize, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.globalAlpha = 1
      }

      // Cosmic dust particles (floating across screen) - REDUCED COUNT
      const dustParallaxX = cameraX * 0.5
      const dustParallaxY = cameraY * 0.5

      for (let i = 0; i < 40; i++) {
        const dustX = (i * 883 % mapConfigRef.current.width) - dustParallaxX + Math.sin(currentTime + i) * 20
        const dustY = (i * 1021 % mapConfigRef.current.height) - dustParallaxY + Math.cos(currentTime * 0.5 + i) * 15
        const dustSize = (i % 3) * 0.5 + 0.3
        const dustAlpha = Math.sin(currentTime * 2 + i) * 0.1 + 0.1

        ctx.fillStyle = `rgba(150, 200, 255, ${dustAlpha})`
        ctx.beginPath()
        ctx.arc(dustX, dustY, dustSize, 0, Math.PI * 2)
        ctx.fill()
      }

      ctx.restore()

      // Draw cosmic energy grid (holographic overlay) - OPTIMIZED
      const gridSize = 100
      const startX = Math.floor(cameraX / gridSize) * gridSize
      const startY = Math.floor(cameraY / gridSize) * gridSize
      const endX = Math.min(mapConfigRef.current.width, cameraX + viewportWidth)
      const endY = Math.min(mapConfigRef.current.height, cameraY + viewportHeight)

      ctx.save()
      ctx.lineWidth = 0.5

      // Animated holographic grid lines
      const gridPulse = Math.sin(currentTime * 2) * 0.02 + 0.03

      // Vertical energy lines - NO SHADOW BLUR for performance
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, Math.max(0, cameraY))
        ctx.lineTo(x, Math.min(mapConfigRef.current.height, cameraY + viewportHeight))
        ctx.strokeStyle = `rgba(0, 255, 255, ${gridPulse})`
        ctx.stroke()
      }

      // Horizontal energy lines - NO SHADOW BLUR for performance
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(Math.max(0, cameraX), y)
        ctx.lineTo(Math.min(mapConfigRef.current.width, cameraX + viewportWidth), y)
        ctx.strokeStyle = `rgba(255, 0, 255, ${gridPulse})`
        ctx.stroke()
      }

      ctx.shadowBlur = 0
      ctx.restore()

      // Draw map borders - cosmic energy barrier
      ctx.save()
      ctx.lineWidth = 4
      const borderPulse = Math.sin(currentTime * 3) * 0.3 + 0.7

      // Create animated gradient for border
      const borderGradient = ctx.createLinearGradient(0, 0, mapConfigRef.current.width, mapConfigRef.current.height)
      borderGradient.addColorStop(0, `rgba(0, 255, 255, ${borderPulse})`)
      borderGradient.addColorStop(0.25, `rgba(255, 0, 255, ${borderPulse})`)
      borderGradient.addColorStop(0.5, `rgba(255, 255, 0, ${borderPulse})`)
      borderGradient.addColorStop(0.75, `rgba(255, 0, 255, ${borderPulse})`)
      borderGradient.addColorStop(1, `rgba(0, 255, 255, ${borderPulse})`)

      ctx.strokeStyle = borderGradient
      ctx.shadowColor = 'rgba(0, 255, 255, 0.8)'
      ctx.shadowBlur = 25
      ctx.strokeRect(
        0.5,
        0.5,
        mapConfigRef.current.width - 1,
        mapConfigRef.current.height - 1
      )
      ctx.restore()

      // Draw team bases in world space so everyone can see base locations
      const teamBases = mapConfigRef.current.teamBases
      if (teamBases && teamBases.length > 0) {
        teamBases.forEach((base) => {
          ctx.save()

          const borderRadius = 26

          // Soft filled area in team color
          ctx.globalAlpha = 0.14
          ctx.fillStyle = base.color
          drawRoundedRect(ctx, base.x, base.y, base.width, base.height, borderRadius)
          ctx.fill()

          // Outer neutral border for clarity
          ctx.globalAlpha = 1
          ctx.lineWidth = 3
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)'
          drawRoundedRect(ctx, base.x, base.y, base.width, base.height, borderRadius)
          ctx.stroke()

          // Inner neon team-colored border
          ctx.lineWidth = 2
          ctx.strokeStyle = base.color
          drawRoundedRect(
            ctx,
            base.x + 6,
            base.y + 6,
            base.width - 12,
            base.height - 12,
            borderRadius - 6
          )
          ctx.stroke()

          ctx.restore()
        })
      }

      // Draw all food orbs (pass currentTime for optimized animations)
      foodRef.current.forEach((food) => {
        drawFood(ctx, food, currentTime)
      })

      // Draw all premium orbs (pass currentTime for optimized animations)
      premiumOrbsRef.current.forEach((orb) => {
        drawPremiumOrb(ctx, orb, currentTime)
      })

      // Eating animation is now handled server-side

      // Update and clean up notifications
      const now = Date.now()
      notificationsRef.current = notificationsRef.current.filter(notification => {
        return (now - notification.timestamp) < 3000 // Remove after 3 seconds
      })

      // Update active boost trails (spawn streak segments along movement path)
      boostTrailsRef.current = boostTrailsRef.current.filter((trail) => {
        if (now - trail.startTime > trail.duration) {
          return false
        }

        const trailPlayer = playersRef.current.get(trail.playerId)
        if (!trailPlayer) {
          return false
        }

        boostEffectsRef.current.push({
          x: trailPlayer.x,
          y: trailPlayer.y,
          startTime: now,
          duration: 450,
        })

        return true
      })


      // Collision detection and food/orb management is now handled server-side
      // Client only receives updates via socket events

      // COSMIC TRAILS REMOVED FOR PERFORMANCE

      // Draw all players in two passes: bodies first, then names
      // First pass: Draw all player bodies (without usernames)
      playersRef.current.forEach((player) => {
        // Use eating animation from server
        let eatingProgress = 0
        if (player.isEating) {
          // Create a smooth open-close cycle using sine wave
          // 0 -> 1 -> 0 (mouth opens then closes)
          eatingProgress = Math.sin(player.eatingProgress * Math.PI)
        }

        // Calculate size for ability effects (needed for some abilities)
        const baseScoreForSize = player.isAI ? 500 : (player.score || 0)
        const evolutionOffset = player.isAI ? 0 : (player.evolutionScoreOffset || 0)
        const sizeMultiplier = getSizeMultiplier(baseScoreForSize, evolutionOffset)
        const scaledSize = PLAYER_SIZE * sizeMultiplier

        // Ghost mode makes player semi-transparent (applies to Thorn and its ghost variants)
        const ghostModeSpikes: SpikeType[] = ['Thorn', 'ThornWraith', 'ThornShade']
        const opacity = (player.abilityActive && ghostModeSpikes.includes(player.spikeType as SpikeType)) ? 0.4 : 1

        // Get spike customization effect ID
        const spikeEffectId = (player as any).activeSpike || 'spike_default'

        // Draw spike chain (handles both single spike and multi-segment chains)
        drawSpikeChain(
          ctx,
          player,
          eatingProgress,
          true, // Skip username in first pass (draw in second pass)
          opacity,
          spikeEffectId
        )

        // BristleStrider: Draw damage trail
        if (player.damageTrail && player.damageTrail.length > 0 && player.abilityActive && player.spikeType === 'BristleStrider') {
          ctx.save()
          player.damageTrail.forEach((trailPos: any) => {
            const age = now - trailPos.timestamp
            const opacity = Math.max(0, 1 - age / 500) // Fade out over 500ms
            const radius = trailPos.radius || scaledSize * 0.8

            // Cyan trail glow
            const gradient = ctx.createRadialGradient(trailPos.x, trailPos.y, 0, trailPos.x, trailPos.y, radius)
            gradient.addColorStop(0, `rgba(0, 255, 255, ${opacity * 0.6})`)
            gradient.addColorStop(0.5, `rgba(0, 200, 255, ${opacity * 0.3})`)
            gradient.addColorStop(1, `rgba(0, 150, 255, 0)`)

            ctx.fillStyle = gradient
            ctx.beginPath()
            ctx.arc(trailPos.x, trailPos.y, radius, 0, Math.PI * 2)
            ctx.fill()
          })
          ctx.restore()
        }

        // StarflareNova: Draw explosion at old position
        if (player.novaExplosionX && player.novaExplosionY && player.novaExplosionTime) {
          const timeUntilExplosion = player.novaExplosionTime - now
          if (timeUntilExplosion > 0) {
            // Draw warning indicator
            ctx.save()
            const warningPulse = 0.5 + Math.sin(now * 0.02) * 0.5
            const warningRadius = 200 * (1 - timeUntilExplosion / 700)

            ctx.beginPath()
            ctx.arc(player.novaExplosionX, player.novaExplosionY, warningRadius, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(255, 200, 0, ${warningPulse * 0.8})`
            ctx.lineWidth = 4
            ctx.stroke()

            ctx.beginPath()
            ctx.arc(player.novaExplosionX, player.novaExplosionY, warningRadius * 0.5, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(255, 150, 0, ${warningPulse * 0.6})`
            ctx.lineWidth = 2
            ctx.stroke()
            ctx.restore()
          }
        }

        // StarflarePulsar: Draw shockwave
        if (player.shockwaveX && player.shockwaveY && player.shockwaveTime) {
          const shockwaveAge = now - player.shockwaveTime
          if (shockwaveAge < 500) {
            ctx.save()
            const progress = shockwaveAge / 500
            const shockwaveRadius = 150 * progress
            const opacity = 1 - progress

            ctx.beginPath()
            ctx.arc(player.shockwaveX, player.shockwaveY, shockwaveRadius, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(255, 230, 100, ${opacity * 0.9})`
            ctx.lineWidth = 8
            ctx.stroke()

            ctx.beginPath()
            ctx.arc(player.shockwaveX, player.shockwaveY, shockwaveRadius * 0.7, 0, Math.PI * 2)
            ctx.strokeStyle = `rgba(255, 200, 50, ${opacity * 0.7})`
            ctx.lineWidth = 5
            ctx.stroke()
            ctx.restore()
          }
        }

        // PrickleSwarm: Draw Spine Storm aura
        if (player.spineStormActive && player.abilityActive && player.spikeType === 'PrickleSwarm') {
          ctx.save()
          const stormPulse = Math.sin(now * 0.015) * 0.3 + 0.7
          const stormRadius = scaledSize * 2.5

          // Pulsing damage aura
          ctx.beginPath()
          ctx.arc(player.x, player.y, stormRadius, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255, 100, 0, ${stormPulse * 0.5})`
          ctx.lineWidth = 6
          ctx.stroke()

          // Inner storm ring
          ctx.beginPath()
          ctx.arc(player.x, player.y, stormRadius * 0.7, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(255, 150, 50, ${stormPulse * 0.7})`
          ctx.lineWidth = 4
          ctx.stroke()

          // Rotating spikes
          ctx.translate(player.x, player.y)
          ctx.rotate(now * 0.005)
          for (let i = 0; i < 12; i++) {
            const angle = (i / 12) * Math.PI * 2
            const x1 = Math.cos(angle) * stormRadius * 0.8
            const y1 = Math.sin(angle) * stormRadius * 0.8
            const x2 = Math.cos(angle) * stormRadius
            const y2 = Math.sin(angle) * stormRadius

            ctx.beginPath()
            ctx.moveTo(x1, y1)
            ctx.lineTo(x2, y2)
            ctx.strokeStyle = `rgba(255, 120, 0, ${stormPulse * 0.6})`
            ctx.lineWidth = 3
            ctx.stroke()
          }
          ctx.restore()
        }

        // Draw ability visual effects
        if (player.abilityActive && player.spikeType) {
          ctx.save()

          switch (player.spikeType) {
            case 'Prickle':
            case 'PrickleVanguard':
            case 'PrickleSwarm':
            case 'PrickleBastion': // Super Density line - pulsing orange shield
              const densityPulse = 0.7 + Math.sin(Date.now() * 0.008) * 0.3

              // Outer shield layer
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.5, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 140, 0, ${densityPulse * 0.6})`
              ctx.lineWidth = 6
              ctx.stroke()

              // Middle shield layer
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.35, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 170, 0, ${densityPulse * 0.8})`
              ctx.lineWidth = 4
              ctx.stroke()

              // Inner glow
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.2, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 200, 100, ${densityPulse * 0.5})`
              ctx.lineWidth = 2
              ctx.stroke()
              break

            case 'Thorn':
            case 'ThornWraith':
            case 'ThornReaper':
            case 'ThornShade': // Ghost / execution line - ethereal glow
              // Pulsing ghostly aura
              const ghostPulse = 0.5 + Math.sin(Date.now() * 0.005) * 0.3
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.5, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(150, 200, 255, ${ghostPulse * 0.6})`
              ctx.lineWidth = 6
              ctx.stroke()

              // Inner glow
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.2, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(200, 220, 255, ${ghostPulse * 0.4})`
              ctx.lineWidth = 3
              ctx.stroke()
              break

            case 'Bristle':
            case 'BristleBlitz':
            case 'BristleStrider':
            case 'BristleSkirmisher': // Speed line - intense speed aura
              // Pulsing speed rings
              const speedPulse = Date.now() * 0.01
              for (let ring = 0; ring < 3; ring++) {
                const ringOffset = (speedPulse + ring * 0.5) % 1.5
                const ringRadius = scaledSize * (1.2 + ringOffset * 0.8)
                const ringOpacity = Math.max(0, 1 - ringOffset / 1.5)

                ctx.beginPath()
                ctx.arc(player.x, player.y, ringRadius, 0, Math.PI * 2)
                ctx.strokeStyle = `rgba(0, 255, 255, ${ringOpacity * 0.6})`
                ctx.lineWidth = 4
                ctx.stroke()
              }

              // Speed streaks
              for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2
                const length = scaledSize * 1.8
                const startX = player.x + Math.cos(angle) * scaledSize * 0.8
                const startY = player.y + Math.sin(angle) * scaledSize * 0.8
                const endX = startX + Math.cos(angle) * length
                const endY = startY + Math.sin(angle) * length

                const grad = ctx.createLinearGradient(startX, startY, endX, endY)
                grad.addColorStop(0, 'rgba(0, 255, 255, 0.8)')
                grad.addColorStop(1, 'rgba(0, 255, 255, 0)')

                ctx.strokeStyle = grad
                ctx.lineWidth = 2
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(startX, startY)
                ctx.lineTo(endX, endY)
                ctx.stroke()
              }
              break

            case 'Bulwark':
            case 'BulwarkAegis':
            case 'BulwarkCitadel':
            case 'BulwarkJuggernaut': // Invincibility / fortress line - radiant golden shield
              const invincPulse = 0.8 + Math.sin(Date.now() * 0.01) * 0.2

              // Outer radiant layer
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.7, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 215, 0, ${invincPulse * 0.7})`
              ctx.lineWidth = 8
              ctx.stroke()

              // Middle golden layer
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.5, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 230, 50, ${invincPulse * 0.9})`
              ctx.lineWidth = 5
              ctx.stroke()

              // Inner bright glow
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.3, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 255, 150, ${invincPulse * 0.6})`
              ctx.lineWidth = 3
              ctx.stroke()

              // Rotating hexagon shield pattern
              ctx.save()
              ctx.translate(player.x, player.y)
              ctx.rotate(Date.now() * 0.002)
              ctx.beginPath()
              for (let i = 0; i < 6; i++) {
                const angle = (i / 6) * Math.PI * 2
                const x = Math.cos(angle) * scaledSize * 1.6
                const y = Math.sin(angle) * scaledSize * 1.6
                if (i === 0) ctx.moveTo(x, y)
                else ctx.lineTo(x, y)
              }
              ctx.closePath()
              ctx.strokeStyle = `rgba(255, 215, 0, ${invincPulse * 0.5})`
              ctx.lineWidth = 3
              ctx.stroke()
              ctx.restore()
              break

            case 'Starflare':
            case 'StarflarePulsar':
            case 'StarflareHorizon':
            case 'StarflareNova': // Teleportation / nova line - cosmic energy
              const starTime = Date.now() * 0.005

              // Orbiting star particles
              for (let orbit = 0; orbit < 2; orbit++) {
                const orbitRadius = scaledSize * (1.4 + orbit * 0.4)
                const particleCount = 8 + orbit * 4
                for (let i = 0; i < particleCount; i++) {
                  const angle = (i / particleCount) * Math.PI * 2 + starTime * (orbit % 2 === 0 ? 1 : -1)
                  const x = player.x + Math.cos(angle) * orbitRadius
                  const y = player.y + Math.sin(angle) * orbitRadius

                  // Star glow
                  const starGrad = ctx.createRadialGradient(x, y, 0, x, y, 6)
                  starGrad.addColorStop(0, 'rgba(255, 230, 100, 0.9)')
                  starGrad.addColorStop(1, 'rgba(255, 200, 50, 0)')
                  ctx.fillStyle = starGrad
                  ctx.beginPath()
                  ctx.arc(x, y, 6, 0, Math.PI * 2)
                  ctx.fill()

                  // Star core
                  ctx.fillStyle = 'rgba(255, 255, 200, 1)'
                  ctx.beginPath()
                  ctx.arc(x, y, 2, 0, Math.PI * 2)
                  ctx.fill()
                }
              }

              // Central cosmic glow
              const cosmicGrad = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, scaledSize * 1.8)
              cosmicGrad.addColorStop(0, 'rgba(255, 230, 150, 0.3)')
              cosmicGrad.addColorStop(0.5, 'rgba(200, 150, 255, 0.2)')
              cosmicGrad.addColorStop(1, 'rgba(100, 100, 255, 0)')
              ctx.fillStyle = cosmicGrad
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.8, 0, Math.PI * 2)
              ctx.fill()
              break

            case 'Mauler':
            case 'MaulerRavager':
            case 'MaulerBulwark':
            case 'MaulerApex': // Fortress / apex line - aggressive red barrier
              const fortressPulse = 0.6 + Math.sin(Date.now() * 0.012) * 0.4

              // Outer aggressive barrier
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.8, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 50, 50, ${fortressPulse * 0.8})`
              ctx.lineWidth = 8
              ctx.stroke()

              // Middle fortress layer
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.6, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(220, 30, 30, ${fortressPulse * 0.9})`
              ctx.lineWidth = 6
              ctx.stroke()

              // Inner danger zone
              ctx.beginPath()
              ctx.arc(player.x, player.y, scaledSize * 1.4, 0, Math.PI * 2)
              ctx.strokeStyle = `rgba(255, 100, 100, ${fortressPulse * 0.6})`
              ctx.lineWidth = 4
              ctx.stroke()

              // Rotating danger spikes
              ctx.save()
              ctx.translate(player.x, player.y)
              ctx.rotate(Date.now() * 0.003)
              for (let i = 0; i < 8; i++) {
                const angle = (i / 8) * Math.PI * 2
                const innerR = scaledSize * 1.5
                const outerR = scaledSize * 1.9

                ctx.beginPath()
                ctx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR)
                ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR)
                ctx.strokeStyle = `rgba(255, 80, 80, ${fortressPulse * 0.7})`
                ctx.lineWidth = 3
                ctx.stroke()
              }
              ctx.restore()
              break
          }

          ctx.restore()
        }
      })

      // Second pass: Draw all player usernames on top
      playersRef.current.forEach((player) => {
        // Use segment size if available (resets every 500 points), otherwise use continuous size
        let scaledSize: number
        if (player.segments && player.segments.length > 0) {
          // Use head segment size (resets every 500 points when new segment spawns)
          scaledSize = player.segments[0].size
        } else {
          // Fallback to continuous size calculation
          const baseScoreForSize = player.isAI ? 500 : (player.score || 0)
          const evolutionOffset = player.isAI ? 0 : (player.evolutionScoreOffset || 0)
          const sizeMultiplier = getSizeMultiplier(baseScoreForSize, evolutionOffset)
          scaledSize = PLAYER_SIZE * sizeMultiplier
        }

        const deathProgress = player.deathProgress || 0

        // Only draw the username badge for living/dying players (fade out on death)
        if (player.username && deathProgress < 1) {
          ctx.save()

          // Fade username badge out as the spike dies
          const overlayAlpha = deathProgress > 0 ? 1 - deathProgress : 1
          ctx.globalAlpha = overlayAlpha

          // Scale badge elements based on spike size (base size = 30)
          const sizeScale = scaledSize / 30
          const fontSize = Math.max(10, 12 * sizeScale)
          const badgePadding = 8 * sizeScale
          const badgeHeight = 22 * sizeScale
          const badgeRadius = 11 * sizeScale
          const badgeOffset = 45 * sizeScale

          // Measure text for badge sizing. Use the full display name (including
          // AFK prefix) so the badge width always matches the rendered text.
          const displayNameForMeasure = player.isAFK ? `[AFK] ${player.username}` : player.username
          ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
          const textMetrics = ctx.measureText(displayNameForMeasure)
          const textWidth = textMetrics.width

          // Badge dimensions
          const badgeWidth = textWidth + badgePadding * 2
          const badgeY = player.y - scaledSize - badgeOffset
          const badgeX = player.x - badgeWidth / 2

          // Get nametag customization
          const nametagId = (player as any).activeNametag || 'nametag_default'
          const nametagCustomization = getNametagById(nametagId)
          const nametagStyle = nametagCustomization?.style || {
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: '#ffffff',
            border: 'none',
            textShadow: '0 0 5px rgba(0, 0, 0, 0.8)',
            fontWeight: 'bold'
          }

          // Parse background color from style
          const bgColor = nametagStyle.backgroundColor || player.color

          // Draw badge background with customization style
          drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius)
          ctx.fillStyle = bgColor

          // Apply box shadow if present
          if (nametagStyle.boxShadow) {
            // Parse box shadow (simplified - just use glow effect)
            const glowColor = nametagStyle.color || player.color
            ctx.shadowColor = glowColor
            ctx.shadowBlur = 15
          } else {
            ctx.shadowColor = player.color
            ctx.shadowBlur = 15
          }

          ctx.fill()
          ctx.shadowBlur = 0

          // Draw badge border with customization style
          if (nametagStyle.border && nametagStyle.border !== 'none') {
            // Parse border (simplified - extract color)
            const borderMatch = nametagStyle.border.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/)
            const borderColor = borderMatch ? borderMatch[0] : 'rgba(255, 255, 255, 0.3)'
            ctx.strokeStyle = borderColor
            ctx.lineWidth = 2
            ctx.stroke()
          } else {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
            ctx.lineWidth = 1.5
            ctx.stroke()
          }

          // Draw username text with customization style
          ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          // Add AFK indicator if player is AFK
          const displayName = player.isAFK ? `[AFK] ${player.username}` : player.username

          // Text outline
          ctx.lineJoin = 'round'
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
          ctx.lineWidth = 3 * sizeScale
          ctx.strokeText(displayName, player.x, badgeY + badgeHeight / 2)

          // Text fill with customization color
          const textColor = player.isAFK ? '#ffaa00' : (nametagStyle.color || '#ffffff')
          ctx.fillStyle = textColor

          // Apply text shadow from customization
          if (nametagStyle.textShadow) {
            // Parse text shadow (simplified - just use glow effect)
            ctx.shadowColor = textColor
            ctx.shadowBlur = 8
          } else {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
            ctx.shadowBlur = 4
          }

          ctx.fillText(displayName, player.x, badgeY + badgeHeight / 2)
          ctx.shadowBlur = 0

          ctx.restore()
        }
      })

      // Draw collision and boost effects in world space (before ctx.restore())
      if (localPlayer) {
        drawCollisionEffects(ctx, collisionEffectsRef.current)
        drawBoostEffects(ctx, boostEffectsRef.current)
        drawEvolutionEffects(ctx, evolutionEffectsRef.current)
        drawCollisionParticles(ctx, collisionParticlesRef.current)
        drawSpawnEffects(ctx, spawnEffectsRef.current)
        drawAbilityEffects(ctx, abilityEffectsRef.current)
        drawScorePopups(ctx, scorePopupsRef.current)
        drawDamagePopups(ctx, damagePopupsRef.current)
      }

      ctx.restore()

      // Draw damage flash vignette overlay in screen space
      if (damageFlashRef.current.active) {
        const elapsed = currentTimeMs - damageFlashRef.current.startTime
        if (elapsed < damageFlashRef.current.duration) {
          const progress = elapsed / damageFlashRef.current.duration
          const vignetteStrength = (1 - progress) * 0.5 // Max 50% opacity, fades out

          // Create radial gradient vignette (transparent center, red edges)
          // Use viewport dimensions for screen-space effects
          const gradient = ctx.createRadialGradient(
            viewportWidth / 2,
            viewportHeight / 2,
            0,
            viewportWidth / 2,
            viewportHeight / 2,
            Math.max(viewportWidth, viewportHeight) * 0.7
          )
          gradient.addColorStop(0, 'rgba(255, 0, 0, 0)') // Transparent center
          gradient.addColorStop(1, `rgba(255, 0, 0, ${vignetteStrength})`) // Red edges

          ctx.fillStyle = gradient
          ctx.fillRect(0, 0, viewportWidth, viewportHeight)
        } else {
          damageFlashRef.current.active = false
        }
      }

      // Draw status bars (HP and Score) in screen space
      const currentScore = localPlayer ? (localPlayer.score || 0) : 0
      const currentHealth = localPlayer ? (localPlayer.health || 100) : 100
      drawStatusBars(ctx, currentHealth, currentScore, viewportWidth, viewportHeight)

      // Draw leaderboard in screen space
      drawLeaderboard(ctx, playersRef.current, localPlayerIdRef.current, viewportWidth)

      // Draw minimap in screen space
      if (localPlayer) {
        drawMinimap(
          ctx,
          localPlayer.x,
          localPlayer.y,
          mapConfigRef.current.width,
          mapConfigRef.current.height,
          viewportWidth,
          viewportHeight,
          localPlayer.color,
          mapConfigRef.current.teamBases,
          localPlayer.teamId,
          playersRef.current,
          localPlayerIdRef.current,
        )
      }

      // Draw notifications in screen space
      drawNotifications(ctx, notificationsRef.current, viewportWidth)

      // Draw red vignette if local player is angry
      if (localPlayer && localPlayer.isAngry && localPlayer.angryProgress) {
        const vignetteStrength = localPlayer.angryProgress * 0.4 // Max 40% opacity
        const gradient = ctx.createRadialGradient(
          viewportWidth / 2,
          viewportHeight / 2,
          0,
          viewportWidth / 2,
          viewportHeight / 2,
          Math.max(viewportWidth, viewportHeight) * 0.7
        )
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0)')
        gradient.addColorStop(1, `rgba(255, 0, 0, ${vignetteStrength})`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, viewportWidth, viewportHeight)
      }

      // Draw death animation overlay
      if (deathAnimationProgress > 0 && deathAnimationProgress < 1) {
        // Fade to black with red tint
        const fadeOpacity = deathAnimationProgress * 0.9
        ctx.fillStyle = `rgba(20, 0, 0, ${fadeOpacity})`
        ctx.fillRect(0, 0, viewportWidth, viewportHeight)

        // Shrinking circle effect (vision closing in)
        const maxRadius = Math.max(viewportWidth, viewportHeight) * 0.8
        const currentRadius = maxRadius * (1 - deathAnimationProgress)

        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        const circleGradient = ctx.createRadialGradient(
          viewportWidth / 2,
          viewportHeight / 2,
          currentRadius * 0.5,
          viewportWidth / 2,
          viewportHeight / 2,
          currentRadius
        )
        circleGradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
        circleGradient.addColorStop(1, 'rgba(0, 0, 0, 1)')
        ctx.fillStyle = circleGradient
        ctx.fillRect(0, 0, viewportWidth, viewportHeight)
        ctx.restore()
      }



      animationFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
  }, [gameState, deathAnimationProgress])

  const handlePlay = () => {
    // Play UI click sound
    audioManager.playSFX('uiClick')

    // Haptic feedback
    hapticManager.trigger('medium')

    // Start background music
    audioManager.startMusic()

    // If tutorial is open, close it when starting the game
    setShowHowToPlay(false)
    setTutorialStep(0)

    // Select a random loading tip
    const randomTip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)]
    setLoadingTip(randomTip)

    // Add fade-out class to menu
    const menuContent = document.querySelector('.content')
    if (menuContent) {
      menuContent.classList.add('fade-out')
    }

    // Immediately move into connecting state.
    // We no longer auto-force `playing` on a timer; instead we wait for
    // the server to send `init` before considering the game "live".
    setGameState('connecting')
  }

  const handleRespawn = () => {
    // Play UI click sound
    audioManager.playSFX('uiClick')

    // Haptic feedback
    hapticManager.trigger('medium')

    // Play spawn sound
    audioManager.playSFX('spawn')

    // Reset death state
    setDeathStats(null)
    setDeathAnimationProgress(0)

    // Reset evolution state
    setHasEvolved(false)
    setTier2Evolved(false)
    hasEvolvedRef.current = false
    tier2EvolvedRef.current = false
    setShowEvolutionTree(false)
    setCurrentSpikeType('Spike')

    // Reset ability cooldown state
    setAbilityOnCooldown(false)
    if (abilityCooldownTimeoutRef.current !== null) {
      window.clearTimeout(abilityCooldownTimeoutRef.current)
      abilityCooldownTimeoutRef.current = null
    }

    // Request respawn from server
    if (socketRef.current) {
      socketRef.current.emit('respawn', displayName)
      setGameState('playing')
    }
  }

  const handleGoHome = () => {
    // Play UI click sound
    audioManager.playSFX('uiClick')

    // Haptic feedback
    hapticManager.trigger('light')

    // DON'T disconnect the socket - just leave the game
    // The socket will remain connected so the user stays authenticated
    // and can rejoin without reconnecting
    if (socketRef.current) {
      // Emit a 'leaveGame' event to tell server we're going to menu
      socketRef.current.emit('leaveGame')
    }

    // Reset state
    setDeathStats(null)
    setDeathAnimationProgress(0)
    playersRef.current.clear()
    localPlayerIdRef.current = null

    // Clear chat messages when returning to menu
    setChatMessages([])

    // Go to menu
    setGameState('menu')
  }

  // Authentication handlers
  const showAuthNotification = (message: string, type: 'success' | 'error') => {
    setAuthNotification({ message, type })
    setTimeout(() => setAuthNotification(null), 3000)
  }

  const handleSignUp = async (username: string, password: string, confirmPassword: string) => {
    try {
      // Validation
      if (!username || !password || !confirmPassword) {
        showAuthNotification('Please fill in all fields', 'error')
        return
      }

      if (password !== confirmPassword) {
        showAuthNotification('Passwords don\'t match!', 'error')
        return
      }

      if (username.length < 3 || username.length > 20) {
        showAuthNotification('Username must be 3-20 characters', 'error')
        return
      }

      if (!/^[a-zA-Z0-9]+$/.test(username)) {
        showAuthNotification('Username must be alphanumeric only', 'error')
        return
      }

      if (password.length < 6) {
        showAuthNotification('Password must be at least 6 characters', 'error')
        return
      }

      // Call API
      const response = await fetch(`${selectedServerUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, confirmPassword })
      })

      const data = await response.json()

      if (!response.ok) {
        showAuthNotification(data.error || 'Registration failed', 'error')
        return
      }

      // Success
      showAuthNotification(data.message || 'Success! Account created.', 'success')

      // Store token
      localStorage.setItem('authToken', data.token)

      // Set user state
      setIsAuthenticated(true)
      setCurrentUser(data.user)

      // Close modal
      setShowSignUp(false)

      // Auto-login after 1 second
      setTimeout(() => {
        setDisplayName(data.user.username)
      }, 1000)
    } catch (error) {
      console.error('Sign up error:', error)
      showAuthNotification('Server error. Please try again.', 'error')
    }
  }

  const handleLogin = async (username: string, password: string) => {
    try {
      // Validation
      if (!username || !password) {
        showAuthNotification('Please fill in all fields', 'error')
        return
      }

      // Call API
      const response = await fetch(`${selectedServerUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await response.json()

      if (!response.ok) {
        showAuthNotification(data.error || 'Login failed', 'error')
        return
      }

      // Success
      showAuthNotification(data.message || 'Login successful!', 'success')

      // Store token
      localStorage.setItem('authToken', data.token)

      // Set user state
      setIsAuthenticated(true)
      setCurrentUser(data.user)

      // Close modal
      setShowLogin(false)

      // Set display name
      setDisplayName(data.user.username)
    } catch (error) {
      console.error('Login error:', error)
      showAuthNotification('Server error. Please try again.', 'error')
    }
  }

  const handleLogout = () => {
    // Clear token
    localStorage.removeItem('authToken')

    // Clear user state
    setIsAuthenticated(false)
    setCurrentUser(null)

    // Disconnect socket
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }

    // Reset game state
    setGameState('menu')
    setDisplayName('')

    // Close modals
    setShowLogoutConfirm(false)

    // Show notification
    showAuthNotification('Logged out successfully', 'success')
  }

  // Bug report handler
  const handleBugReport = async () => {
    // Validate description
    if (bugDescription.trim().length < 10) {
      showAuthNotification('Bug description must be at least 10 characters', 'error')
      return
    }

    try {
      const bugReport = {
        description: bugDescription.trim(),
        steps: bugSteps.trim(),
        expected: bugExpected.trim(),
        username: currentUser?.username || 'Guest',
        userAgent: navigator.userAgent,
        url: window.location.href,
      }

      const response = await fetch(`${selectedServerUrl}/api/bugs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bugReport),
      })

      if (response.ok) {
        showAuthNotification('Bug report submitted successfully! Thank you!', 'success')
        // Reset form
        setBugDescription('')
        setBugSteps('')
        setBugExpected('')
        setShowBugReport(false)
      } else {
        showAuthNotification('Failed to submit bug report. Please try again.', 'error')
      }
    } catch (error) {
      console.error('Bug report error:', error)
      showAuthNotification('Failed to submit bug report. Please try again.', 'error')
    }
  }

  // Customization handlers
  const fetchCustomizationsData = async () => {
    try {
      const token = localStorage.getItem('authToken')
      if (!token) return

      // Fetch available customizations
      const availableRes = await fetch(`${selectedServerUrl}/api/customizations/available`)
      const availableData = await availableRes.json()
      setAvailableCustomizations(availableData)

      // Fetch owned customizations
      const ownedRes = await fetch(`${selectedServerUrl}/api/customizations/owned`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      const ownedData = await ownedRes.json()

      setPremiumOrbs(ownedData.premiumOrbs || 0)
      setOwnedCustomizations(ownedData.ownedCustomizations || [])

      // Set active customizations from server or localStorage or defaults
      const serverNametag = ownedData.activeNametag
      const serverSpike = ownedData.activeSpike
      const localNametag = localStorage.getItem('activeNametag')
      const localSpike = localStorage.getItem('activeSpike')

      const finalNametag = serverNametag || localNametag || 'nametag_default'
      const finalSpike = serverSpike || localSpike || 'spike_default'

      setActiveNametag(finalNametag)
      setActiveSpike(finalSpike)

      // Save to localStorage
      localStorage.setItem('activeNametag', finalNametag)
      localStorage.setItem('activeSpike', finalSpike)

      // If server doesn't have defaults set, equip them
      if (!serverNametag && finalNametag === 'nametag_default') {
        handleEquipCustomization('nametag_default', 'nametag')
      }
      if (!serverSpike && finalSpike === 'spike_default') {
        handleEquipCustomization('spike_default', 'spike')
      }
    } catch (error) {
      console.error('Error fetching customizations:', error)
    }
  }

  const handlePurchaseCustomization = async (customizationId: string) => {
    try {
      const token = localStorage.getItem('authToken')
      if (!token) return

      const response = await fetch(`${selectedServerUrl}/api/customizations/purchase`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ customizationId })
      })

      const data = await response.json()

      if (!response.ok) {
        showAuthNotification(data.error || 'Purchase failed', 'error')
        return
      }

      showAuthNotification('Customization purchased!', 'success')
      setPremiumOrbs(data.premiumOrbs)
      setOwnedCustomizations(prev => [...prev, customizationId])
    } catch (error) {
      console.error('Error purchasing customization:', error)
      showAuthNotification('Server error. Please try again.', 'error')
    }
  }

  const handleEquipCustomization = async (customizationId: string, type: 'nametag' | 'spike') => {
    try {
      const token = localStorage.getItem('authToken')
      if (!token) return

      const response = await fetch(`${selectedServerUrl}/api/customizations/equip`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ customizationId })
      })

      const data = await response.json()

      if (!response.ok) {
        showAuthNotification(data.error || 'Equip failed', 'error')
        return
      }

      showAuthNotification('Customization equipped!', 'success')

      if (type === 'nametag') {
        setActiveNametag(customizationId)
        localStorage.setItem('activeNametag', customizationId)
      } else {
        setActiveSpike(customizationId)
        localStorage.setItem('activeSpike', customizationId)
      }
    } catch (error) {
      console.error('Error equipping customization:', error)
      showAuthNotification('Server error. Please try again.', 'error')
    }
  }

  // Fetch customizations when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      fetchCustomizationsData()
    }
  }, [isAuthenticated])

  // Load saved server selection on mount
  useEffect(() => {
    const savedServer = localStorage.getItem('selectedServer')
    if (savedServer) {
      setSelectedServerUrl(savedServer)
    }
  }, [])

  // Check for existing auth token on mount
  useEffect(() => {
    const token = localStorage.getItem('authToken')
    if (token) {
      console.log('🔐 Found auth token, verifying...')
      // Verify token with server
      fetch(`${selectedServerUrl}/api/auth/verify`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (!res.ok) {
            throw new Error('Token verification failed')
          }
          return res.json()
        })
        .then(data => {
          if (data.user) {
            console.log('✅ Auto-login successful:', data.user.username)
            setIsAuthenticated(true)
            setCurrentUser(data.user)
            setDisplayName(data.user.username)
            showAuthNotification(`Welcome back, ${data.user.username}!`, 'success')
          } else {
            console.log('❌ Invalid token data')
            localStorage.removeItem('authToken')
          }
        })
        .catch((error) => {
          console.log('❌ Token verification error:', error)
          localStorage.removeItem('authToken')
        })
    } else {
      console.log('ℹ️ No auth token found')
    }
  }, [])

  const triggerSpeedBoost = () => {
    if (gameState !== 'playing') return
    if (!socketRef.current) return
    socketRef.current.emit('speedBoost')
  }

  const handleSpeedBoostClick = () => {
    hapticManager.trigger('medium')
    triggerSpeedBoost()
  }

  const triggerAbility = () => {
    if (gameState !== 'playing') return
    if (!socketRef.current) return

    const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
    if (!localPlayer || !localPlayer.spikeType || localPlayer.spikeType === 'Spike') return

    // Check if ability is on cooldown
    if (abilityOnCooldown) {
      // Show notification
      const abilityDisplay = getAbilityDisplayConfig(currentSpikeType)
      notificationsRef.current.push({
        id: Math.random().toString(36).substring(2, 11),
        message: `${abilityDisplay.label.toUpperCase()} ON COOLDOWN`,
        timestamp: Date.now(),
        opacity: 1,
      })
      return
    }

    // Speed abilities (Bristle line) can only be used while moving
    const speedAbilitySpikes: SpikeType[] = ['Bristle', 'BristleBlitz', 'BristleStrider', 'BristleSkirmisher']
    if (speedAbilitySpikes.includes(currentSpikeType)) {
      // Check if player has velocity (is actually moving)
      const vx = localPlayer.vx || 0
      const vy = localPlayer.vy || 0
      const speed = Math.sqrt(vx * vx + vy * vy)
      const isMoving = speed > 0.5 // Small threshold to account for deceleration

      if (!isMoving) {
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'MUST BE MOVING TO USE SPEED ABILITY',
          timestamp: Date.now(),
          opacity: 1,
        })
        return
      }
    }

    socketRef.current.emit('useAbility')
  }

  const handleAbilityClick = () => {
    hapticManager.trigger('heavy')
    triggerAbility()
  }

  const sendChatMessage = () => {
    const trimmed = chatInput.trim()
    if (!trimmed || !socketRef.current) return

    socketRef.current.emit('chatMessage', trimmed)
    setChatInput('')

    if (chatInputRef.current) {
      chatInputRef.current.blur()
    }
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  // Auto-scroll chat log to bottom on new messages
  useEffect(() => {
    if (!chatLogRef.current) return
    chatLogRef.current.scrollTop = chatLogRef.current.scrollHeight
  }, [chatMessages, isChatOpen])

  const killerPlayer = deathStats?.killedBy
    ? playersRef.current.get(deathStats.killedBy)
    : undefined

  const causeOfDeath = (() => {
    if (!deathStats) return ''
    if (!deathStats.killedBy) {
      return 'Destroyed by base defenses'
    }
    if (killerPlayer) {
      if (killerPlayer.isAI) {
        return 'Killed by AI HUNTER'
      }
      return `Killed by ${killerPlayer.username}`
    }


    return 'Killed by another spike'
  })()

  const causeOfDeathColor = (() => {
    if (!deathStats) return '#ffffff'
    if (!deathStats.killedBy) {
      return '#ff8080'
    }
    if (killerPlayer?.isAI) {
      return '#00ff88'
    }
    return killerPlayer?.color || '#ffffff'
  })()

  const deathAssistNames =
    deathStats?.assists
      ?.map((id) => playersRef.current.get(id))
      .filter((p): p is Player => Boolean(p))
      .map((p) => p.username) ?? []

  const hasAssists = deathAssistNames.length > 0





  return (
    <div className={`app ${isTouchDevice ? 'is-touch' : 'is-desktop'}`}>
      <div className={`grid-background ${gameState === 'playing' ? 'hidden' : ''}`} />
      <canvas ref={canvasRef} className={`game-canvas ${gameState === 'playing' ? 'playing' : ''}`} />

      {isTouchDevice && isPortrait && (
        <div className="orientation-lock-overlay">
          <div className="orientation-lock-card">
            <div className="orientation-lock-icon">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="7" y="4" width="10" height="16" rx="2" ry="2" />
                <path d="M2 12h2" />
                <path d="M20 12h2" />
                <path d="M12 2v2" />
                <path d="M12 20v2" />
              </svg>
            </div>
            <h2>Rotate your device</h2>
            <p>For the best experience, play burrs.io in landscape on mobile or tablet.</p>
          </div>
        </div>
      )}

      {/* Press P to start notification */}
      {gameState === 'playing' && !hasStartedMoving && (
        <div className="press-p-notification">
          Press P to start playing
        </div>
      )}

      {/* Touch cursor indicator for mobile */}
      {gameState === 'playing' && isTouchDevice && touchCursorRef.current && joystickActive && (
        <div
          className="touch-cursor-indicator"
          style={{
            left: `${touchCursorRef.current.x}px`,
            top: `${touchCursorRef.current.y}px`,
          }}
        />
      )}

      {/* Mobile joystick for cursor control */}
      {gameState === 'playing' && isTouchDevice && (
        <div
          className="mobile-joystick"
          onTouchStart={(e) => {
            e.preventDefault()

            // Start playing on first touch
            if (!hasStartedMoving) {
              setHasStartedMoving(true)
            }

            const rect = e.currentTarget.getBoundingClientRect()
            const centerX = rect.left + rect.width / 2
            const centerY = rect.top + rect.height / 2

            joystickBaseRef.current = { x: centerX, y: centerY }
            setJoystickActive(true)
          }}
          onTouchMove={(e) => {
            e.preventDefault()
            if (!joystickActive || !joystickBaseRef.current) return

            const touch = e.touches[0]
            const dx = touch.clientX - joystickBaseRef.current.x
            const dy = touch.clientY - joystickBaseRef.current.y

            // Limit joystick movement to base radius (60px)
            const maxRadius = 35
            const distance = Math.sqrt(dx * dx + dy * dy)
            const clampedDistance = Math.min(distance, maxRadius)

            // Normalize direction
            const angle = Math.atan2(dy, dx)
            const normalizedX = Math.cos(angle)
            const normalizedY = Math.sin(angle)

            // Update joystick vector (normalized direction)
            joystickVectorRef.current = {
              x: normalizedX,
              y: normalizedY
            }

            // Update stick visual position
            const stickX = normalizedX * clampedDistance
            const stickY = normalizedY * clampedDistance

            const stick = e.currentTarget.querySelector('.joystick-stick') as HTMLElement
            if (stick) {
              stick.style.transform = `translate(calc(-50% + ${stickX}px), calc(-50% + ${stickY}px))`
            }
          }}
          onTouchEnd={(e) => {
            e.preventDefault()
            setJoystickActive(false)
            joystickBaseRef.current = null
            joystickVectorRef.current = { x: 0, y: 0 }
            touchCursorRef.current = null

            // Reset stick position
            const stick = e.currentTarget.querySelector('.joystick-stick') as HTMLElement
            if (stick) {
              stick.style.transform = 'translate(-50%, -50%)'
            }
          }}
        >
          <div className="joystick-base" />
          <div className={`joystick-stick ${joystickActive ? 'active' : ''}`} />
        </div>
      )}


      {gameState === 'playing' && (
        <button
          className={`speed-boost-button ${boostOnCooldown ? 'cooldown' : ''}`}
          onClick={handleSpeedBoostClick}
          aria-label="Speed boost (B)"
        >
          {boostOnCooldown && <span className="speed-boost-fill-bar" />}
          <svg className="speed-boost-icon" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="speedBoostGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00ffff" />
                <stop offset="100%" stopColor="#00d4ff" />
              </linearGradient>
            </defs>
            <path
              d="M10 2 L5 13 H10 L8 22 L19 9 H13 L16 2 Z"
              fill="url(#speedBoostGradient)"
              stroke="#ffffff"
              strokeWidth="1.2"
            />
          </svg>
          <span className="speed-boost-label">Boost</span>
          <span className="speed-boost-key">B</span>
        </button>
      )}

      {/* Fullscreen button for mobile */}
      {gameState === 'playing' && isTouchDevice && (
        <button
          className="fullscreen-button"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          <svg className="fullscreen-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {isFullscreen ? (
              // Exit fullscreen icon
              <>
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </>
            ) : (
              // Enter fullscreen icon
              <>
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </>
            )}
          </svg>
        </button>
      )}

      {gameState === 'playing' && hasEvolved && (() => {
        const abilityDisplay = getAbilityDisplayConfig(currentSpikeType)
        const abilityConfig = EVOLUTION_OPTIONS.find(opt => opt.type === currentSpikeType)

        return (
          <button
            className={`ability-button ${abilityOnCooldown ? 'cooldown' : ''}`}
            onClick={handleAbilityClick}
            aria-label={`${abilityDisplay.name} (N)`}
            style={{
              '--ability-cooldown': abilityConfig ? `${abilityConfig.abilityCooldown}ms` : '20s'
            } as React.CSSProperties}
          >
            {abilityOnCooldown && <span className="ability-fill-bar" />}
            <svg className="ability-icon" viewBox="0 0 24 24">
              <defs>
                <linearGradient id="abilityGradient" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffaa00" />
                  <stop offset="100%" stopColor="#ff6600" />
                </linearGradient>
              </defs>
              <path
                d="M12 2 L15 9 L22 10 L17 15 L18 22 L12 18 L6 22 L7 15 L2 10 L9 9 Z"
                fill="url(#abilityGradient)"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            </svg>
            <span className="ability-label">{abilityDisplay.label}</span>
            <span className="ability-key">N</span>
          </button>
        )
      })()}

      {gameState === 'playing' && (
        <>
          <button
            className="ingame-audio-settings-button"
            onClick={() => {
              audioManager.playSFX('uiClick')
              setShowAudioSettings(true)
            }}
            aria-label="Audio Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
            </svg>
          </button>
          <button
            className="ingame-settings-button"
            onClick={() => {
              audioManager.playSFX('uiClick')
              setShowSettings(true)
            }}
            aria-label="Settings"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"></path>
            </svg>
          </button>
        </>
      )}

      {/* Progress Info Containers (above chat) */}
      {gameState === 'playing' && (
        <>
          {/* Spike Name Container */}
          <div className="progress-info-container spike-name-container">
            <span className="progress-label">Spike Name:</span>
            <span className="progress-value">{progressInfo.spikeType}</span>
          </div>

          {/* Progress Container */}
          <div className="progress-info-container progress-container">
            {progressInfo.evolutionText && (
              <div className="progress-item">
                <span className="progress-text">{progressInfo.evolutionText}</span>
              </div>
            )}
            <div className="progress-item">
              <span className="progress-text">{progressInfo.scoreUntilSegment} score until Spike spawns in chain</span>
            </div>
          </div>
        </>
      )}

      {gameState === 'playing' && isChatOpen && (
        <div className="chat-panel">
          <div className="chat-header">
            <span className="chat-title">Chat</span>
            <button
              type="button"
              className="chat-collapse-button"
              onClick={() => setIsChatOpen(false)}
              aria-label="Hide chat"
            >
              ✕
            </button>
          </div>
          <div className="chat-log" ref={chatLogRef}>
            {chatMessages.map((msg) => (
              <div
                key={msg.id}
                className="chat-message"
                style={{
                  backgroundColor: msg.isSystem ? 'rgba(255, 215, 0, 0.1)' : 'transparent',
                  borderLeft: msg.isSystem ? '3px solid #ffd700' : 'none',
                  paddingLeft: msg.isSystem ? '8px' : '0',
                }}
              >
                <span
                  className="chat-username"
                  style={{
                    color: msg.isSystem ? '#ffd700' : (
                      msg.teamColor ||
                      playersRef.current.get(msg.playerId)?.color ||
                      '#ffffff'
                    ),
                    fontWeight: msg.isSystem ? 'bold' : 'normal',
                  }}
                >
                  {msg.username}
                </span>
                <span className="chat-text">{msg.text}</span>
              </div>
            ))}
          </div>
          <div className="chat-input-row">
            <input
              ref={chatInputRef}
              className="chat-input"
              type="text"
              placeholder="Type a message..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  sendChatMessage()
                }
              }}
            />
            <button
              type="button"
              className="chat-send-button"
              onClick={(e) => {
                e.preventDefault()
                sendChatMessage()
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {gameState === 'playing' && !isChatOpen && (
        <button
          type="button"
          className="chat-toggle-button closed"
          onClick={() => setIsChatOpen(true)}
          aria-label="Show chat"
        >
          Chat
        </button>
      )}



      {gameState === 'menu' && (
        <div className="content">
          {/* Authentication buttons in top-right corner */}
          {!isAuthenticated ? (
            <div className="auth-buttons">
              <button
                className="auth-button signup-button"
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowSignUp(true)
                }}
              >
                Sign Up
              </button>
              <button
                className="auth-button login-button"
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowLogin(true)
                }}
              >
                Login
              </button>
            </div>
          ) : (
            <div className="auth-welcome">
              <div className="premium-orbs-display">
                <svg className="orbs-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="url(#diamondGradient)"/>
                  <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <defs>
                    <linearGradient id="diamondGradient" x1="2" y1="2" x2="22" y2="12">
                      <stop offset="0%" stopColor="#00ffff" />
                      <stop offset="100%" stopColor="#00d4ff" />
                    </linearGradient>
                  </defs>
                </svg>
                <span className="orbs-count">{premiumOrbs}</span>
              </div>
              <button
                className="customizations-button"
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowCustomizations(true)
                }}
                title="Customizations Shop"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M6 2L3 6V20C3 20.5304 3.21071 21.0391 3.58579 21.4142C3.96086 21.7893 4.46957 22 5 22H19C19.5304 22 20.0391 21.7893 20.4142 21.4142C20.7893 21.0391 21 20.5304 21 20V6L18 2H6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 6H21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M16 10C16 11.0609 15.5786 12.0783 14.8284 12.8284C14.0783 13.5786 13.0609 14 12 14C10.9391 14 9.92172 13.5786 9.17157 12.8284C8.42143 12.0783 8 11.0609 8 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span>Shop</span>
              </button>
              <span className="welcome-text">Welcome, {currentUser?.username}!</span>
              <button
                className="auth-settings-button"
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowAuthSettings(true)
                }}
                title="Settings"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 15C13.6569 15 15 13.6569 15 12C15 10.3431 13.6569 9 12 9C10.3431 9 9 10.3431 9 12C9 13.6569 10.3431 15 12 15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M19.4 15C19.2669 15.3016 19.2272 15.6362 19.286 15.9606C19.3448 16.285 19.4995 16.5843 19.73 16.82L19.79 16.88C19.976 17.0657 20.1235 17.2863 20.2241 17.5291C20.3248 17.7719 20.3766 18.0322 20.3766 18.295C20.3766 18.5578 20.3248 18.8181 20.2241 19.0609C20.1235 19.3037 19.976 19.5243 19.79 19.71C19.6043 19.896 19.3837 20.0435 19.1409 20.1441C18.8981 20.2448 18.6378 20.2966 18.375 20.2966C18.1122 20.2966 17.8519 20.2448 17.6091 20.1441C17.3663 20.0435 17.1457 19.896 16.96 19.71L16.9 19.65C16.6643 19.4195 16.365 19.2648 16.0406 19.206C15.7162 19.1472 15.3816 19.1869 15.08 19.32C14.7842 19.4468 14.532 19.6572 14.3543 19.9255C14.1766 20.1938 14.0813 20.5082 14.08 20.83V21C14.08 21.5304 13.8693 22.0391 13.4942 22.4142C13.1191 22.7893 12.6104 23 12.08 23C11.5496 23 11.0409 22.7893 10.6658 22.4142C10.2907 22.0391 10.08 21.5304 10.08 21V20.91C10.0723 20.579 9.96512 20.258 9.77251 19.9887C9.5799 19.7194 9.31074 19.5143 9 19.4C8.69838 19.2669 8.36381 19.2272 8.03941 19.286C7.71502 19.3448 7.41568 19.4995 7.18 19.73L7.12 19.79C6.93425 19.976 6.71368 20.1235 6.47088 20.2241C6.22808 20.3248 5.96783 20.3766 5.705 20.3766C5.44217 20.3766 5.18192 20.3248 4.93912 20.2241C4.69632 20.1235 4.47575 19.976 4.29 19.79C4.10405 19.6043 3.95653 19.3837 3.85588 19.1409C3.75523 18.8981 3.70343 18.6378 3.70343 18.375C3.70343 18.1122 3.75523 17.8519 3.85588 17.6091C3.95653 17.3663 4.10405 17.1457 4.29 16.96L4.35 16.9C4.58054 16.6643 4.73519 16.365 4.794 16.0406C4.85282 15.7162 4.81312 15.3816 4.68 15.08C4.55324 14.7842 4.34276 14.532 4.07447 14.3543C3.80618 14.1766 3.49179 14.0813 3.17 14.08H3C2.46957 14.08 1.96086 13.8693 1.58579 13.4942C1.21071 13.1191 1 12.6104 1 12.08C1 11.5496 1.21071 11.0409 1.58579 10.6658C1.96086 10.2907 2.46957 10.08 3 10.08H3.09C3.42099 10.0723 3.742 9.96512 4.0113 9.77251C4.28059 9.5799 4.48572 9.31074 4.6 9C4.73312 8.69838 4.77282 8.36381 4.714 8.03941C4.65519 7.71502 4.50054 7.41568 4.27 7.18L4.21 7.12C4.02405 6.93425 3.87653 6.71368 3.77588 6.47088C3.67523 6.22808 3.62343 5.96783 3.62343 5.705C3.62343 5.44217 3.67523 5.18192 3.77588 4.93912C3.87653 4.69632 4.02405 4.47575 4.21 4.29C4.39575 4.10405 4.61632 3.95653 4.85912 3.85588C5.10192 3.75523 5.36217 3.70343 5.625 3.70343C5.88783 3.70343 6.14808 3.75523 6.39088 3.85588C6.63368 3.95653 6.85425 4.10405 7.04 4.29L7.1 4.35C7.33568 4.58054 7.63502 4.73519 7.95941 4.794C8.28381 4.85282 8.61838 4.81312 8.92 4.68H9C9.29577 4.55324 9.54802 4.34276 9.72569 4.07447C9.90337 3.80618 9.99872 3.49179 10 3.17V3C10 2.46957 10.2107 1.96086 10.5858 1.58579C10.9609 1.21071 11.4696 1 12 1C12.5304 1 13.0391 1.21071 13.4142 1.58579C13.7893 1.96086 14 2.46957 14 3V3.09C14.0013 3.41179 14.0966 3.72618 14.2743 3.99447C14.452 4.26276 14.7042 4.47324 15 4.6C15.3016 4.73312 15.6362 4.77282 15.9606 4.714C16.285 4.65519 16.5843 4.50054 16.82 4.27L16.88 4.21C17.0657 4.02405 17.2863 3.87653 17.5291 3.77588C17.7719 3.67523 18.0322 3.62343 18.295 3.62343C18.5578 3.62343 18.8181 3.67523 19.0609 3.77588C19.3037 3.87653 19.5243 4.02405 19.71 4.21C19.896 4.39575 20.0435 4.61632 20.1441 4.85912C20.2448 5.10192 20.2966 5.36217 20.2966 5.625C20.2966 5.88783 20.2448 6.14808 20.1441 6.39088C20.0435 6.63368 19.896 6.85425 19.71 7.04L19.65 7.1C19.4195 7.33568 19.2648 7.63502 19.206 7.95941C19.1472 8.28381 19.1869 8.61838 19.32 8.92V9C19.4468 9.29577 19.6572 9.54802 19.9255 9.72569C20.1938 9.90337 20.5082 9.99872 20.83 10H21C21.5304 10 22.0391 10.2107 22.4142 10.5858C22.7893 10.9609 23 11.4696 23 12C23 12.5304 22.7893 13.0391 22.4142 13.4142C22.0391 13.7893 21.5304 14 21 14H20.91C20.5882 14.0013 20.2738 14.0966 20.0055 14.2743C19.7372 14.452 19.5268 14.7042 19.4 15Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          )}

          <h1 className="title">burrs.io</h1>
          <div className="input-container">
            <input
              type="text"
              placeholder="Enter your name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePlay()}
              className="name-input"
              maxLength={20}
            />
            <button
              onClick={handlePlay}
              className="play-button"
            >
              Play
            </button>
          </div>
          <div className="menu-buttons">
            <button
              className="menu-secondary-button"
              onClick={() => {
                hapticManager.trigger('light')
                audioManager.playSFX('uiClick')
                setShowServerSelector(true)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px', marginRight: '8px' }}>
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
              </svg>
              Select Server
            </button>
            <button
              className="menu-secondary-button"
              onClick={() => {
                hapticManager.trigger('light')
                audioManager.playSFX('uiClick')
                setShowHowToPlay(true)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px', marginRight: '8px' }}>
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              How to Play
            </button>
            <button
              className="menu-secondary-button"
              onClick={() => {
                audioManager.playSFX('uiClick')
                setShowAudioSettings(true)
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '20px', height: '20px', marginRight: '8px' }}>
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
              </svg>
              Audio Settings
            </button>
          </div>

          {/* Bottom-left buttons - visible on menu screen */}
          <div className="bottom-left-buttons">
            <button
              className="bottom-button bug-button"
              onClick={() => {
                hapticManager.trigger('light')
                audioManager.playSFX('uiClick')
                setShowBugReport(true)
              }}
              title="Report a Bug"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/>
              </svg>
              Report a Bug
            </button>
            <button
              className="bottom-button discord-button"
              onClick={() => {
                hapticManager.trigger('light')
                audioManager.playSFX('uiClick')
                window.open('https://discord.gg/cquXPupzWq', '_blank', 'noopener,noreferrer')
              }}
              title="Join Discord"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515a.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0a12.64 12.64 0 0 0-.617-1.25a.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057a19.9 19.9 0 0 0 5.993 3.03a.078.078 0 0 0 .084-.028a14.09 14.09 0 0 0 1.226-1.994a.076.076 0 0 0-.041-.106a13.107 13.107 0 0 1-1.872-.892a.077.077 0 0 1-.008-.128a10.2 10.2 0 0 0 .372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127a12.299 12.299 0 0 1-1.873.892a.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028a19.839 19.839 0 0 0 6.002-3.03a.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.956-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419c0-1.333.955-2.419 2.157-2.419c1.21 0 2.176 1.096 2.157 2.42c0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
              Join Discord
            </button>
          </div>
        </div>
      )}

      {gameState === 'connecting' && (
        <div className="loading-screen">
          <div className="loading-content">
            <h1 className="loading-title">burrs.io</h1>
            <div className="loading-spinner-container">
              <div className="loading-spinner"></div>
            </div>
            <h2 className="loading-text">Connecting to server...</h2>
            <div className="loading-tip-container">
              <div className="loading-tip-icon">💡</div>
              <p className="loading-tip">{loadingTip}</p>
            </div>
          </div>
        </div>
      )}

      {gameState === 'playing' && showEvolutionTree && (() => {
        // Determine which tier options to show based on evolution state
        let tierOptions: typeof TIER_1_OPTIONS = []
        let tierTitle = ''
        let tierSubtitle = ''

        if (!hasEvolved) {
          // Show Tier 1 options
          tierOptions = TIER_1_OPTIONS
          tierTitle = 'Choose Your Evolution'
          tierSubtitle = 'Select your Tier 1 upgrade'
        } else if (hasEvolved && !tier2Evolved) {
          // Show Tier 2 options based on current spike type
          tierTitle = 'Tier 2 Evolution'
          tierSubtitle = 'Upgrade your spike'

          if (currentSpikeType === 'Prickle') {
            tierOptions = TIER_2_PRICKLE_OPTIONS
          } else if (currentSpikeType === 'Thorn') {
            tierOptions = TIER_2_THORN_OPTIONS
          } else if (currentSpikeType === 'Bristle') {
            tierOptions = TIER_2_BRISTLE_OPTIONS
          } else if (currentSpikeType === 'Bulwark') {
            tierOptions = TIER_2_BULWARK_OPTIONS
          } else if (currentSpikeType === 'Starflare') {
            tierOptions = TIER_2_STARFLARE_OPTIONS
          } else if (currentSpikeType === 'Mauler') {
            tierOptions = TIER_2_MAULER_OPTIONS
          }
        }

        if (tierOptions.length === 0) return null

        return (
          <div className="evolution-screen">
            <div className="evolution-content">
              <h1 className="evolution-title">{tierTitle}</h1>
              <p className="evolution-subtitle">{tierSubtitle}</p>

              <div className="evolution-grid">
                {tierOptions.map((option) => (
                  <EvolutionOption
                    key={option.type}
                    option={option}
                    onSelect={() => {
                      hapticManager.trigger('success')
                      audioManager.playSFX('uiClick')
                      if (socketRef.current) {
                        socketRef.current.emit('evolve', option.type)
                        setShowEvolutionTree(false)

                        // Update evolution state
                        if (!hasEvolved) {
                          setHasEvolved(true)
                          hasEvolvedRef.current = true

                          // Check if player should immediately get tier 2 prompt
                          // (if they jumped past tier 2 threshold before selecting tier 1)
                          const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
                          if (localPlayer && localPlayer.score >= TIER_2_THRESHOLD) {
                            // Show tier 2 evolution tree after a short delay
                            setTimeout(() => {
                              setShowEvolutionTree(true)
                            }, 100)
                          }
                        } else {
                          setTier2Evolved(true)
                          tier2EvolvedRef.current = true
                        }

                        setCurrentSpikeType(option.type)

                        // Play evolution sound effect
                        audioManager.playSFX('evolution')

                        // Add evolution effect at player position
                        const localPlayer = localPlayerIdRef.current ? playersRef.current.get(localPlayerIdRef.current) : null
                        if (localPlayer) {
                          evolutionEffectsRef.current.push({
                            x: localPlayer.x,
                            y: localPlayer.y,
                            startTime: Date.now(),
                            duration: 2000,
                            spikeType: option.type,
                          })
                        }
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      })()}

      {gameState === 'dead' && deathStats && (
        <div className="death-screen">
          <div className="death-content">
            <h1 className="death-title">You Died</h1>

            <div className="death-cause">
              <div className="death-cause-main">
                <span className="death-cause-label">Cause of death</span>
                <span
                  className="death-cause-value"
                  style={{ color: causeOfDeathColor }}
                >
                  {causeOfDeath}
                </span>
              </div>
              {hasAssists && (
                <div className="death-assists">
                  <span className="death-assists-label">Assisted by</span>
                  <span className="death-assists-value">
                    {deathAssistNames.join(', ')}
                  </span>
                </div>
              )}
            </div>

            <div className="death-stats">
              <div className="stat-row">
                <span className="stat-label">Time Survived</span>
                <span className="stat-value">{formatTime(deathStats.timeSurvived)}</span>
              </div>

              <div className="stat-row">
                <span className="stat-label">Final Score</span>
                <span className="stat-value score-highlight">{deathStats.score.toLocaleString()}</span>
              </div>

              <div className="stat-row">
                <span className="stat-label">Players Killed</span>
                <span className="stat-value">{deathStats.kills}</span>
              </div>

              <div className="stat-row">
                <span className="stat-label">Orbs Collected</span>
                <span className="stat-value">{deathStats.foodEaten}</span>
              </div>

              <div className="stat-row">
                <span className="stat-label">Special Orbs</span>
                <span className="stat-value premium-highlight">{deathStats.premiumOrbsEaten}</span>
              </div>
            </div>

            <div className="death-buttons">
              <button onClick={handleRespawn} className="respawn-button">
                Respawn
              </button>
              <button onClick={handleGoHome} className="home-button">
                Main Menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audio Settings Modal */}
      {showAudioSettings && (
        <AudioSettings onClose={() => {
          audioManager.playSFX('uiClick')
          setShowAudioSettings(false)
        }} />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <Settings
          onClose={() => {
            audioManager.playSFX('uiClick')
            setShowSettings(false)
          }}
          onKeybindingsChange={(newKeybindings) => {
            setKeybindings(newKeybindings)
          }}
        />
      )}

      {/* Authentication Notification */}
      {authNotification && (
        <div className={`auth-notification ${authNotification.type}`}>
          {authNotification.message}
        </div>
      )}

      {/* Sign Up Modal */}
      {showSignUp && (
        <div className="modal-overlay" onClick={() => setShowSignUp(false)}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowSignUp(false)}>×</button>
            <h2 className="auth-modal-title">Create Account</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const username = formData.get('username') as string
              const password = formData.get('password') as string
              const confirmPassword = formData.get('confirmPassword') as string
              handleSignUp(username, password, confirmPassword)
            }}>
              <div className="auth-input-group">
                <label htmlFor="signup-username">Username</label>
                <input
                  id="signup-username"
                  name="username"
                  type="text"
                  placeholder="Enter username"
                  className="auth-input"
                  maxLength={20}
                  required
                />
              </div>
              <div className="auth-input-group">
                <label htmlFor="signup-password">Password</label>
                <input
                  id="signup-password"
                  name="password"
                  type="password"
                  placeholder="Enter password"
                  className="auth-input"
                  required
                />
              </div>
              <div className="auth-input-group">
                <label htmlFor="signup-confirm-password">Confirm Password</label>
                <input
                  id="signup-confirm-password"
                  name="confirmPassword"
                  type="password"
                  placeholder="Confirm password"
                  className="auth-input"
                  required
                />
              </div>
              <button type="submit" className="auth-submit-button">
                Sign Up
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Login Modal */}
      {showLogin && (
        <div className="modal-overlay" onClick={() => setShowLogin(false)}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowLogin(false)}>×</button>
            <h2 className="auth-modal-title">Login</h2>
            <form onSubmit={(e) => {
              e.preventDefault()
              const formData = new FormData(e.currentTarget)
              const username = formData.get('username') as string
              const password = formData.get('password') as string
              handleLogin(username, password)
            }}>
              <div className="auth-input-group">
                <label htmlFor="login-username">Username</label>
                <input
                  id="login-username"
                  name="username"
                  type="text"
                  placeholder="Enter username"
                  className="auth-input"
                  required
                />
              </div>
              <div className="auth-input-group">
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  placeholder="Enter password"
                  className="auth-input"
                  required
                />
              </div>
              <button type="submit" className="auth-submit-button">
                Login
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Auth Settings Modal (Logout) */}
      {showAuthSettings && (
        <div className="modal-overlay" onClick={() => setShowAuthSettings(false)}>
          <div className="auth-modal settings-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowAuthSettings(false)}>×</button>
            <h2 className="auth-modal-title">Settings</h2>

            <div className="settings-section">
              <h3 className="settings-section-title">Friends</h3>
              <p className="settings-section-description">
                Friends system coming soon! You'll be able to:
              </p>
              <ul className="settings-feature-list">
                <li>✓ Add friends by username</li>
                <li>✓ See your friends list</li>
                <li>✓ Accept/decline friend requests</li>
                <li>✓ Block/unblock users</li>
                <li>✓ See when friends are online</li>
              </ul>
            </div>

            <div className="settings-section">
              <h3 className="settings-section-title">Account</h3>
              <div className="settings-info">
                <p><strong>Username:</strong> {currentUser?.username}</p>
                <p><strong>Premium Orbs:</strong> {premiumOrbs}</p>
              </div>
            </div>

            <button
              className="logout-button"
              onClick={() => {
                hapticManager.trigger('light')
                audioManager.playSFX('uiClick')
                setShowAuthSettings(false)
                setShowLogoutConfirm(true)
              }}
            >
              Logout
            </button>
          </div>
        </div>
      )}

      {/* Logout Confirmation Modal */}
      {showLogoutConfirm && (
        <div className="modal-overlay" onClick={() => setShowLogoutConfirm(false)}>
          <div className="auth-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="auth-modal-title">Confirm Logout</h2>
            <p className="logout-confirm-text">Are you sure you want to logout?</p>
            <div className="logout-confirm-buttons">
              <button
                className="logout-confirm-yes"
                onClick={() => {
                  hapticManager.trigger('medium')
                  audioManager.playSFX('uiClick')
                  handleLogout()
                }}
              >
                Yes, Logout
              </button>
              <button
                className="logout-confirm-cancel"
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowLogoutConfirm(false)
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customizations Shop Modal */}
      {showCustomizations && availableCustomizations && (
        <div className="modal-overlay" onClick={() => setShowCustomizations(false)}>
          <div className="customizations-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => {
              hapticManager.trigger('light')
              audioManager.playSFX('uiClick')
              setShowCustomizations(false)
            }}>×</button>

            <h2 className="customizations-title">Customization Shop</h2>

            <div className="customizations-orbs-balance">
              <svg className="orbs-icon-large" width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="url(#diamondGradient2)"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <defs>
                  <linearGradient id="diamondGradient2" x1="2" y1="2" x2="22" y2="12">
                    <stop offset="0%" stopColor="#00ffff" />
                    <stop offset="100%" stopColor="#00d4ff" />
                  </linearGradient>
                </defs>
              </svg>
              <span className="orbs-balance-text">Premium Orbs: <strong>{premiumOrbs}</strong></span>
            </div>

            <div className="customizations-tabs">
              <button
                className={`customizations-tab ${customizationsTab === 'nametags' ? 'active' : ''}`}
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setCustomizationsTab('nametags')
                }}
              >
                Nametags
              </button>
              <button
                className={`customizations-tab ${customizationsTab === 'spikes' ? 'active' : ''}`}
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setCustomizationsTab('spikes')
                }}
              >
                Spikes
              </button>
            </div>

            <div className="customizations-grid">
              {customizationsTab === 'nametags' ? (
                availableCustomizations.nametags.map((item: any) => {
                  const isOwned = ownedCustomizations.includes(item.id)
                  const isActive = activeNametag === item.id
                  const canAfford = premiumOrbs >= item.price

                  return (
                    <div key={item.id} className={`customization-card ${isActive ? 'active' : ''}`}>
                      <div className="customization-preview nametag-preview" style={item.style}>
                        {currentUser?.username || 'Preview'}
                      </div>
                      <h3 className="customization-name">{item.name}</h3>
                      <p className="customization-description">{item.description}</p>
                      <div className="customization-price">
                        {item.price === 0 ? 'Free' : `${item.price} Orbs`}
                      </div>
                      {isActive ? (
                        <button className="customization-button equipped" disabled>
                          ✓ Equipped
                        </button>
                      ) : isOwned ? (
                        <button
                          className="customization-button equip"
                          onClick={() => {
                            hapticManager.trigger('medium')
                            audioManager.playSFX('uiClick')
                            handleEquipCustomization(item.id, 'nametag')
                          }}
                        >
                          Equip
                        </button>
                      ) : (
                        <button
                          className={`customization-button purchase ${!canAfford ? 'disabled' : ''}`}
                          onClick={() => {
                            if (canAfford) {
                              hapticManager.trigger('medium')
                              audioManager.playSFX('uiClick')
                              handlePurchaseCustomization(item.id)
                            }
                          }}
                          disabled={!canAfford}
                        >
                          {canAfford ? 'Purchase' : 'Insufficient Orbs'}
                        </button>
                      )}
                    </div>
                  )
                })
              ) : (
                availableCustomizations.spikes.map((item: any) => {
                  const isOwned = ownedCustomizations.includes(item.id)
                  const isActive = activeSpike === item.id
                  const canAfford = premiumOrbs >= item.price

                  return (
                    <div key={item.id} className={`customization-card ${isActive ? 'active' : ''}`}>
                      <div className="customization-preview spike-preview">
                        <svg className="spike-preview-svg" viewBox="0 0 100 100" width="60" height="60">
                          <defs>
                            <radialGradient id={`spikeGrad-${item.id}`}>
                              <stop offset="0%" stopColor={item.effect.color || '#00ffff'} stopOpacity="0.8" />
                              <stop offset="100%" stopColor={item.effect.color || '#00ffff'} stopOpacity="0.2" />
                            </radialGradient>
                          </defs>
                          <circle cx="50" cy="50" r="20" fill={`url(#spikeGrad-${item.id})`} />
                          <g className="spike-spikes">
                            {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
                              const rad = (angle * Math.PI) / 180
                              const x1 = 50 + Math.cos(rad) * 20
                              const y1 = 50 + Math.sin(rad) * 20
                              const x2 = 50 + Math.cos(rad) * 35
                              const y2 = 50 + Math.sin(rad) * 35
                              return (
                                <line
                                  key={i}
                                  x1={x1}
                                  y1={y1}
                                  x2={x2}
                                  y2={y2}
                                  stroke={item.effect.color || '#00ffff'}
                                  strokeWidth="3"
                                  strokeLinecap="round"
                                />
                              )
                            })}
                          </g>
                        </svg>
                      </div>
                      <h3 className="customization-name">{item.name}</h3>
                      <p className="customization-description">{item.description}</p>
                      <div className="customization-price">
                        {item.price === 0 ? 'Free' : `${item.price} Orbs`}
                      </div>
                      {isActive ? (
                        <button className="customization-button equipped" disabled>
                          ✓ Equipped
                        </button>
                      ) : isOwned ? (
                        <button
                          className="customization-button equip"
                          onClick={() => {
                            hapticManager.trigger('medium')
                            audioManager.playSFX('uiClick')
                            handleEquipCustomization(item.id, 'spike')
                          }}
                        >
                          Equip
                        </button>
                      ) : (
                        <button
                          className={`customization-button purchase ${!canAfford ? 'disabled' : ''}`}
                          onClick={() => {
                            if (canAfford) {
                              hapticManager.trigger('medium')
                              audioManager.playSFX('uiClick')
                              handlePurchaseCustomization(item.id)
                            }
                          }}
                          disabled={!canAfford}
                        >
                          {canAfford ? 'Purchase' : 'Insufficient Orbs'}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Tutorial Modal - only on menu screen */}
      {gameState === 'menu' && showHowToPlay && (
        <div className="modal-overlay" onClick={() => {
          audioManager.playSFX('uiClick')
          setShowHowToPlay(false)
          setTutorialStep(0)
        }}>
          <div className="tutorial-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => {
              audioManager.playSFX('uiClick')
              setShowHowToPlay(false)
              setTutorialStep(0)
            }}>×</button>

            {/* Step 1: Welcome */}
            {tutorialStep === 0 && (
              <div className="tutorial-step">
                <div className="tutorial-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 16v-4"></path>
                    <path d="M12 8h.01"></path>
                  </svg>
                </div>
                <h2>Welcome to burrs.io!</h2>
                <p className="tutorial-text">Learn the basics in just a few steps</p>
                <button className="tutorial-button" onClick={() => {
                  audioManager.playSFX('uiClick')
                  setTutorialStep(1)
                }}>
                  Start Tutorial
                </button>
                <button className="tutorial-skip" onClick={() => {
                  audioManager.playSFX('uiClick')
                  setShowHowToPlay(false)
                  setTutorialStep(0)
                }}>
                  Skip
                </button>
              </div>
            )}

            {/* Step 2: Movement */}
            {tutorialStep === 1 && (
              <div className="tutorial-step">
                <div className="tutorial-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
                <h2>Movement</h2>
                <p className="tutorial-text">Use WASD keys to move your spike around</p>
                <div className="keyboard-visual">
                  <div className="key-row">
                    <div className="key">W</div>
                  </div>
                  <div className="key-row">
                    <div className="key">A</div>
                    <div className="key">S</div>
                    <div className="key">D</div>
                  </div>
                </div>
                <p className="tutorial-hint">Move in any direction to navigate the arena</p>
                <div className="tutorial-nav">
                  <button className="tutorial-button-secondary" onClick={() => {
                    audioManager.playSFX('uiClick')
                    setTutorialStep(0)
                  }}>
                    Back
                  </button>
                  <button className="tutorial-button" onClick={() => {
                    audioManager.playSFX('uiClick')
                    setTutorialStep(2)
                  }}>
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Boost */}
            {tutorialStep === 2 && (
              <div className="tutorial-step">
                <div className="tutorial-icon boost-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                  </svg>
                </div>
                <h2>Speed Boost</h2>
                <p className="tutorial-text">Press B to activate a speed boost</p>
                <div className="keyboard-visual">
                  <div className="key-row">
                    <div className="key large-key">B</div>
                  </div>
                </div>
                <p className="tutorial-hint">Use boost to escape danger or catch food!</p>
                <div className="tutorial-nav">
                  <button className="tutorial-button-secondary" onClick={() => {
                    audioManager.playSFX('uiClick')
                    setTutorialStep(1)
                  }}>
                    Back
                  </button>
                  <button className="tutorial-button" onClick={() => {
                    audioManager.playSFX('uiClick')
                    setTutorialStep(3)
                  }}>
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Objective */}
            {tutorialStep === 3 && (
              <div className="tutorial-step">
                <div className="tutorial-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <circle cx="12" cy="12" r="6"></circle>
                    <circle cx="12" cy="12" r="2"></circle>
                  </svg>
                </div>
                <h2>Objective</h2>
                <p className="tutorial-text">Eat food orbs to grow bigger and stronger</p>
                <div className="objective-visual">
                  <div className="orb small-orb"></div>
                  <div className="orb medium-orb"></div>
                  <div className="orb large-orb"></div>
                </div>
                <p className="tutorial-hint">Bigger spikes can defeat smaller ones!</p>
                <div className="tutorial-nav">
                  <button className="tutorial-button-secondary" onClick={() => {
                    audioManager.playSFX('uiClick')
                    setTutorialStep(2)
                  }}>
                    Back
                  </button>
                  <button className="tutorial-button" onClick={() => {
                    audioManager.playSFX('uiClick')
                    setShowHowToPlay(false)
                    setTutorialStep(0)
                  }}>
                    Got it!
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* In-Game Controls Guide */}
      {gameState === 'playing' && showControlsGuide && (
        <div className="controls-guide-overlay">
          <div className="controls-guide">
            <h3>Controls</h3>
            <div className="controls-list">
              <div className="control-row">
                <kbd>{keybindings.moveUp.toUpperCase()} {keybindings.moveLeft.toUpperCase()} {keybindings.moveDown.toUpperCase()} {keybindings.moveRight.toUpperCase()}</kbd> Move
              </div>
              <div className="control-row"><kbd>{keybindings.speedBoost.toUpperCase()}</kbd> Speed Boost</div>
              <div className="control-row"><kbd>{keybindings.specialAbility.toUpperCase()}</kbd> Special Ability</div>
              <div className="control-row"><kbd>{keybindings.chat === 'Enter' ? '↵ Enter' : keybindings.chat.toUpperCase()}</kbd> Chat</div>
              <div className="control-row"><kbd>{keybindings.afkToggle.toUpperCase()}</kbd> Toggle AFK (must be in base)</div>
              <div className="control-row"><kbd>{keybindings.controlsGuide.toUpperCase()}</kbd> Toggle This Guide</div>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect Screen */}
      {showDisconnectScreen && (
        <div className="death-screen">
          <div className="death-content" style={{ textAlign: 'center' }}>
            <h1 className="death-title">Disconnected</h1>
            <p style={{ fontSize: '18px', marginBottom: '30px', color: 'rgba(255, 255, 255, 0.8)' }}>
              Connection to server lost
            </p>
            {deathStats && (
              <div className="death-stats">
                <div className="stat-row">
                  <span className="stat-label">Final Score</span>
                  <span className="stat-value score-highlight">{deathStats.score.toLocaleString()}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Kills</span>
                  <span className="stat-value">{deathStats.kills}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Time Survived</span>
                  <span className="stat-value">{deathStats.timeSurvived}</span>
                </div>
              </div>
            )}
            <div className="death-buttons">
              <button
                className="respawn-button"
                onClick={() => {
                  hapticManager.trigger('medium')
                  audioManager.playSFX('uiClick')
                  // Reconnect behaves like a clean respawn attempt using the same
                  // name. We let the normal socket effect handle creating the
                  // connection and joining, which keeps all socket wiring
                  // consistent.
                  setShowDisconnectScreen(false)

                  // Ensure any existing socket is fully disconnected first
                  if (socketRef.current) {
                    socketRef.current.disconnect()
                    socketRef.current = null
                  }

                  // Reset death state so the UI is clean when we come back
                  setDeathStats(null)
                  setDeathAnimationProgress(0)

                  // Move into a dedicated connecting state so the socket effect
                  // reliably creates a fresh connection even if we were already
                  // in "playing" when the disconnect happened.
                  setGameState('connecting')
                }}
              >
                Reconnect
              </button>
              <button
                className="respawn-button"
                style={{
                  background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: '0 4px 15px rgba(102, 126, 234, 0.4)',
                }}
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowDisconnectScreen(false)
                  setGameState('menu')
                  if (socketRef.current) {
                    socketRef.current.disconnect()
                    socketRef.current = null
                  }
                }}
              >
                Go to Homepage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Server Selector Modal */}
      {showServerSelector && (
        <ServerSelector
          onSelectServer={(serverUrl) => {
            setSelectedServerUrl(serverUrl)
            setShowServerSelector(false)
            audioManager.playSFX('uiClick')
            // Save selected server to localStorage
            localStorage.setItem('selectedServer', serverUrl)
          }}
          onClose={() => {
            setShowServerSelector(false)
            audioManager.playSFX('uiClick')
          }}
        />
      )}

      {/* Bug Report Modal */}
      {showBugReport && (
        <div className="modal-overlay" onClick={() => setShowBugReport(false)}>
          <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowBugReport(false)}>×</button>
            <h2 className="bug-modal-title">Report a Bug</h2>

            <div className="bug-input-group">
              <label htmlFor="bug-description">What bug did you encounter? *</label>
              <textarea
                id="bug-description"
                className="bug-textarea"
                placeholder="Describe the bug you encountered..."
                value={bugDescription}
                onChange={(e) => setBugDescription(e.target.value)}
                maxLength={500}
                required
              />
              <div className={`bug-char-count ${bugDescription.length < 10 ? 'error' : ''}`}>
                {bugDescription.length}/500 (minimum 10 characters)
              </div>
            </div>

            <div className="bug-input-group">
              <label htmlFor="bug-steps">Steps to reproduce (optional)</label>
              <textarea
                id="bug-steps"
                className="bug-textarea"
                placeholder="1. Go to...\n2. Click on...\n3. See error..."
                value={bugSteps}
                onChange={(e) => setBugSteps(e.target.value)}
                maxLength={500}
              />
              <div className="bug-char-count">{bugSteps.length}/500</div>
            </div>

            <div className="bug-input-group">
              <label htmlFor="bug-expected">Expected vs Actual behavior (optional)</label>
              <textarea
                id="bug-expected"
                className="bug-textarea"
                placeholder="Expected: ...\nActual: ..."
                value={bugExpected}
                onChange={(e) => setBugExpected(e.target.value)}
                maxLength={500}
              />
              <div className="bug-char-count">{bugExpected.length}/500</div>
            </div>

            <div className="bug-modal-buttons">
              <button
                className="bug-cancel-button"
                onClick={() => {
                  hapticManager.trigger('light')
                  audioManager.playSFX('uiClick')
                  setShowBugReport(false)
                }}
              >
                Cancel
              </button>
              <button
                className="bug-submit-button"
                onClick={() => {
                  hapticManager.trigger('medium')
                  audioManager.playSFX('uiClick')
                  handleBugReport()
                }}
                disabled={bugDescription.trim().length < 10}
              >
                Submit Report
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App

