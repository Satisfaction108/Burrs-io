// Customization definitions for nametags and spikes (client-side)

export interface NametagStyle {
  backgroundColor: string
  color: string
  border: string
  textShadow: string
  fontWeight: string
  boxShadow?: string
  animation?: string
}

export interface SpikeEffect {
  type: 'none' | 'glow' | 'trail' | 'particles' | 'electric' | 'cosmic'
  color?: string
  intensity?: number
  length?: number
  opacity?: number
  count?: number
  speed?: number
  bolts?: number
  colors?: string[]
  rotation?: boolean
}

export interface NametagCustomization {
  id: string
  name: string
  description: string
  price: number
  style: NametagStyle
}

export interface SpikeCustomization {
  id: string
  name: string
  description: string
  price: number
  effect: SpikeEffect
}

export const NAMETAG_CUSTOMIZATIONS: NametagCustomization[] = [
  {
    id: 'nametag_default',
    name: 'Default',
    description: 'Standard nametag',
    price: 0,
    style: {
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      color: '#ffffff',
      border: 'none',
      textShadow: '0 0 5px rgba(0, 0, 0, 0.8)',
      fontWeight: 'bold'
    }
  },
  {
    id: 'nametag_neon_cyan',
    name: 'Neon Cyan',
    description: 'Glowing cyan nametag',
    price: 50,
    style: {
      backgroundColor: 'rgba(0, 212, 255, 0.2)',
      color: '#00ffff',
      border: '2px solid #00ffff',
      textShadow: '0 0 10px rgba(0, 255, 255, 0.8)',
      fontWeight: 'bold',
      boxShadow: '0 0 15px rgba(0, 255, 255, 0.6)'
    }
  },
  {
    id: 'nametag_gold',
    name: 'Golden',
    description: 'Luxurious gold nametag',
    price: 125,
    style: {
      backgroundColor: 'rgba(255, 215, 0, 0.2)',
      color: '#FFD700',
      border: '2px solid #FFD700',
      textShadow: '0 0 10px rgba(255, 215, 0, 0.8)',
      fontWeight: 'bold',
      boxShadow: '0 0 15px rgba(255, 215, 0, 0.6)'
    }
  },
  {
    id: 'nametag_fire',
    name: 'Fire',
    description: 'Blazing fire effect',
    price: 250,
    style: {
      backgroundColor: 'rgba(255, 69, 0, 0.3)',
      color: '#ff4500',
      border: '2px solid #ff6600',
      textShadow: '0 0 10px rgba(255, 69, 0, 1), 0 0 20px rgba(255, 140, 0, 0.8)',
      fontWeight: 'bold',
      boxShadow: '0 0 20px rgba(255, 69, 0, 0.8)'
    }
  },
  {
    id: 'nametag_rainbow',
    name: 'Rainbow',
    description: 'Animated rainbow gradient',
    price: 500,
    style: {
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      color: '#ffffff',
      border: '2px solid transparent',
      textShadow: '0 0 10px rgba(255, 255, 255, 0.8)',
      fontWeight: 'bold',
      boxShadow: '0 0 15px rgba(255, 255, 255, 0.5)',
      animation: 'rainbow'
    }
  },
  {
    id: 'nametag_diamond',
    name: 'Diamond',
    description: 'Sparkling diamond effect',
    price: 1250,
    style: {
      backgroundColor: 'rgba(185, 242, 255, 0.3)',
      color: '#b9f2ff',
      border: '3px solid #b9f2ff',
      textShadow: '0 0 15px rgba(185, 242, 255, 1), 0 0 30px rgba(255, 255, 255, 0.8)',
      fontWeight: 'bold',
      boxShadow: '0 0 25px rgba(185, 242, 255, 0.9), inset 0 0 15px rgba(255, 255, 255, 0.5)'
    }
  }
]

export const SPIKE_CUSTOMIZATIONS: SpikeCustomization[] = [
  {
    id: 'spike_default',
    name: 'Default',
    description: 'Standard spike appearance',
    price: 0,
    effect: {
      type: 'none'
    }
  },
  {
    id: 'spike_glow',
    name: 'Neon Glow',
    description: 'Glowing neon outline',
    price: 75,
    effect: {
      type: 'glow',
      color: '#00ffff',
      intensity: 15
    }
  },
  {
    id: 'spike_trail',
    name: 'Motion Trail',
    description: 'Leaves a trail when moving',
    price: 150,
    effect: {
      type: 'trail',
      color: '#ff00ff',
      length: 10,
      opacity: 0.6
    }
  },
  {
    id: 'spike_particles',
    name: 'Particle Effect',
    description: 'Emits glowing particles',
    price: 375,
    effect: {
      type: 'particles',
      color: '#ffff00',
      count: 5,
      speed: 2
    }
  },
  {
    id: 'spike_electric',
    name: 'Electric',
    description: 'Crackling electricity effect',
    price: 750,
    effect: {
      type: 'electric',
      color: '#00d4ff',
      bolts: 3,
      intensity: 0.8
    }
  },
  {
    id: 'spike_cosmic',
    name: 'Cosmic',
    description: 'Swirling cosmic energy',
    price: 1500,
    effect: {
      type: 'cosmic',
      colors: ['#b000ff', '#ff00ff', '#00ffff'],
      rotation: true,
      intensity: 1.0
    }
  }
]

// Helper function to get customization by ID
export function getNametagById(id: string): NametagCustomization | null {
  return NAMETAG_CUSTOMIZATIONS.find(c => c.id === id) || null
}

export function getSpikeById(id: string): SpikeCustomization | null {
  return SPIKE_CUSTOMIZATIONS.find(c => c.id === id) || null
}

