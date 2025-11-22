import { useState, useEffect } from 'react'
import './ServerSelector.css'

interface ServerInfo {
  name: string
  region: string
  url: string
  playerCount: number
  maxPlayers: number
  ping: number | null
  status: 'online' | 'offline' | 'checking'
}

interface ServerSelectorProps {
  onSelectServer: (serverUrl: string) => void
  onClose: () => void
}

const SERVERS: Omit<ServerInfo, 'playerCount' | 'ping' | 'status'>[] = [
  {
    name: 'US Server',
    region: 'North America',
    url: 'https://burrs.io',
    maxPlayers: 50
  },
  {
    name: 'EU Server',
    region: 'Europe',
    url: 'http://eu.burrs.io',
    maxPlayers: 50
  }
]

export function ServerSelector({ onSelectServer, onClose }: ServerSelectorProps) {
  const [servers, setServers] = useState<ServerInfo[]>(
    SERVERS.map(s => ({ ...s, playerCount: 0, ping: null, status: 'checking' as const }))
  )
  const [selectedServer, setSelectedServer] = useState<string | null>(null)

  useEffect(() => {
    // Fetch server status for all servers
    const fetchServerStatus = async () => {
      const updatedServers = await Promise.all(
        SERVERS.map(async (server) => {
          try {
            const startTime = Date.now()
            const response = await fetch(`${server.url}/api/game/status`, {
              method: 'GET',
              signal: AbortSignal.timeout(5000) // 5 second timeout
            })
            const ping = Date.now() - startTime

            if (response.ok) {
              const data = await response.json()
              return {
                ...server,
                playerCount: data.playerCount || 0,
                ping,
                status: 'online' as const
              }
            } else {
              return {
                ...server,
                playerCount: 0,
                ping: null,
                status: 'offline' as const
              }
            }
          } catch (error) {
            return {
              ...server,
              playerCount: 0,
              ping: null,
              status: 'offline' as const
            }
          }
        })
      )
      setServers(updatedServers)
    }

    fetchServerStatus()
    // Refresh every 10 seconds
    const interval = setInterval(fetchServerStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  const handleSelectServer = (serverUrl: string) => {
    setSelectedServer(serverUrl)
  }

  const handleConnect = () => {
    if (selectedServer) {
      onSelectServer(selectedServer)
    }
  }

  return (
    <div className="server-selector-overlay" onClick={onClose}>
      <div className="server-selector-panel" onClick={(e) => e.stopPropagation()}>
        <div className="server-selector-header">
          <h2>Select Server</h2>
          <button className="close-button" onClick={onClose}>×</button>
        </div>

        <div className="server-selector-content">
          {servers.map((server) => (
            <div
              key={server.url}
              className={`server-card ${selectedServer === server.url ? 'selected' : ''} ${server.status === 'offline' ? 'offline' : ''}`}
              onClick={() => server.status === 'online' && handleSelectServer(server.url)}
            >
              <div className="server-card-header">
                <div className="server-name-region">
                  <h3 className="server-name">{server.name}</h3>
                  <span className="server-region">{server.region}</span>
                </div>
                <div className={`server-status ${server.status}`}>
                  {server.status === 'checking' && '●'}
                  {server.status === 'online' && '●'}
                  {server.status === 'offline' && '●'}
                </div>
              </div>

              <div className="server-info">
                <div className="server-stat">
                  <span className="stat-label">Players</span>
                  <span className="stat-value">{server.playerCount}/{server.maxPlayers}</span>
                </div>
                <div className="server-stat">
                  <span className="stat-label">Ping</span>
                  <span className="stat-value">
                    {server.ping !== null ? `${server.ping}ms` : '—'}
                  </span>
                </div>
              </div>

              {server.status === 'offline' && (
                <div className="server-offline-message">Server Offline</div>
              )}
            </div>
          ))}
        </div>

        <button
          className="connect-button"
          onClick={handleConnect}
          disabled={!selectedServer}
        >
          Connect to Server
        </button>
      </div>
    </div>
  )
}

