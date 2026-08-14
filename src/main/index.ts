import { app, BrowserWindow, shell, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from './lib/electron-utils'
import { initDb, startDbMaintenance, checkpointTruncate } from './db/index'
import { startRetentionTimers } from './db/maintenance'
import { settings, SettingsKeys } from './lib/settings'
import { appState } from './app/appState'
import { screenRecorder } from './recording/recorder'
import { pauseManager } from './recording/pauseManager'
import { analysisManager } from './analysis/analysisManager'
import { registerLLMService } from './providers/llmService'
import { registerIpcHandlers } from './ipc/handlers'
import { createTray } from './app/tray'

let mainWindow: BrowserWindow | null = null
let allowTermination = false

// Local media (screenshots/timelapses) served over a custom scheme so the
// renderer can display them without file:// access.
protocol.registerSchemesAsPrivileged([
  { scheme: 'dayflow-media', privileges: { standard: false, secure: true, stream: true } }
])

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1195,
    height: 675,
    minWidth: 900,
    minHeight: 508,
    show: false,
    autoHideMenuBar: true,
    title: 'Dayflow',
    backgroundColor: '#FAF5ED',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#00000000', symbolColor: '#5f5f5f', height: 36 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Soft quit: closing hides to tray; background work continues.
  mainWindow.on('close', (e) => {
    if (!allowTermination) {
      e.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

function handleDeepLink(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol.replace(':', '').toLowerCase() !== 'dayflow') return
    const candidates = [parsed.host, ...parsed.pathname.split('/').filter(Boolean)]
    const action = (candidates[0] ?? parsed.searchParams.get('action') ?? '').toLowerCase()
    if (['start-recording', 'start', 'resume'].includes(action)) {
      pauseManager.clearPauseState()
      appState.setRecording(true, { analyticsReason: 'deeplink' })
    } else if (['stop-recording', 'stop', 'pause'].includes(action)) {
      pauseManager.clearPauseState()
      appState.setRecording(false, { analyticsReason: 'deeplink' })
    }
    broadcast('recording:changed')
  } catch {
    /* ignore malformed URLs */
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    const link = argv.find((a) => a.toLowerCase().startsWith('dayflow://'))
    if (link) handleDeepLink(link)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    electronApp.setAppUserModelId('so.dayflow.windows')
    app.setAsDefaultProtocolClient('dayflow')

    protocol.handle('dayflow-media', (request) => {
      const filePath = decodeURIComponent(request.url.replace('dayflow-media://', ''))
      return net.fetch(pathToFileURL(filePath).toString())
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // ----- Startup sequence (parity with upstream AppDelegate) -----
    initDb()
    startDbMaintenance()
    startRetentionTimers()
    registerLLMService()
    registerIpcHandlers(broadcast)

    createMainWindow()
    createTray(
      () => mainWindow,
      () => {
        allowTermination = true
      }
    )

    // Recorder reacts to the recording flag.
    appState.onRecordingChange((enabled) => {
      screenRecorder.setRecordingFlag(enabled)
      broadcast('recording:changed')
    })

    // Restore recording preference (default ON) once onboarded.
    const didOnboard = settings.get<boolean>(SettingsKeys.didOnboard, false)
    if (didOnboard) {
      appState.enablePersistence()
      appState.setRecording(appState.savedRecordingPreference(), {
        analyticsReason: 'auto',
        persistPreference: false
      })
    }

    // Analysis job starts 2 s after launch.
    setTimeout(() => analysisManager.start(), 2000)

    const startupLink = process.argv.find((a) => a.toLowerCase().startsWith('dayflow://'))
    if (startupLink) handleDeepLink(startupLink)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      else mainWindow?.show()
    })
  })

  app.on('open-url', (_e, url) => handleDeepLink(url))

  app.on('before-quit', () => {
    allowTermination = true
  })

  app.on('window-all-closed', () => {
    // Keep running in tray.
  })

  app.on('will-quit', () => {
    checkpointTruncate()
  })
}
