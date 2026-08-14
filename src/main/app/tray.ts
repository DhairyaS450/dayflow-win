import { Tray, Menu, nativeImage, app, type BrowserWindow } from 'electron'
import { join } from 'path'
import { appState } from './appState'
import { pauseManager } from '../recording/pauseManager'

// Tray (macOS status bar equivalent): recording status + pause/resume + open/quit.

let tray: Tray | null = null

export function createTray(getWindow: () => BrowserWindow | null, allowQuit: () => void): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  let icon = nativeImage.createFromPath(iconPath)
  if (!icon.isEmpty()) icon = icon.resize({ width: 16, height: 16 })
  tray = new Tray(icon)
  tray.setToolTip('Dayflow')

  const showWindow = (): void => {
    const win = getWindow()
    if (win) {
      win.show()
      win.focus()
    }
  }

  const rebuild = (): void => {
    const mode = pauseManager.mode()
    const statusLabel =
      mode === 'active'
        ? '● Recording'
        : mode === 'pausedTimed'
          ? `⏸ Paused (${pauseManager.countdownText() ?? ''})`
          : mode === 'pausedIndefinite'
            ? '⏸ Paused'
            : '○ Not recording'

    const menu = Menu.buildFromTemplate([
      { label: statusLabel, enabled: false },
      { type: 'separator' },
      ...(mode === 'active'
        ? [
            {
              label: 'Pause for 15 minutes',
              click: (): void => pauseManager.pause('15_mins', 'menu_bar')
            },
            {
              label: 'Pause for 30 minutes',
              click: (): void => pauseManager.pause('30_mins', 'menu_bar')
            },
            {
              label: 'Pause for 1 hour',
              click: (): void => pauseManager.pause('1_hour', 'menu_bar')
            },
            {
              label: 'Pause indefinitely',
              click: (): void => pauseManager.pause('indefinite', 'menu_bar')
            }
          ]
        : [
            {
              label: 'Resume recording',
              click: (): void => pauseManager.resume('user_menu_bar')
            }
          ]),
      { type: 'separator' },
      { label: 'Open Dayflow', click: showWindow },
      { type: 'separator' },
      {
        label: 'Quit Dayflow',
        click: (): void => {
          allowQuit()
          app.quit()
        }
      }
    ])
    tray?.setContextMenu(menu)
  }

  rebuild()
  tray.on('click', showWindow)
  appState.onRecordingChange(rebuild)
  pauseManager.onTick(rebuild)
  // Refresh countdown label every 30s while paused (cheap)
  setInterval(() => {
    if (pauseManager.mode() === 'pausedTimed') rebuild()
  }, 30_000)
}
