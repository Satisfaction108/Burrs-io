import { useState, useEffect } from 'react'
import { audioManager, AudioSettings as AudioSettingsType } from './AudioManager'
import './AudioSettings.css'

interface AudioSettingsProps {
  onClose: () => void
}

export function AudioSettings({ onClose }: AudioSettingsProps) {
  const [settings, setSettings] = useState<AudioSettingsType>(audioManager.getSettings())
  const [isLoadingMusic, setIsLoadingMusic] = useState(false)

  const handleSettingChange = (key: keyof AudioSettingsType, value: any) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    audioManager.updateSettings({ [key]: value })
  }

  const handleMusicSourceChange = (source: 'none' | 'youtube' | 'custom') => {
    handleSettingChange('musicSource', source)
  }

  const handleUrlChange = (url: string) => {
    handleSettingChange('customMusicUrl', url)
  }

  const handleApplyMusic = async () => {
    setIsLoadingMusic(true)
    audioManager.updateSettings({
      customMusicUrl: settings.customMusicUrl,
      musicSource: settings.musicSource
    })

    // Give it a moment to load
    setTimeout(() => {
      setIsLoadingMusic(false)
    }, 1500)
  }

  return (
    <div className="audio-settings-overlay" onClick={onClose}>
      <div className="audio-settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="audio-settings-header">
          <h2>Audio Settings</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="audio-settings-content">
          {/* Master Volume */}
          <div className="setting-group">
            <label>
              <span className="setting-label">Master Volume</span>
              <span className="setting-value">{Math.round(settings.masterVolume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.masterVolume * 100}
              onChange={(e) => handleSettingChange('masterVolume', parseInt(e.target.value) / 100)}
              className="volume-slider"
            />
          </div>

          {/* Music Volume */}
          <div className="setting-group">
            <label>
              <span className="setting-label">Music Volume</span>
              <span className="setting-value">{Math.round(settings.musicVolume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.musicVolume * 100}
              onChange={(e) => handleSettingChange('musicVolume', parseInt(e.target.value) / 100)}
              className="volume-slider"
            />
          </div>

          {/* SFX Volume */}
          <div className="setting-group">
            <label>
              <span className="setting-label">SFX Volume</span>
              <span className="setting-value">{Math.round(settings.sfxVolume * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={settings.sfxVolume * 100}
              onChange={(e) => handleSettingChange('sfxVolume', parseInt(e.target.value) / 100)}
              className="volume-slider"
            />
          </div>

          {/* Toggle Switches */}
          <div className="setting-group toggle-group">
            <label className="toggle-label">
              <span>Enable Music</span>
              <input
                type="checkbox"
                checked={settings.musicEnabled}
                onChange={(e) => handleSettingChange('musicEnabled', e.target.checked)}
                className="toggle-checkbox"
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          <div className="setting-group toggle-group">
            <label className="toggle-label">
              <span>Enable SFX</span>
              <input
                type="checkbox"
                checked={settings.sfxEnabled}
                onChange={(e) => handleSettingChange('sfxEnabled', e.target.checked)}
                className="toggle-checkbox"
              />
              <span className="toggle-slider"></span>
            </label>
          </div>

          {/* Music Source Selection */}
          <div className="setting-group">
            <label className="setting-label">Background Music Source</label>
            <div className="music-source-buttons">
              <button
                className={`source-button ${settings.musicSource === 'none' ? 'active' : ''}`}
                onClick={() => handleMusicSourceChange('none')}
              >
                None
              </button>
              <button
                className={`source-button ${settings.musicSource === 'youtube' ? 'active' : ''}`}
                onClick={() => handleMusicSourceChange('youtube')}
              >
                YouTube
              </button>
              <button
                className={`source-button ${settings.musicSource === 'custom' ? 'active' : ''}`}
                onClick={() => handleMusicSourceChange('custom')}
              >
                Custom URL
              </button>
            </div>
          </div>

          {/* Music URL Input */}
          {(settings.musicSource === 'youtube' || settings.musicSource === 'custom') && (
            <div className="setting-group">
              <label className="setting-label">
                {settings.musicSource === 'youtube' ? 'YouTube URL or Video ID' : 'Music URL (MP3, OGG, etc.)'}
              </label>
              <input
                type="text"
                value={settings.customMusicUrl}
                onChange={(e) => setSettings({ ...settings, customMusicUrl: e.target.value })}
                placeholder={settings.musicSource === 'youtube' ? 'https://youtube.com/watch?v=...' : 'https://example.com/music.mp3'}
                className="url-input"
              />
              <button className="apply-button" onClick={handleApplyMusic} disabled={isLoadingMusic}>
                {isLoadingMusic ? 'Loading...' : 'Apply Music'}
              </button>
              {isLoadingMusic && (
                <div className="loading-indicator">Loading music...</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

