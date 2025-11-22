// Audio Manager for burrs.io
// Handles all sound effects, background music, and audio settings

export interface AudioSettings {
  masterVolume: number // 0-1
  musicVolume: number // 0-1
  sfxVolume: number // 0-1
  musicEnabled: boolean
  sfxEnabled: boolean
  customMusicUrl: string
  musicSource: 'none' | 'youtube' | 'custom'
}

export type SoundEffect =
  | 'eatFood'
  | 'collision'
  | 'abilityUse'
  | 'evolution'
  | 'death'
  | 'boost'
  | 'uiClick'
  | 'chatMessage'
  | 'premiumOrb'
  | 'spawn'
  | 'killEnemy'

class AudioManager {
  private audioContext: AudioContext | null = null
  private settings: AudioSettings
  private musicElement: HTMLAudioElement | null = null
  private youtubePlayer: any = null
  private sfxCache: Map<SoundEffect, AudioBuffer> = new Map()
  private activeSounds: Set<AudioBufferSourceNode> = new Set()

  constructor() {
    // Load settings from localStorage or use defaults
    const savedSettings = localStorage.getItem('audioSettings')
    this.settings = savedSettings ? JSON.parse(savedSettings) : {
      masterVolume: 0.7,
      musicVolume: 0.5,
      sfxVolume: 0.8,
      musicEnabled: true,
      sfxEnabled: true,
      customMusicUrl: '',
      musicSource: 'none'
    }

    this.initAudioContext()
  }

  private initAudioContext() {
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    } catch (e) {
      console.error('Web Audio API not supported:', e)
    }
  }

  // Generate sound effects using Web Audio API (no external files needed)
  private generateSoundEffect(type: SoundEffect): AudioBuffer | null {
    if (!this.audioContext) return null

    const sampleRate = this.audioContext.sampleRate
    let duration = 0.2
    let buffer: AudioBuffer

    switch (type) {
      case 'eatFood':
        duration = 0.15
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const eatData = buffer.getChannelData(0)
        for (let i = 0; i < eatData.length; i++) {
          const t = i / sampleRate
          const freq = 800 + t * 400 // Rising pitch
          eatData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 10)
        }
        break

      case 'collision':
        duration = 0.1
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const collisionData = buffer.getChannelData(0)
        for (let i = 0; i < collisionData.length; i++) {
          const t = i / sampleRate
          collisionData[i] = (Math.random() * 2 - 1) * Math.exp(-t * 30) * 0.5
        }
        break

      case 'abilityUse':
        duration = 0.3
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const abilityData = buffer.getChannelData(0)
        for (let i = 0; i < abilityData.length; i++) {
          const t = i / sampleRate
          const freq = 400 + Math.sin(t * 20) * 200
          abilityData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 5) * 0.7
        }
        break

      case 'evolution':
        duration = 0.5
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const evolveData = buffer.getChannelData(0)
        for (let i = 0; i < evolveData.length; i++) {
          const t = i / sampleRate
          const freq = 200 + t * 800 // Rising sweep
          evolveData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 3) * 0.8
        }
        break

      case 'death':
        duration = 0.6
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const deathData = buffer.getChannelData(0)
        for (let i = 0; i < deathData.length; i++) {
          const t = i / sampleRate
          const freq = 600 - t * 500 // Falling pitch
          deathData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 2) * 0.6
        }
        break

      case 'boost':
        duration = 0.25
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const boostData = buffer.getChannelData(0)
        for (let i = 0; i < boostData.length; i++) {
          const t = i / sampleRate
          const freq = 300 + t * 600
          boostData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 8) * 0.7
        }
        break

      case 'uiClick':
        duration = 0.05
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const clickData = buffer.getChannelData(0)
        for (let i = 0; i < clickData.length; i++) {
          const t = i / sampleRate
          clickData[i] = Math.sin(2 * Math.PI * 1000 * t) * Math.exp(-t * 50) * 0.3
        }
        break

      case 'chatMessage':
        duration = 0.1
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const chatData = buffer.getChannelData(0)
        for (let i = 0; i < chatData.length; i++) {
          const t = i / sampleRate
          chatData[i] = Math.sin(2 * Math.PI * 600 * t) * Math.exp(-t * 20) * 0.4
        }
        break

      case 'premiumOrb':
        duration = 0.4
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const orbData = buffer.getChannelData(0)
        for (let i = 0; i < orbData.length; i++) {
          const t = i / sampleRate
          const freq = 500 + Math.sin(t * 30) * 300
          orbData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 4) * 0.8
        }
        break

      case 'spawn':
        duration = 0.3
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const spawnData = buffer.getChannelData(0)
        for (let i = 0; i < spawnData.length; i++) {
          const t = i / sampleRate
          const freq = 200 + t * 400
          spawnData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 6) * 0.6
        }
        break

      case 'killEnemy':
        duration = 0.35
        buffer = this.audioContext.createBuffer(1, sampleRate * duration, sampleRate)
        const killData = buffer.getChannelData(0)
        for (let i = 0; i < killData.length; i++) {
          const t = i / sampleRate
          const freq = 800 - t * 300
          killData[i] = Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 5) * 0.7
        }
        break

      default:
        return null
    }

    return buffer
  }

  // Play a sound effect
  playSFX(type: SoundEffect, volume: number = 1.0) {
    if (!this.settings.sfxEnabled || !this.audioContext) return

    // Resume audio context if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    // Get or generate sound effect
    let buffer = this.sfxCache.get(type)
    if (!buffer) {
      const generatedBuffer = this.generateSoundEffect(type)
      if (generatedBuffer) {
        this.sfxCache.set(type, generatedBuffer)
        buffer = generatedBuffer
      }
    }

    if (!buffer) return

    // Create and play sound
    const source = this.audioContext.createBufferSource()
    source.buffer = buffer

    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = this.settings.masterVolume * this.settings.sfxVolume * volume

    source.connect(gainNode)
    gainNode.connect(this.audioContext.destination)

    source.start(0)
    this.activeSounds.add(source)

    source.onended = () => {
      this.activeSounds.delete(source)
    }
  }

  // Start background music
  startMusic() {
    if (!this.settings.musicEnabled) return

    if (this.settings.musicSource === 'youtube' && this.settings.customMusicUrl) {
      this.startYouTubeMusic()
    } else if (this.settings.musicSource === 'custom' && this.settings.customMusicUrl) {
      this.startCustomMusic()
    }
  }

  // Stop background music
  stopMusic() {
    if (this.musicElement) {
      this.musicElement.pause()
      this.musicElement = null
    }

    if (this.youtubePlayer) {
      this.youtubePlayer.stopVideo()
      this.youtubePlayer = null
    }
  }

  // Start YouTube music
  private startYouTubeMusic() {
    // Extract video ID from YouTube URL
    const videoId = this.extractYouTubeVideoId(this.settings.customMusicUrl)
    if (!videoId) {
      console.error('Invalid YouTube URL')
      return
    }

    // Load YouTube IFrame API if not already loaded
    if (!(window as any).YT) {
      const tag = document.createElement('script')
      tag.src = 'https://www.youtube.com/iframe_api'
      const firstScriptTag = document.getElementsByTagName('script')[0]
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag)

      // Wait for API to load
      ;(window as any).onYouTubeIframeAPIReady = () => {
        this.createYouTubePlayer(videoId)
      }
    } else {
      this.createYouTubePlayer(videoId)
    }
  }

  private createYouTubePlayer(videoId: string) {
    // Create hidden div for YouTube player
    let playerDiv = document.getElementById('youtube-player')
    if (!playerDiv) {
      playerDiv = document.createElement('div')
      playerDiv.id = 'youtube-player'
      playerDiv.style.display = 'none'
      document.body.appendChild(playerDiv)
    }

    const YT = (window as any).YT
    this.youtubePlayer = new YT.Player('youtube-player', {
      height: '0',
      width: '0',
      videoId: videoId,
      playerVars: {
        autoplay: 1,
        loop: 1,
        playlist: videoId, // Required for looping
        controls: 0,
      },
      events: {
        onReady: (event: any) => {
          event.target.setVolume(this.settings.masterVolume * this.settings.musicVolume * 100)
          event.target.playVideo()
        },
      },
    })
  }

  private extractYouTubeVideoId(url: string): string | null {
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
      /^([a-zA-Z0-9_-]{11})$/, // Direct video ID
    ]

    for (const pattern of patterns) {
      const match = url.match(pattern)
      if (match) return match[1]
    }

    return null
  }

  // Start custom music from URL
  private startCustomMusic() {
    if (this.musicElement) {
      this.musicElement.pause()
    }

    this.musicElement = new Audio(this.settings.customMusicUrl)
    this.musicElement.loop = true
    this.musicElement.volume = this.settings.masterVolume * this.settings.musicVolume

    this.musicElement.play().catch((error) => {
      console.error('Failed to play custom music:', error)
    })
  }

  // Update settings
  updateSettings(newSettings: Partial<AudioSettings>) {
    this.settings = { ...this.settings, ...newSettings }
    localStorage.setItem('audioSettings', JSON.stringify(this.settings))

    // Update music volume if playing
    if (this.musicElement) {
      this.musicElement.volume = this.settings.masterVolume * this.settings.musicVolume
    }

    if (this.youtubePlayer && this.youtubePlayer.setVolume) {
      this.youtubePlayer.setVolume(this.settings.masterVolume * this.settings.musicVolume * 100)
    }

    // Restart music if source changed
    if (newSettings.musicSource || newSettings.customMusicUrl) {
      this.stopMusic()
      if (this.settings.musicEnabled) {
        this.startMusic()
      }
    }

    // Stop music if disabled
    if (newSettings.musicEnabled === false) {
      this.stopMusic()
    } else if (newSettings.musicEnabled === true && !this.musicElement && !this.youtubePlayer) {
      this.startMusic()
    }
  }

  // Get current settings
  getSettings(): AudioSettings {
    return { ...this.settings }
  }

  // Cleanup
  destroy() {
    this.stopMusic()
    this.activeSounds.forEach(source => source.stop())
    this.activeSounds.clear()
    if (this.audioContext) {
      this.audioContext.close()
    }
  }
}

// Export singleton instance
export const audioManager = new AudioManager()
