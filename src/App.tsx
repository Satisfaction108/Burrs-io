import { useState, useEffect, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import './App.css'

interface Player {
  id: string
  username: string
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number
  rotationSpeed: number
  color: string
  score: number
  health: number
  maxHP?: number
  currentHP?: number
  isEating: boolean
  eatingProgress: number
  isAngry?: boolean
  angryProgress?: number
  isDying?: boolean
  deathProgress?: number
  lastCollisionTime?: number
}

interface MapConfig {
  width: number
  height: number
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

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://burrs-io.onrender.com'

// Game constants (match server settings)
const PLAYER_SIZE = 30 // Base size for spikes (reduced from 35 for smaller spawn size)
const PLAYER_SPEED = 5

// Calculate size multiplier based on score (3x slower progression)
// Score 0: 1x, Score 3000: 2x, Score 15000: 3x, Score 75000: 4x
const getSizeMultiplier = (score: number): number => {
  if (score < 3000) {
    // 0-3000: interpolate from 1x to 2x
    return 1 + (score / 3000)
  } else if (score < 15000) {
    // 3000-15000: interpolate from 2x to 3x
    return 2 + ((score - 3000) / 12000)
  } else if (score < 75000) {
    // 15000-75000: interpolate from 3x to 4x
    return 3 + ((score - 15000) / 60000)
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

// Food tier configuration is defined on the server side

// Food generation is now handled server-side

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
  skipUsername: boolean = false
) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)

  // Apply death animation effects
  if (deathProgress && deathProgress > 0) {
    // Fade out
    ctx.globalAlpha = 1 - deathProgress

    // Shrink and spin faster
    const shrinkScale = 1 - (deathProgress * 0.8) // Shrink to 20% size
    ctx.scale(shrinkScale, shrinkScale)

    // Extra rotation during death
    ctx.rotate(deathProgress * Math.PI * 4) // 2 full rotations
  }

  // Draw white star spikes (scaled proportionally with size)
  const outerRadius = size * 1.29 // Scales with size (was size + 10)
  const innerRadius = size * 0.83 // Scales with size (was size - 6)
  const spikes = 8

  ctx.beginPath()
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius
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

  // Draw colored circle body (flat, no gradients)
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  ctx.restore()

  // Draw face (only for player spikes with username)
  // Face doesn't rotate - always faces straight up
  if (username && (!deathProgress || deathProgress < 1)) {
    ctx.save()

    // Fade face out as the spike dies
    const overlayAlpha = deathProgress ? 1 - deathProgress : 1
    ctx.globalAlpha = overlayAlpha
    ctx.fillStyle = '#000000'

    const eating = eatingProgress || 0
    const angry = angryProgress || 0

    // Interpolate between happy and angry expressions
    const isAngry = angry > 0

    if (isAngry) {
      // ANGRY / SAD FACE
      // Strong eyebrows like "\ /" and a clear frown
      ctx.save()
      ctx.lineWidth = size * 0.08
      ctx.strokeStyle = '#000000'

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
      // HAPPY FACE
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

  // Draw death particles
  if (deathProgress && deathProgress > 0) {
    const particleCount = 20
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
  if (username && (!deathProgress || deathProgress < 1)) {
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

// Draw food orb with glow effect
const drawFood = (ctx: CanvasRenderingContext2D, food: Food) => {
  ctx.save()

  // Calculate opacity based on absorption progress
  const opacity = food.absorbing ? 1 - (food.absorbProgress || 0) : 1

  // Pulsing glow effect (lightweight for performance)
  const time = Date.now() / 1000
  const pulsePhase = (food.x + food.y) * 0.01 // Unique phase per orb based on position
  const pulse = 0.7 + Math.sin(time * 2 + pulsePhase) * 0.3 // Oscillates between 0.4 and 1.0

  // Floating animation - slow vertical movement
  const floatOffset = Math.sin(time * 1.5 + pulsePhase) * 3 // ±3 pixels vertical float
  const currentY = food.y + floatOffset

  // Draw orb with single, efficient glow pass
  ctx.globalAlpha = opacity
  ctx.beginPath()
  ctx.arc(food.x, currentY, food.size, 0, Math.PI * 2)
  ctx.fillStyle = food.color
  ctx.shadowColor = food.color
  // Slightly pulsing blur but not too large to avoid lag
  ctx.shadowBlur = food.size * (1.2 + 0.6 * pulse)
  ctx.fill()

  ctx.restore()
}

// Generate random premium orb
// Premium orb generation is now handled server-side

// Draw premium orb with enhanced particle effects
const drawPremiumOrb = (ctx: CanvasRenderingContext2D, orb: PremiumOrb) => {
  ctx.save()

  // Calculate opacity and size based on absorption progress
  const opacity = orb.absorbing ? 1 - (orb.absorbProgress || 0) : 1
  const currentSize = orb.absorbing ? orb.originalSize! * (1 - (orb.absorbProgress || 0)) : orb.size

  ctx.globalAlpha = opacity

  // Pulsing glow effect for premium orbs
  const time = Date.now() / 1000
  const pulsePhase = (orb.x + orb.y) * 0.01
  const pulse = 0.6 + Math.sin(time * 2.5 + pulsePhase) * 0.4 // Stronger pulse for premium

  // Floating animation - slow circular movement
  const floatX = Math.sin(time * 1.2 + pulsePhase) * 4
  const floatY = Math.cos(time * 1.2 + pulsePhase) * 4

  // Move to orb position (absorption animation or floating)
  const currentX = orb.absorbing
    ? orb.x + (orb.absorbTargetX! - orb.x) * (orb.absorbProgress || 0) * 0.15
    : orb.x + floatX
  const currentY = orb.absorbing
    ? orb.y + (orb.absorbTargetY! - orb.y) * (orb.absorbProgress || 0) * 0.15
    : orb.y + floatY

  // Draw orbiting particles with pulsing glow (optimized)
  if (!orb.absorbing) {
    const particleCount = 5 // Fewer particles for better performance
    const orbitRadius = currentSize * 1.8

    ctx.save()
    ctx.shadowColor = orb.color
    ctx.shadowBlur = 8 * pulse

    for (let i = 0; i < particleCount; i++) {
      const angle = (i / particleCount) * Math.PI * 2 + time * 2
      const px = currentX + Math.cos(angle) * orbitRadius
      const py = currentY + Math.sin(angle) * orbitRadius
      const particleSize = 2.5 + Math.sin(time * 3 + i) * 1

      ctx.globalAlpha = opacity * (0.6 + 0.4 * pulse)
      ctx.beginPath()
      ctx.arc(px, py, particleSize, 0, Math.PI * 2)
      ctx.fillStyle = orb.color
      ctx.fill()
    }

    ctx.restore()
  }

  ctx.translate(currentX, currentY)
  ctx.rotate(orb.rotation)

  // Enhanced pulsing glow effect (single pass)
  ctx.shadowColor = orb.color
  ctx.shadowBlur = currentSize * (1.8 + 1.2 * pulse)

  // Draw octogon shape
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

  // Fill with solid color
  ctx.fillStyle = orb.color
  ctx.fill()

  // Single-pass glow only (inner layer removed for performance)
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
  canvasHeight: number
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

  // Soft neon glow
  ctx.shadowColor = '#00ffff'
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
  ctx.fillStyle = '#00ffff'
  ctx.beginPath()
  ctx.arc(playerMinimapX, playerMinimapY, innerRadius * 0.9, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()

  ctx.restore() // Remove clip
  ctx.restore()
}

// Draw notifications
const drawNotifications = (ctx: CanvasRenderingContext2D, notifications: Notification[], canvasWidth: number) => {
  const now = Date.now()
  const notificationHeight = 60
  const notificationWidth = 350
  const startY = 10 // 5 pixels from the top

  notifications.forEach((notification, index) => {
    const age = now - notification.timestamp
    const fadeInDuration = 200 // Fade in over 200ms
    const fadeOutStart = 2700 // Start fading at 2.7 seconds
    const duration = 3000 // Total duration 3 seconds

    // Calculate opacity with fade-in and fade-out
    let opacity = 1
    if (age < fadeInDuration) {
      // Fade in
      opacity = age / fadeInDuration
    } else if (age > fadeOutStart) {
      // Fade out
      opacity = 1 - ((age - fadeOutStart) / (duration - fadeOutStart))
    }
    notification.opacity = Math.max(0, Math.min(1, opacity))

    // Position notifications stacked vertically
    const y = startY + (index * (notificationHeight + 12))
    const x = (canvasWidth - notificationWidth) / 2

    ctx.save()
    ctx.globalAlpha = notification.opacity

    // Professional, sleek notification design
    const radius = 10

    // Outer glow with neon effect
    ctx.shadowColor = 'rgba(255, 215, 0, 0.5)'
    ctx.shadowBlur = 25
    ctx.shadowOffsetY = 4

    // Background - dark and professional
    drawRoundedRect(ctx, x, y, notificationWidth, notificationHeight, radius)
    ctx.fillStyle = 'rgba(15, 15, 30, 0.95)'
    ctx.fill()

    // Clean border with golden accent
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)'
    ctx.lineWidth = 2
    ctx.shadowBlur = 0
    drawRoundedRect(ctx, x, y, notificationWidth, notificationHeight, radius)
    ctx.stroke()

    // Left accent bar
    const accentWidth = 4
    drawRoundedRect(ctx, x, y, accentWidth, notificationHeight, radius)
    ctx.fillStyle = '#ffd700'
    ctx.shadowColor = 'rgba(255, 215, 0, 0.8)'
    ctx.shadowBlur = 10
    ctx.fill()
    ctx.shadowBlur = 0

    // Draw octagon icon (premium orb shape)
    const iconSize = 20
    const iconX = x + 30
    const iconY = y + notificationHeight / 2

    ctx.save()
    ctx.translate(iconX, iconY)
    ctx.rotate(Date.now() / 1000) // Slow rotation

    // Draw octagon
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i
      const px = Math.cos(angle) * iconSize
      const py = Math.sin(angle) * iconSize
      if (i === 0) {
        ctx.moveTo(px, py)
      } else {
        ctx.lineTo(px, py)
      }
    }
    ctx.closePath()
    ctx.fillStyle = '#ffd700'
    ctx.shadowColor = 'rgba(255, 215, 0, 0.9)'
    ctx.shadowBlur = 15
    ctx.fill()
    ctx.restore()

    // Text - clean and professional
    ctx.shadowBlur = 0
    ctx.fillStyle = '#ffffff'
    ctx.font = '700 15px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = 3
    ctx.shadowOffsetY = 1
    ctx.fillText(notification.message, x + 60, y + notificationHeight / 2)

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

// Draw leaderboard
const drawLeaderboard = (
  ctx: CanvasRenderingContext2D,
  players: Map<string, Player>,
  localPlayerId: string | null,
  canvasWidth: number
) => {
  // Get top 10 players sorted by score
  const sortedPlayers = Array.from(players.values())
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

    // Highlight local player row
    if (isLocalPlayer) {
      ctx.fillStyle = 'rgba(255, 215, 0, 0.15)'
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

    // Player name
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.fillStyle = isLocalPlayer ? '#ffd700' : (isTopThree ? '#ffffff' : 'rgba(255, 255, 255, 0.9)')
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

    // Score
    ctx.font = '700 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    ctx.fillStyle = isLocalPlayer ? '#ffd700' : (isTopThree ? '#ffd700' : 'rgba(255, 255, 255, 0.9)')
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

// Draw speed boost effects (cyan energy burst)
const drawBoostEffects = (
  ctx: CanvasRenderingContext2D,
  effects: Array<{ x: number; y: number; startTime: number; duration: number }>
) => {
  const currentTime = Date.now()

  effects.forEach((effect) => {
    const elapsed = currentTime - effect.startTime
    const progress = Math.min(elapsed / effect.duration, 1)

    if (progress < 1) {
      ctx.save()

      const worldX = effect.x
      const worldY = effect.y

      const maxRadius = 90
      const radius = (0.4 + progress * 0.6) * maxRadius
      const innerRadius = radius * 0.5
      const opacity = 1 - progress

      // Soft cyan radial glow
      const glowGradient = ctx.createRadialGradient(worldX, worldY, 0, worldX, worldY, radius)
      glowGradient.addColorStop(0, `rgba(0, 255, 255, ${0.45 * opacity})`)
      glowGradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = glowGradient
      ctx.beginPath()
      ctx.arc(worldX, worldY, radius, 0, Math.PI * 2)
      ctx.fill()

      // Inner sharp ring
      ctx.beginPath()
      ctx.arc(worldX, worldY, innerRadius, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(0, 255, 255, ${0.8 * opacity})`
      ctx.lineWidth = 3
      ctx.stroke()

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


function App() {
  const [displayName, setDisplayName] = useState('')
  const [gameState, setGameState] = useState<GameState>('menu')
  const [deathStats, setDeathStats] = useState<DeathStats | null>(null)
  const [deathAnimationProgress, setDeathAnimationProgress] = useState(0)
  // Health and score are now managed server-side and received via player object
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const socketRef = useRef<Socket | null>(null)
  const playersRef = useRef<Map<string, Player>>(new Map())
  const localPlayerIdRef = useRef<string | null>(null)
  const keysRef = useRef({ w: false, a: false, s: false, d: false })
  const backgroundSpikesRef = useRef<Player[]>([])
  const mapConfigRef = useRef<MapConfig>({ width: 4000, height: 4000 })
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
  // Score popups
  const scorePopupsRef = useRef<ScorePopup[]>([])
  // Collision particles
  const collisionParticlesRef = useRef<CollisionParticle[]>([])
  // Boost visual effects
  const boostEffectsRef = useRef<Array<{
    x: number
    y: number
    startTime: number
    duration: number
  }>>([])

  // Speed boost cooldown UI state
  const [boostOnCooldown, setBoostOnCooldown] = useState(false)
  const boostCooldownTimeoutRef = useRef<number | null>(null)


  // Camera position for smooth interpolation
  const cameraRef = useRef({ x: 0, y: 0 })

  // Initialize Canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    return () => {
      window.removeEventListener('resize', resizeCanvas)
    }
  }, [])

  // Background spike animation for menu and connecting screens
  useEffect(() => {
    if (gameState === 'playing') {
      // Clear background spikes when playing
      backgroundSpikesRef.current = []
      // Cancel any existing menu animation frame
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    // Create background spikes only if we don't have any
    if (backgroundSpikesRef.current.length === 0) {
      const spikes: Player[] = []
      for (let i = 0; i < 20; i++) {
        spikes.push({
          id: `bg-${i}`,
          username: '',
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * PLAYER_SPEED * 0.5,
          vy: (Math.random() - 0.5) * PLAYER_SPEED * 0.5,
          size: PLAYER_SIZE * (0.6 + Math.random() * 0.8),
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.03,
          color: getRandomColor(),
          score: 0,
          health: 100,
          isEating: false,
          eatingProgress: 0
        })
      }
      backgroundSpikesRef.current = spikes
    }

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

      // Update and draw background spikes with glow
      const time = Date.now() / 1000
      backgroundSpikesRef.current.forEach((spike, index) => {
        // Update position
        spike.x += spike.vx
        spike.y += spike.vy
        spike.rotation += spike.rotationSpeed

        // Bounce off walls
        const totalSize = spike.size + 10
        if (spike.x - totalSize < 0 || spike.x + totalSize > canvas.width) {
          spike.vx *= -1
          spike.x = Math.max(totalSize, Math.min(canvas.width - totalSize, spike.x))
        }
        if (spike.y - totalSize < 0 || spike.y + totalSize > canvas.height) {
          spike.vy *= -1
          spike.y = Math.max(totalSize, Math.min(canvas.height - totalSize, spike.y))
        }

        // Add pulsing glow effect
        ctx.save()
        const pulsePhase = time * 2 + index * 0.5
        const glowIntensity = 10 + Math.sin(pulsePhase) * 5
        ctx.shadowColor = spike.color
        ctx.shadowBlur = glowIntensity

        // Draw spike
        drawSpike(ctx, spike.x, spike.y, spike.size, spike.rotation, spike.color)
        ctx.restore()
      })

      ctx.restore()

      // Handle collisions
      for (let i = 0; i < backgroundSpikesRef.current.length; i++) {
        for (let j = i + 1; j < backgroundSpikesRef.current.length; j++) {
          handleBackgroundCollision(backgroundSpikesRef.current[i], backgroundSpikesRef.current[j])
        }
      }

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

      const key = e.key.toLowerCase()
      if (key === 'w' || key === 'arrowup') {
        keysRef.current.w = true
        e.preventDefault()
      }
      if (key === 'a' || key === 'arrowleft') {
        keysRef.current.a = true
        e.preventDefault()
      }
      if (key === 's' || key === 'arrowdown') {
        keysRef.current.s = true
        e.preventDefault()
      }
      if (key === 'd' || key === 'arrowright') {
        keysRef.current.d = true
        e.preventDefault()
      }
      if (key === 'b') {
        if (!e.repeat) {
          triggerSpeedBoost()
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
      if (key === 'w' || key === 'arrowup') {
        keysRef.current.w = false
        e.preventDefault()
      }
      if (key === 'a' || key === 'arrowleft') {
        keysRef.current.a = false
        e.preventDefault()
      }
      if (key === 's' || key === 'arrowdown') {
        keysRef.current.s = false
        e.preventDefault()
      }
      if (key === 'd' || key === 'arrowright') {
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
  }, [gameState])

  // Socket.IO connection - connect once when leaving menu
  useEffect(() => {
    if (gameState === 'menu') {
      // Disconnect if we're back at menu
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
      }
      return
    }

    // Only connect if we don't have a socket yet
    if (socketRef.current) return

    console.log('Connecting to server...')
    const socket = io(SERVER_URL)
    socketRef.current = socket

    socket.on('connect', () => {
      console.log('Connected to server')
      // Send join request with username
      socket.emit('join', displayName)
    })

    socket.on('init', (data: {
      playerId: string;
      player: Player;
      players: Player[];
      food: Food[];
      premiumOrbs: PremiumOrb[];
      mapConfig: MapConfig
    }) => {
      localPlayerIdRef.current = data.playerId
      mapConfigRef.current = data.mapConfig

      // Reset camera to local player position to avoid jitter/shaking on spawn/respawn
      const canvas = canvasRef.current
      if (canvas) {
        const localPlayer = data.players.find((p) => p.id === data.playerId)
        if (localPlayer) {
          const maxCameraX = Math.max(0, data.mapConfig.width - canvas.width)
          const maxCameraY = Math.max(0, data.mapConfig.height - canvas.height)
          let targetCameraX = localPlayer.x - canvas.width / 2
          let targetCameraY = localPlayer.y - canvas.height / 2
          targetCameraX = Math.max(0, Math.min(maxCameraX, targetCameraX))
          targetCameraY = Math.max(0, Math.min(maxCameraY, targetCameraY))
          cameraRef.current.x = targetCameraX
          cameraRef.current.y = targetCameraY
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

    socket.on('gameState', (data: { players: Player[]; food: Food[]; premiumOrbs: PremiumOrb[] }) => {
      // Rebuild players and scores maps from the latest server snapshot
      const newPlayers = new Map<string, Player>()
      const newScores = new Map<string, number>()

      data.players.forEach((player) => {
        newPlayers.set(player.id, player)
        newScores.set(player.id, player.score || 0)
      })

      playersRef.current = newPlayers
      playerScoresRef.current = newScores

      // Update food from server
      foodRef.current = data.food || []

      // Update premium orbs from server
      premiumOrbsRef.current = data.premiumOrbs || []


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

      // Show +X popup for the local player when they gain score from food
      if (data.playerId === localPlayerIdRef.current && newScore > prevScore) {
        const scoreDiff = newScore - prevScore
        const player = playersRef.current.get(data.playerId)

        if (player && scoreDiff > 0) {
          // Position popup just above the username badge
          const playerScoreForSize = player.score || newScore || 0
          const sizeMultiplier = getSizeMultiplier(playerScoreForSize)
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
        }
      }

      // Update player score for tracking
      playerScoresRef.current.set(data.playerId, newScore)
    })

    // Handle premium orb collection events
    socket.on('premiumOrbCollected', (data: { playerId: string; orbId: string; newOrb: PremiumOrb; newScore: number }) => {
      const prevScore = playerScoresRef.current.get(data.playerId) || 0
      const newScore = data.newScore

      // Add notification and score popup if it's the local player
      if (data.playerId === localPlayerIdRef.current && newScore > prevScore) {
        const scoreDiff = newScore - prevScore
        const player = playersRef.current.get(data.playerId)

        if (player && scoreDiff > 0) {
          // Position popup just above the username badge (same as food popups)
          const playerScoreForSize = player.score || newScore || 0
          const sizeMultiplier = getSizeMultiplier(playerScoreForSize)
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
        }

        // Premium orb notification banner
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'PREMIUM ORB COLLECTED',
          timestamp: Date.now(),
          opacity: 1
        })
      }

      // Update player score for tracking
      playerScoresRef.current.set(data.playerId, newScore)
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

    // Handle visual boost effect for all players
    socket.on('playerBoosted', (data: { playerId: string; x: number; y: number }) => {
      const player = playersRef.current.get(data.playerId)
      const x = player ? player.x : data.x
      const y = player ? player.y : data.y

      boostEffectsRef.current.push({
        x,
        y,
        startTime: Date.now(),
        duration: 600,
      })
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

        // Create collision particles
        const particleCount = 20
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
      // Check if it's the local player who died
      if (data.playerId === localPlayerIdRef.current) {
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

    socket.on('disconnect', () => {
      console.log('Disconnected from server')
      setGameState('menu')
      socketRef.current = null
    })

  }, [gameState, displayName])

  // Send input to server
  useEffect(() => {
    if (gameState !== 'playing' || !socketRef.current) return

    const sendInput = () => {
      const input = {
        up: keysRef.current.w,
        down: keysRef.current.s,
        left: keysRef.current.a,
        right: keysRef.current.d,
      }

      socketRef.current?.emit('input', input)
    }

    const inputInterval = setInterval(sendInput, 1000 / 60) // 60 times per second

    return () => {
      clearInterval(inputInterval)
    }
  }, [gameState])

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
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Get local player for camera
      const localPlayer = localPlayerIdRef.current
        ? playersRef.current.get(localPlayerIdRef.current)
        : null



      // Calculate target camera position (center on local player)
      let targetCameraX = 0
      let targetCameraY = 0

      if (localPlayer) {
        targetCameraX = localPlayer.x - canvas.width / 2
        targetCameraY = localPlayer.y - canvas.height / 2

        // Clamp camera to map boundaries
        const maxCameraX = Math.max(0, mapConfigRef.current.width - canvas.width)
        const maxCameraY = Math.max(0, mapConfigRef.current.height - canvas.height)
        targetCameraX = Math.max(0, Math.min(maxCameraX, targetCameraX))
        targetCameraY = Math.max(0, Math.min(maxCameraY, targetCameraY))
      }

      // Smooth camera interpolation (lerp) to prevent sudden jumps
      const lerpFactor = 0.15 // Lower = smoother but slower, higher = faster but jerkier
      cameraRef.current.x += (targetCameraX - cameraRef.current.x) * lerpFactor
      cameraRef.current.y += (targetCameraY - cameraRef.current.y) * lerpFactor

      const cameraX = cameraRef.current.x
      const cameraY = cameraRef.current.y

      // Apply camera transform
      ctx.save()
      ctx.translate(-cameraX, -cameraY)

      // Draw modern grid background
      const gridSize = 100
      const dotSize = 2

      // Calculate visible grid range
      const startX = Math.floor(cameraX / gridSize) * gridSize
      const startY = Math.floor(cameraY / gridSize) * gridSize
      const endX = Math.min(mapConfigRef.current.width, cameraX + canvas.width)
      const endY = Math.min(mapConfigRef.current.height, cameraY + canvas.height)

      // Draw grid dots at intersections (optimized)
      ctx.save()
      ctx.shadowColor = 'rgba(255, 255, 255, 0.3)'
      ctx.shadowBlur = 4
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'

      for (let x = startX; x <= endX; x += gridSize) {
        for (let y = startY; y <= endY; y += gridSize) {
          ctx.beginPath()
          ctx.arc(x, y, dotSize, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      ctx.restore()

      // Draw subtle lines with gradient opacity
      ctx.lineWidth = 0.5

      // Vertical lines
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.beginPath()
        ctx.moveTo(x, Math.max(0, cameraY))
        ctx.lineTo(x, Math.min(mapConfigRef.current.height, cameraY + canvas.height))
        ctx.strokeStyle = 'rgba(100, 150, 200, 0.08)'
        ctx.stroke()
      }

      // Horizontal lines
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.beginPath()
        ctx.moveTo(Math.max(0, cameraX), y)
        ctx.lineTo(Math.min(mapConfigRef.current.width, cameraX + canvas.width), y)
        ctx.strokeStyle = 'rgba(100, 150, 200, 0.08)'
        ctx.stroke()
      }

      // Draw map borders - subtle neon frame that fits the game theme
      ctx.save()
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.6)'
      ctx.shadowColor = 'rgba(0, 255, 255, 0.4)'
      ctx.shadowBlur = 18
      ctx.strokeRect(
        0.5,
        0.5,
        mapConfigRef.current.width - 1,
        mapConfigRef.current.height - 1
      )
      ctx.restore()

      // Draw all food orbs
      foodRef.current.forEach((food) => {
        drawFood(ctx, food)
      })

      // Draw all premium orbs
      premiumOrbsRef.current.forEach((orb) => {
        drawPremiumOrb(ctx, orb)
      })

      // Eating animation is now handled server-side

      // Update and clean up notifications
      const now = Date.now()
      notificationsRef.current = notificationsRef.current.filter(notification => {
        return (now - notification.timestamp) < 3000 // Remove after 3 seconds
      })

      // Collision detection and food/orb management is now handled server-side
      // Client only receives updates via socket events

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

        // Calculate size based on player's score (from server)
        const playerScore = player.score || 0
        const sizeMultiplier = getSizeMultiplier(playerScore)
        const scaledSize = PLAYER_SIZE * sizeMultiplier

        drawSpike(
          ctx,
          player.x,
          player.y,
          scaledSize,
          player.rotation,
          player.color,
          player.username,
          eatingProgress,
          player.health || 100, // Use server-provided health
          player.angryProgress || 0, // Use server-provided angry progress
          player.deathProgress || 0, // Use server-provided death progress
          true // Skip username in first pass
        )
      })

      // Second pass: Draw all player usernames on top
      playersRef.current.forEach((player) => {
        // Calculate size based on player's score (from server)
        const playerScore = player.score || 0
        const sizeMultiplier = getSizeMultiplier(playerScore)
        const scaledSize = PLAYER_SIZE * sizeMultiplier
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

          // Measure text for badge sizing
          ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
          const textMetrics = ctx.measureText(player.username)
          const textWidth = textMetrics.width

          // Badge dimensions
          const badgeWidth = textWidth + badgePadding * 2
          const badgeY = player.y - scaledSize - badgeOffset
          const badgeX = player.x - badgeWidth / 2

          // Draw badge background with player color
          drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius)
          ctx.fillStyle = player.color
          ctx.shadowColor = player.color
          ctx.shadowBlur = 15
          ctx.fill()
          ctx.shadowBlur = 0

          // Draw badge border
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
          ctx.lineWidth = 1.5
          ctx.stroke()

          // Draw username text with black outline for readability
          ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'

          ctx.lineJoin = 'round'
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)'
          ctx.lineWidth = 3 * sizeScale
          ctx.strokeText(player.username, player.x, badgeY + badgeHeight / 2)

          ctx.fillStyle = '#ffffff'
          ctx.shadowColor = 'rgba(0, 0, 0, 0.8)'
          ctx.shadowBlur = 4
          ctx.fillText(player.username, player.x, badgeY + badgeHeight / 2)
          ctx.shadowBlur = 0

          ctx.restore()
        }
      })

      // Draw collision and boost effects in world space (before ctx.restore())
      if (localPlayer) {
        drawCollisionEffects(ctx, collisionEffectsRef.current)
        drawBoostEffects(ctx, boostEffectsRef.current)
        drawCollisionParticles(ctx, collisionParticlesRef.current)
        drawScorePopups(ctx, scorePopupsRef.current)
      }

      ctx.restore()

      // Draw status bars (HP and Score) in screen space
      const currentScore = localPlayer ? (localPlayer.score || 0) : 0
      const currentHealth = localPlayer ? (localPlayer.health || 100) : 100
      drawStatusBars(ctx, currentHealth, currentScore, canvas.width, canvas.height)

      // Draw leaderboard in screen space
      drawLeaderboard(ctx, playersRef.current, localPlayerIdRef.current, canvas.width)

      // Draw minimap in screen space
      if (localPlayer) {
        drawMinimap(
          ctx,
          localPlayer.x,
          localPlayer.y,
          mapConfigRef.current.width,
          mapConfigRef.current.height,
          canvas.width,
          canvas.height
        )
      }

      // Draw notifications in screen space
      drawNotifications(ctx, notificationsRef.current, canvas.width)

      // Draw red vignette if local player is angry
      if (localPlayer && localPlayer.isAngry && localPlayer.angryProgress) {
        const vignetteStrength = localPlayer.angryProgress * 0.4 // Max 40% opacity
        const gradient = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          0,
          canvas.width / 2,
          canvas.height / 2,
          Math.max(canvas.width, canvas.height) * 0.7
        )
        gradient.addColorStop(0, 'rgba(255, 0, 0, 0)')
        gradient.addColorStop(1, `rgba(255, 0, 0, ${vignetteStrength})`)
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, canvas.width, canvas.height)
      }

      // Draw death animation overlay
      if (deathAnimationProgress > 0 && deathAnimationProgress < 1) {
        // Fade to black with red tint
        const fadeOpacity = deathAnimationProgress * 0.9
        ctx.fillStyle = `rgba(20, 0, 0, ${fadeOpacity})`
        ctx.fillRect(0, 0, canvas.width, canvas.height)

        // Shrinking circle effect (vision closing in)
        const maxRadius = Math.max(canvas.width, canvas.height) * 0.8
        const currentRadius = maxRadius * (1 - deathAnimationProgress)

        ctx.save()
        ctx.globalCompositeOperation = 'destination-out'
        const circleGradient = ctx.createRadialGradient(
          canvas.width / 2,
          canvas.height / 2,
          currentRadius * 0.5,
          canvas.width / 2,
          canvas.height / 2,
          currentRadius
        )
        circleGradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
        circleGradient.addColorStop(1, 'rgba(0, 0, 0, 1)')
        ctx.fillStyle = circleGradient
        ctx.fillRect(0, 0, canvas.width, canvas.height)
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
    // Add fade-out class to menu
    const menuContent = document.querySelector('.content')
    if (menuContent) {
      menuContent.classList.add('fade-out')
    }

    // Wait for fade-out animation, then show connecting screen
    setTimeout(() => {
      setGameState('connecting')

      // Show connecting screen for a bit, then start game
      setTimeout(() => {
        setGameState('playing')
      }, 1000)
    }, 300)
  }

  const handleRespawn = () => {
    // Reset death state
    setDeathStats(null)
    setDeathAnimationProgress(0)

    // Request respawn from server
    if (socketRef.current) {
      socketRef.current.emit('respawn', displayName)
      setGameState('playing')
    }
  }

  const handleGoHome = () => {
    // Disconnect from server
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }

    // Reset state
    setDeathStats(null)
    setDeathAnimationProgress(0)
    playersRef.current.clear()
    localPlayerIdRef.current = null

    // Go to menu
    setGameState('menu')
  }

  const triggerSpeedBoost = () => {
    if (gameState !== 'playing') return
    if (!socketRef.current) return
    socketRef.current.emit('speedBoost')
  }

  const handleSpeedBoostClick = () => {
    triggerSpeedBoost()
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="app">
      <div className={`grid-background ${gameState === 'playing' ? 'hidden' : ''}`} />
      <canvas ref={canvasRef} className={`game-canvas ${gameState === 'playing' ? 'playing' : ''}`} />

      {gameState === 'playing' && (
        <button
          className="speed-boost-button"
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


      {gameState === 'menu' && (
        <div className="content">
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
        </div>
      )}

      {gameState === 'connecting' && (
        <div className="content">
          <div className="connecting-container">
            <div className="spinner"></div>
            <h2 className="connecting-text">Connecting...</h2>
          </div>
        </div>
      )}

      {gameState === 'dead' && deathStats && (
        <div className="death-screen">
          <div className="death-content">
            <h1 className="death-title">You Died</h1>

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
    </div>
  )
}

export default App

