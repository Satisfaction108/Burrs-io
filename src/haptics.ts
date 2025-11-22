// Haptic feedback utility for mobile devices

export type HapticType = 'light' | 'medium' | 'heavy' | 'selection' | 'impact' | 'success' | 'warning' | 'error'

class HapticManager {
  private isSupported: boolean = false

  constructor() {
    // Check if Vibration API is supported
    this.isSupported = 'vibrate' in navigator
  }

  /**
   * Trigger haptic feedback
   * @param type - Type of haptic feedback
   */
  trigger(type: HapticType = 'light') {
    if (!this.isSupported) return

    // Different vibration patterns for different types
    const patterns: Record<HapticType, number | number[]> = {
      light: 10,
      medium: 20,
      heavy: 30,
      selection: 5,
      impact: [10, 5, 10],
      success: [10, 5, 10, 5, 10],
      warning: [20, 10, 20],
      error: [30, 10, 30, 10, 30],
    }

    const pattern = patterns[type]
    
    try {
      if (Array.isArray(pattern)) {
        navigator.vibrate(pattern)
      } else {
        navigator.vibrate(pattern)
      }
    } catch (error) {
      // Silently fail if vibration is not supported or blocked
      console.debug('Haptic feedback failed:', error)
    }
  }

  /**
   * Cancel any ongoing vibration
   */
  cancel() {
    if (this.isSupported) {
      navigator.vibrate(0)
    }
  }

  /**
   * Check if haptic feedback is supported
   */
  isHapticSupported(): boolean {
    return this.isSupported
  }
}

export const hapticManager = new HapticManager()

