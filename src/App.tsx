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
  isEating: boolean
  eatingProgress: number
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

type GameState = 'menu' | 'connecting' | 'playing'

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
  health: number = 100
) => {
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(rotation)

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

  // Draw colored circle body
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()

  ctx.restore()

  // Draw happy face (only for player spikes with username)
  // Face doesn't rotate - always faces straight up
  if (username) {
    ctx.save()
    ctx.fillStyle = '#000000'

    const eating = eatingProgress || 0

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

    ctx.restore()
  }

  // Draw username above spike with modern badge (scaled with size)
  if (username) {
    ctx.save()

    // Scale badge elements based on spike size (base size = 30)
    const sizeScale = size / 30
    const fontSize = Math.max(10, 12 * sizeScale) // Scale font, min 10px
    const badgePadding = 8 * sizeScale
    const badgeHeight = 22 * sizeScale
    const badgeRadius = 11 * sizeScale
    const badgeOffset = 45 * sizeScale // Distance above spike

    // Measure text for badge sizing
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    const textMetrics = ctx.measureText(username)
    const textWidth = textMetrics.width

    // Badge dimensions
    const badgeWidth = textWidth + badgePadding * 2
    const badgeY = y - size - badgeOffset
    const badgeX = x - badgeWidth / 2

    // Draw badge background with player color
    drawRoundedRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeRadius)

    // Semi-transparent version of player color
    const tempCanvas = document.createElement('canvas')
    const tempCtx = tempCanvas.getContext('2d')
    if (tempCtx) {
      tempCtx.fillStyle = color
      tempCtx.fillRect(0, 0, 1, 1)
    }

    ctx.fillStyle = `${color}dd` // Add alpha to color
    ctx.fill()

    // Badge border
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // Inner shadow effect
    ctx.save()
    drawRoundedRect(ctx, badgeX + 1, badgeY + 1, badgeWidth - 2, badgeHeight - 2, badgeRadius - 1)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()

    // Draw username text with strong outline for readability
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    // Draw dark outline/stroke for better contrast on light backgrounds
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)'
    ctx.lineWidth = 3 * sizeScale
    ctx.lineJoin = 'round'
    ctx.strokeText(username, x, badgeY + badgeHeight / 2)

    // Draw white text on top
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)'
    ctx.shadowBlur = 4 * sizeScale
    ctx.shadowOffsetY = 1 * sizeScale
    ctx.fillText(username, x, badgeY + badgeHeight / 2)

    ctx.restore()
  }

  // Draw health bar below spike (visible to all players, only for player spikes, scaled with size)
  if (username) {
    ctx.save()

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
      drawRoundedRect(ctx, healthBarX, healthBarY, healthFillWidth, healthBarHeight, healthBarRadius)
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

      drawRoundedRect(ctx, healthBarX, healthBarY, healthFillWidth, healthBarHeight, healthBarRadius)
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

  // Draw orb with glow (no shine)
  ctx.globalAlpha = opacity
  ctx.beginPath()
  ctx.arc(food.x, food.y, food.size, 0, Math.PI * 2)
  ctx.fillStyle = food.color
  ctx.shadowColor = food.color
  ctx.shadowBlur = food.size * 1.5
  ctx.fill()

  ctx.restore()
}

// Generate random premium orb
// Premium orb generation is now handled server-side

// Draw premium orb (octogon with glow, no internal shine)
const drawPremiumOrb = (ctx: CanvasRenderingContext2D, orb: PremiumOrb) => {
  ctx.save()

  // Calculate opacity and size based on absorption progress
  const opacity = orb.absorbing ? 1 - (orb.absorbProgress || 0) : 1
  const currentSize = orb.absorbing ? orb.originalSize! * (1 - (orb.absorbProgress || 0)) : orb.size

  ctx.globalAlpha = opacity

  // Move to orb position (absorption animation)
  const currentX = orb.absorbing
    ? orb.x + (orb.absorbTargetX! - orb.x) * (orb.absorbProgress || 0) * 0.15
    : orb.x
  const currentY = orb.absorbing
    ? orb.y + (orb.absorbTargetY! - orb.y) * (orb.absorbProgress || 0) * 0.15
    : orb.y

  ctx.translate(currentX, currentY)
  ctx.rotate(orb.rotation)

  // Enhanced glow effect (more than regular orbs)
  ctx.shadowColor = orb.color
  ctx.shadowBlur = currentSize * 2.5 // More glow than regular orbs (1.5x)

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

  // Fill with solid color (no gradient/shine like regular orbs)
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
  canvasHeight: number
) => {
  // Minimap configuration
  const minimapWidth = 180
  const minimapHeight = 180
  const minimapPadding = 20
  const minimapX = canvasWidth - minimapWidth - minimapPadding
  const minimapY = canvasHeight - minimapHeight - minimapPadding

  ctx.save()

  // Draw minimap background with clean, professional style
  ctx.fillStyle = 'rgba(15, 15, 30, 0.9)'
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)'
  ctx.lineWidth = 2

  // Rounded rectangle for minimap
  const radius = 12
  ctx.beginPath()
  ctx.moveTo(minimapX + radius, minimapY)
  ctx.lineTo(minimapX + minimapWidth - radius, minimapY)
  ctx.quadraticCurveTo(minimapX + minimapWidth, minimapY, minimapX + minimapWidth, minimapY + radius)
  ctx.lineTo(minimapX + minimapWidth, minimapY + minimapHeight - radius)
  ctx.quadraticCurveTo(minimapX + minimapWidth, minimapY + minimapHeight, minimapX + minimapWidth - radius, minimapY + minimapHeight)
  ctx.lineTo(minimapX + radius, minimapY + minimapHeight)
  ctx.quadraticCurveTo(minimapX, minimapY + minimapHeight, minimapX, minimapY + minimapHeight - radius)
  ctx.lineTo(minimapX, minimapY + radius)
  ctx.quadraticCurveTo(minimapX, minimapY, minimapX + radius, minimapY)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Draw map border inside minimap
  const mapPadding = 10
  const mapDisplayWidth = minimapWidth - mapPadding * 2
  const mapDisplayHeight = minimapHeight - mapPadding * 2
  const mapDisplayX = minimapX + mapPadding
  const mapDisplayY = minimapY + mapPadding

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)'
  ctx.lineWidth = 1
  const gridLines = 4
  for (let i = 1; i < gridLines; i++) {
    // Vertical lines
    const x = mapDisplayX + (mapDisplayWidth / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(x, mapDisplayY)
    ctx.lineTo(x, mapDisplayY + mapDisplayHeight)
    ctx.stroke()

    // Horizontal lines
    const y = mapDisplayY + (mapDisplayHeight / gridLines) * i
    ctx.beginPath()
    ctx.moveTo(mapDisplayX, y)
    ctx.lineTo(mapDisplayX + mapDisplayWidth, y)
    ctx.stroke()
  }

  // Calculate player position on minimap
  const playerMinimapX = mapDisplayX + (playerX / mapWidth) * mapDisplayWidth
  const playerMinimapY = mapDisplayY + (playerY / mapHeight) * mapDisplayHeight

  // Draw player indicator (pulsing dot)
  const pulseTime = Date.now() / 500
  const pulseSize = 4 + Math.sin(pulseTime) * 1.5

  // Outer glow
  ctx.shadowColor = '#00ffff'
  ctx.shadowBlur = 15
  ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'
  ctx.beginPath()
  ctx.arc(playerMinimapX, playerMinimapY, pulseSize + 4, 0, Math.PI * 2)
  ctx.fill()

  // Inner dot
  ctx.shadowBlur = 8
  ctx.fillStyle = '#00ffff'
  ctx.beginPath()
  ctx.arc(playerMinimapX, playerMinimapY, pulseSize, 0, Math.PI * 2)
  ctx.fill()

  // Reset shadow
  ctx.shadowBlur = 0

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

  // Draw container background
  drawRoundedRect(ctx, containerX, containerY, containerWidth, containerHeight, containerRadius)
  ctx.fillStyle = 'rgba(15, 15, 30, 0.95)'
  ctx.fill()

  // Container border - clean and steady
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

  // HP Bar fill
  const hpFillWidth = barWidth * (health / 100)
  if (hpFillWidth > 0) {
    ctx.save()
    drawRoundedRect(ctx, hpX, hpY, hpFillWidth, barHeight, barRadius)
    ctx.clip()

    // Single vibrant color based on health level
    let hpColor
    let hpGlowColor
    if (health > 60) {
      // High health - cyan
      hpColor = '#00d9ff'
      hpGlowColor = 'rgba(0, 217, 255, 0.9)'
    } else if (health > 30) {
      // Medium health - gold
      hpColor = '#ffd700'
      hpGlowColor = 'rgba(255, 215, 0, 0.9)'
    } else {
      // Low health - red
      hpColor = '#ff4444'
      hpGlowColor = 'rgba(255, 68, 68, 0.9)'
    }

    drawRoundedRect(ctx, hpX, hpY, hpFillWidth, barHeight, barRadius)
    ctx.fillStyle = hpColor
    ctx.fill()

    // Add strong glow effect
    ctx.shadowColor = hpGlowColor
    ctx.shadowBlur = 16
    ctx.fill()

    // Add glossy shine effect on top
    const shineGradient = ctx.createLinearGradient(hpX, hpY, hpX, hpY + barHeight / 2)
    shineGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)')
    shineGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    drawRoundedRect(ctx, hpX, hpY, hpFillWidth, barHeight / 2, barRadius)
    ctx.fillStyle = shineGradient
    ctx.shadowBlur = 0
    ctx.fill()

    ctx.restore()
  }

  // Vertical separator line
  const separatorX = innerX + barWidth + 15
  ctx.beginPath()
  ctx.moveTo(separatorX, innerY)
  ctx.lineTo(separatorX, innerY + barHeight + 28)
  const separatorGradient = ctx.createLinearGradient(separatorX, innerY, separatorX, innerY + barHeight + 28)
  separatorGradient.addColorStop(0, 'rgba(255, 255, 255, 0)')
  separatorGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.15)')
  separatorGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  ctx.strokeStyle = separatorGradient
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

  // Score Bar fill - always show full bar, just display the score number
  const scoreFillWidth = barWidth

  if (scoreFillWidth > 0) {
    ctx.save()
    drawRoundedRect(ctx, scoreX, scoreY, scoreFillWidth, barHeight, barRadius)
    ctx.clip()

    // Single vibrant gold color
    drawRoundedRect(ctx, scoreX, scoreY, scoreFillWidth, barHeight, barRadius)
    ctx.fillStyle = '#ffd700'
    ctx.fill()

    // Add strong glow effect
    ctx.shadowColor = 'rgba(255, 215, 0, 0.9)'
    ctx.shadowBlur = 16
    ctx.fill()

    // Add glossy shine effect on top
    const shineGradient = ctx.createLinearGradient(scoreX, scoreY, scoreX, scoreY + barHeight / 2)
    shineGradient.addColorStop(0, 'rgba(255, 255, 255, 0.4)')
    shineGradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
    drawRoundedRect(ctx, scoreX, scoreY, scoreFillWidth, barHeight / 2, barRadius)
    ctx.fillStyle = shineGradient
    ctx.shadowBlur = 0
    ctx.fill()

    ctx.restore()
  }

  ctx.restore()
}

function App() {
  const [displayName, setDisplayName] = useState('')
  const [gameState, setGameState] = useState<GameState>('menu')
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
      return
    }

    const canvas = canvasRef.current
    if (!canvas) return

    // Create background spikes only if we don't have any
    if (backgroundSpikesRef.current.length === 0) {
      const spikes: Player[] = []
      for (let i = 0; i < 15; i++) {
        spikes.push({
          id: `bg-${i}`,
          username: '',
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * PLAYER_SPEED,
          vy: (Math.random() - 0.5) * PLAYER_SPEED,
          size: PLAYER_SIZE,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.05,
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

      // Update and draw background spikes
      backgroundSpikesRef.current.forEach((spike) => {
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

        // Draw spike
        drawSpike(ctx, spike.x, spike.y, spike.size, spike.rotation, spike.color)
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
      }
    }
  }, [gameState])

  // Food and premium orbs are now initialized by the server in the 'init' event
  // No client-side initialization needed

  // Handle keyboard input (WASD + Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    }

    const handleKeyUp = (e: KeyboardEvent) => {
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
  }, [])

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
      console.log('Initialized with player ID:', data.playerId)
      console.log('Initial players:', data.players)
      console.log('Map config:', data.mapConfig)
      localPlayerIdRef.current = data.playerId
      mapConfigRef.current = data.mapConfig

      // Initialize players map
      playersRef.current.clear()
      playerScoresRef.current.clear()
      data.players.forEach((player) => {
        playersRef.current.set(player.id, player)
        // Use server-provided score
        playerScoresRef.current.set(player.id, (player as any).score || 0)
        console.log('Added player:', player.username, 'at position:', player.x, player.y)
      })

      // Initialize food from server
      foodRef.current = data.food || []

      // Initialize premium orbs from server
      premiumOrbsRef.current = data.premiumOrbs || []
    })

    socket.on('gameState', (data: { players: Player[]; food: Food[]; premiumOrbs: PremiumOrb[] }) => {
      // Update all players
      data.players.forEach((player) => {
        playersRef.current.set(player.id, player)
        // Update score from server
        playerScoresRef.current.set(player.id, (player as any).score || 0)
      })

      // Update food from server
      foodRef.current = data.food || []

      // Update premium orbs from server
      premiumOrbsRef.current = data.premiumOrbs || []

      // Debug: Log local player position occasionally
      if (Math.random() < 0.05 && localPlayerIdRef.current) {
        const localPlayer = playersRef.current.get(localPlayerIdRef.current)
        if (localPlayer) {
          console.log('Local player position:', localPlayer.x, localPlayer.y, 'velocity:', localPlayer.vx, localPlayer.vy)
        }
      }
    })

    socket.on('playerJoined', (player: Player) => {
      console.log('Player joined:', player.username)
      playersRef.current.set(player.id, player)
      playerScoresRef.current.set(player.id, (player as any).score || 0)
    })

    socket.on('playerLeft', (playerId: string) => {
      console.log('Player left:', playerId)
      playersRef.current.delete(playerId)
      playerScoresRef.current.delete(playerId)
    })

    // Handle food collection events
    socket.on('foodCollected', (data: { playerId: string; foodId: string; newFood: Food; newScore: number }) => {
      // Eating animation is now handled server-side
      // Just update player score for tracking
      playerScoresRef.current.set(data.playerId, data.newScore)
    })

    // Handle premium orb collection events
    socket.on('premiumOrbCollected', (data: { playerId: string; orbId: string; newOrb: PremiumOrb; newScore: number }) => {
      // Eating animation is now handled server-side

      // Add notification if it's the local player
      if (data.playerId === localPlayerIdRef.current) {
        notificationsRef.current.push({
          id: Math.random().toString(36).substring(2, 11),
          message: 'PREMIUM ORB COLLECTED',
          timestamp: Date.now(),
          opacity: 1
        })
      }

      // Update player score for tracking
      playerScoresRef.current.set(data.playerId, data.newScore)
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

      // Debug: Log input when keys are pressed
      if (input.up || input.down || input.left || input.right) {
        console.log('Sending input:', input)
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
    if (gameState !== 'playing') return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    console.log('Starting render loop')

    // Animation/rendering loop
    const render = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Get local player for camera
      const localPlayer = localPlayerIdRef.current
        ? playersRef.current.get(localPlayerIdRef.current)
        : null

      // Debug logging
      if (!localPlayer && localPlayerIdRef.current) {
        console.log('Waiting for player data... localPlayerId:', localPlayerIdRef.current)
        console.log('Players in map:', Array.from(playersRef.current.keys()))
      }

      // Default camera (top-left)
      let cameraX = 0
      let cameraY = 0

      // Calculate camera position (center on local player)
      if (localPlayer) {
        cameraX = localPlayer.x - canvas.width / 2
        cameraY = localPlayer.y - canvas.height / 2

        // Clamp camera to map boundaries
        const maxCameraX = Math.max(0, mapConfigRef.current.width - canvas.width)
        const maxCameraY = Math.max(0, mapConfigRef.current.height - canvas.height)
        cameraX = Math.max(0, Math.min(maxCameraX, cameraX))
        cameraY = Math.max(0, Math.min(maxCameraY, cameraY))
      }

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

      // Draw grid dots at intersections
      for (let x = startX; x <= endX; x += gridSize) {
        for (let y = startY; y <= endY; y += gridSize) {
          ctx.beginPath()
          ctx.arc(x, y, dotSize, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.15)'
          ctx.fill()

          // Add subtle glow to dots
          ctx.shadowColor = 'rgba(255, 255, 255, 0.3)'
          ctx.shadowBlur = 4
          ctx.fill()
          ctx.shadowBlur = 0
        }
      }

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

      // Draw map borders
      // Outer white border
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 5
      ctx.strokeRect(0, 0, mapConfigRef.current.width, mapConfigRef.current.height)

      // Inner red border
      ctx.strokeStyle = 'rgba(255, 70, 70, 0.5)'
      ctx.lineWidth = 2
      ctx.strokeRect(5, 5, mapConfigRef.current.width - 10, mapConfigRef.current.height - 10)

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

      // Draw all players
      const playerCount = playersRef.current.size
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
          player.health || 100 // Use server-provided health
        )
      })

      ctx.restore()

      // Draw status bars (HP and Score) in screen space
      const currentScore = localPlayer ? (localPlayer.score || 0) : 0
      const currentHealth = localPlayer ? (localPlayer.health || 100) : 100
      drawStatusBars(ctx, currentHealth, currentScore, canvas.width, canvas.height)

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

      // Debug: Log player count occasionally
      if (Math.random() < 0.01) {
        console.log('Rendering', playerCount, 'players. Local player:', localPlayer ? 'found' : 'not found')
      }

      animationFrameRef.current = requestAnimationFrame(render)
    }

    render()

    return () => {
      console.log('Stopping render loop')
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [gameState])

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

  return (
    <div className="app">
      <div className={`grid-background ${gameState === 'playing' ? 'hidden' : ''}`} />
      <canvas ref={canvasRef} className={`game-canvas ${gameState === 'playing' ? 'playing' : ''}`} />

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
    </div>
  )
}

export default App

