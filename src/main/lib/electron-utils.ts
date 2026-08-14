// Minimal replacements for @electron-toolkit/utils to avoid an extra dependency.
import { app, BrowserWindow } from 'electron'

export const is = {
  dev: !app.isPackaged
}

export const electronApp = {
  setAppUserModelId(id: string): void {
    if (process.platform === 'win32') {
      app.setAppUserModelId(is.dev ? process.execPath : id)
    }
  }
}

export const optimizer = {
  watchWindowShortcuts(window: BrowserWindow): void {
    if (!window) return
    window.webContents.on('before-input-event', (event, input) => {
      if (!is.dev) {
        // Block refresh + devtools shortcuts in production
        if (input.code === 'KeyR' && (input.control || input.meta)) event.preventDefault()
        if (input.code === 'KeyI' && (input.alt || input.control) && input.shift) event.preventDefault()
      } else {
        if (input.code === 'F12' && input.type === 'keyDown') {
          window.webContents.toggleDevTools()
        }
      }
    })
  }
}
