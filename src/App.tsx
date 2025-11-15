import { useState, useEffect, useRef } from 'react'
import './App.css'

interface Spike {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rotation: number // Current rotation angle in radians
  rotationSpeed: number // Angular velocity in radians per frame
  color: string // Color of the spike body
}

// Generate a random vibrant color
const generateRandomColor = (): string => {
  const colors = [
    '#FF6B6B', // Red
    '#4ECDC4', // Cyan
    '#45B7D1', // Blue
    '#FFA07A', // Light Salmon
    '#98D8C8', // Mint
    '#F7DC6F', // Yellow
    '#BB8FCE', // Purple
    '#85C1E2', // Sky Blue
    '#F8B739', // Orange
    '#52C77A', // Green
    '#FF85A2', // Pink
    '#A8E6CF', // Light Green
  ]
  return colors[Math.floor(Math.random() * colors.length)]
}

// Generate initial spike data and persist in sessionStorage
const generateSpikes = (canvasWidth: number, canvasHeight: number): Spike[] => {
  return Array.from({ length: 8 }).map(() => {
    // Random position in the middle area
    const x = canvasWidth * 0.2 + Math.random() * canvasWidth * 0.6
    const y = canvasHeight * 0.2 + Math.random() * canvasHeight * 0.6

    // Random velocity for movement
    const angle = Math.random() * Math.PI * 2
    const speed = 0.5 + Math.random() * 1.5
    const vx = Math.cos(angle) * speed
    const vy = Math.sin(angle) * speed

    // Random initial rotation, but same slow rotation speed for all
    const rotation = Math.random() * Math.PI * 2
    const rotationSpeed = 0.015 // Fixed slow rotation speed (clockwise)

    // Random vibrant color
    const color = generateRandomColor()

    return {
      x,
      y,
      vx,
      vy,
      size: 18, // Radius of the spike body
      rotation,
      rotationSpeed,
      color
    }
  })
}

// Version number for spike data format - increment when format changes
const SPIKE_DATA_VERSION = 3

// Load or generate spikes
const initializeSpikes = (canvasWidth: number, canvasHeight: number): Spike[] => {
  const stored = sessionStorage.getItem('canvasSpikes')
  const storedVersion = sessionStorage.getItem('canvasSpikesVersion')

  if (stored && storedVersion === String(SPIKE_DATA_VERSION)) {
    try {
      const parsed = JSON.parse(stored)
      console.log('Loaded spikes from sessionStorage (version ' + SPIKE_DATA_VERSION + ')')
      return parsed
    } catch (e) {
      console.log('Error parsing stored spikes, regenerating...')
    }
  } else {
    if (stored) {
      console.log('Spike data version mismatch, regenerating...')
    }
  }

  const spikes = generateSpikes(canvasWidth, canvasHeight)
  sessionStorage.setItem('canvasSpikes', JSON.stringify(spikes))
  sessionStorage.setItem('canvasSpikesVersion', String(SPIKE_DATA_VERSION))
  console.log('Generated new spikes (version ' + SPIKE_DATA_VERSION + '):', spikes)
  return spikes
}

// Handle collision between two spikes
const handleSpikeCollision = (spike1: Spike, spike2: Spike) => {
  const dx = spike2.x - spike1.x
  const dy = spike2.y - spike1.y
  const distance = Math.sqrt(dx * dx + dy * dy)
  const minDistance = (spike1.size + 10) + (spike2.size + 10) // Both radii including thorns

  if (distance < minDistance && distance > 0) {
    // Normalize the collision vector
    const nx = dx / distance
    const ny = dy / distance

    // Calculate relative velocity
    const dvx = spike2.vx - spike1.vx
    const dvy = spike2.vy - spike1.vy

    // Calculate relative velocity in collision normal direction
    const dvn = dvx * nx + dvy * ny

    // Only resolve if spikes are moving towards each other
    if (dvn < 0) {
      // Elastic collision response (equal mass)
      const impulse = dvn

      // Update velocities (bounce away from each other)
      spike1.vx += impulse * nx
      spike1.vy += impulse * ny
      spike2.vx -= impulse * nx
      spike2.vy -= impulse * ny

      // Separate the spikes to prevent overlap
      const overlap = minDistance - distance
      const separationX = (overlap / 2) * nx
      const separationY = (overlap / 2) * ny

      spike1.x -= separationX
      spike1.y -= separationY
      spike2.x += separationX
      spike2.y += separationY
    }
  }
}

// Draw a single spike (body + thorns) on the canvas
const drawSpike = (ctx: CanvasRenderingContext2D, spike: Spike) => {
  const { x, y, size, rotation, color } = spike

  // Enable anti-aliasing for smoother rendering
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  // Save the current context state
  ctx.save()

  // Translate to spike position and apply rotation
  ctx.translate(x, y)
  ctx.rotate(rotation)

  // Draw 8 thorns radiating from the center
  const numThorns = 8
  const thornLength = 10
  const thornWidth = 4

  for (let i = 0; i < numThorns; i++) {
    const angle = (i * Math.PI * 2) / numThorns
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)

    // Calculate thorn positions (relative to center at 0,0)
    const baseX = cos * size
    const baseY = sin * size
    const tipX = cos * (size + thornLength)
    const tipY = sin * (size + thornLength)

    // All thorns are white
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.moveTo(tipX, tipY)
    const perpAngle = angle + Math.PI / 2
    ctx.lineTo(baseX + Math.cos(perpAngle) * thornWidth, baseY + Math.sin(perpAngle) * thornWidth)
    ctx.lineTo(baseX - Math.cos(perpAngle) * thornWidth, baseY - Math.sin(perpAngle) * thornWidth)
    ctx.closePath()
    ctx.fill()
  }

  // Draw colored circular body on top (centered at 0,0)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(0, 0, size, 0, Math.PI * 2)
  ctx.fill()

  // Restore the context state
  ctx.restore()
}

function App() {
  const [displayName, setDisplayName] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spikesRef = useRef<Spike[]>([])
  const animationFrameRef = useRef<number>()

  // Initialize canvas and spikes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Set canvas size to window size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener('resize', resizeCanvas)

    // Initialize spikes if not already loaded
    if (spikesRef.current.length === 0) {
      spikesRef.current = initializeSpikes(canvas.width, canvas.height)
    }

    // Save to sessionStorage periodically (every 2 seconds)
    let lastSaveTime = Date.now()
    const saveInterval = 2000 // 2 seconds

    // Animation loop
    const animate = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Update positions and rotations
      spikesRef.current.forEach(spike => {
        // Update position
        spike.x += spike.vx
        spike.y += spike.vy

        // Update rotation
        spike.rotation += spike.rotationSpeed

        // Bounce off walls (account for thorns extending beyond body)
        const totalSize = spike.size + 10 // body radius + thorn length
        if (spike.x - totalSize < 0 || spike.x + totalSize > canvas.width) {
          spike.vx *= -1
          spike.x = Math.max(totalSize, Math.min(canvas.width - totalSize, spike.x))
        }
        if (spike.y - totalSize < 0 || spike.y + totalSize > canvas.height) {
          spike.vy *= -1
          spike.y = Math.max(totalSize, Math.min(canvas.height - totalSize, spike.y))
        }
      })

      // Check for spike-to-spike collisions
      for (let i = 0; i < spikesRef.current.length; i++) {
        for (let j = i + 1; j < spikesRef.current.length; j++) {
          handleSpikeCollision(spikesRef.current[i], spikesRef.current[j])
        }
      }

      // Draw all spikes
      spikesRef.current.forEach(spike => {
        drawSpike(ctx, spike)
      })

      // Save to sessionStorage periodically
      const now = Date.now()
      if (now - lastSaveTime > saveInterval) {
        sessionStorage.setItem('canvasSpikes', JSON.stringify(spikesRef.current))
        lastSaveTime = now
      }

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(animate)
    }

    // Start animation
    animate()

    // Cleanup - save final state
    return () => {
      window.removeEventListener('resize', resizeCanvas)
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
      }
      // Save final positions on unmount
      sessionStorage.setItem('canvasSpikes', JSON.stringify(spikesRef.current))
    }
  }, [])

  const handlePlay = () => {
    if (displayName.trim()) {
      console.log('Starting game with name:', displayName)
      // Game logic will go here
    }
  }

  return (
    <div className="app">
      <div className="grid-background" />
      <canvas ref={canvasRef} className="game-canvas" />

      <div className="content">
        <h1 className="title">rammer.io</h1>
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
            disabled={!displayName.trim()}
          >
            Play
          </button>
        </div>
      </div>
    </div>
  )
}

export default App

