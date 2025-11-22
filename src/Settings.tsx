import { useState, useEffect } from 'react'
import { audioManager } from './AudioManager'
import './Settings.css'

export interface KeyBindings {
  moveUp: string
  moveDown: string
  moveLeft: string
  moveRight: string
  speedBoost: string
  specialAbility: string
  chat: string
  afkToggle: string
  controlsGuide: string
}

const DEFAULT_KEYBINDINGS: KeyBindings = {
  moveUp: 'w',
  moveDown: 's',
  moveLeft: 'a',
  moveRight: 'd',
  speedBoost: 'b',
  specialAbility: 'n',
  chat: 'Enter',
  afkToggle: 'o',
  controlsGuide: 'h',
}

interface SettingsProps {
  onClose: () => void
  onKeybindingsChange: (keybindings: KeyBindings) => void
}

export function Settings({ onClose, onKeybindingsChange }: SettingsProps) {
  const [keybindings, setKeybindings] = useState<KeyBindings>(() => {
    const saved = localStorage.getItem('keybindings')
    return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS
  })
  const [editingKey, setEditingKey] = useState<keyof KeyBindings | null>(null)

  useEffect(() => {
    if (editingKey) {
      const handleKeyPress = (e: KeyboardEvent) => {
        e.preventDefault()
        const key = e.key.toLowerCase()
        
        // Don't allow Escape (used to cancel)
        if (key === 'escape') {
          setEditingKey(null)
          return
        }

        // Update the keybinding
        const newKeybindings = { ...keybindings, [editingKey]: key }
        setKeybindings(newKeybindings)
        localStorage.setItem('keybindings', JSON.stringify(newKeybindings))
        onKeybindingsChange(newKeybindings)
        setEditingKey(null)
        audioManager.playSFX('uiClick')
      }

      window.addEventListener('keydown', handleKeyPress)
      return () => window.removeEventListener('keydown', handleKeyPress)
    }
  }, [editingKey, keybindings, onKeybindingsChange])

  const resetToDefaults = () => {
    setKeybindings(DEFAULT_KEYBINDINGS)
    localStorage.setItem('keybindings', JSON.stringify(DEFAULT_KEYBINDINGS))
    onKeybindingsChange(DEFAULT_KEYBINDINGS)
    audioManager.playSFX('uiClick')
  }

  const getKeyDisplay = (key: string) => {
    if (key === 'Enter') return '↵ Enter'
    if (key === ' ') return 'Space'
    if (key === 'Escape') return 'Esc'
    return key.toUpperCase()
  }

  const keyLabels: Record<keyof KeyBindings, string> = {
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    moveLeft: 'Move Left',
    moveRight: 'Move Right',
    speedBoost: 'Speed Boost',
    specialAbility: 'Special Ability',
    chat: 'Open Chat',
    afkToggle: 'Toggle AFK',
    controlsGuide: 'Controls Guide',
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="settings-content">
          <div className="settings-section">
            <h3 className="section-title">Keybindings</h3>
            <p className="section-description">Click on a key to rebind it. Press ESC to cancel.</p>
            
            <div className="keybindings-list">
              {(Object.keys(keybindings) as Array<keyof KeyBindings>).map((key) => (
                <div key={key} className="keybinding-row">
                  <span className="keybinding-label">{keyLabels[key]}</span>
                  <button
                    className={`keybinding-button ${editingKey === key ? 'editing' : ''}`}
                    onClick={() => {
                      setEditingKey(key)
                      audioManager.playSFX('uiClick')
                    }}
                  >
                    {editingKey === key ? 'Press any key...' : getKeyDisplay(keybindings[key])}
                  </button>
                </div>
              ))}
            </div>

            <button className="reset-button" onClick={resetToDefaults}>
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function getKeybindings(): KeyBindings {
  const saved = localStorage.getItem('keybindings')
  return saved ? JSON.parse(saved) : DEFAULT_KEYBINDINGS
}

