import * as React from 'react'
import { readJson, writeJson } from './storage'

export type AppSettings = {
  apiBaseUrl: string
  apiKey: string
}

const STORAGE_KEY = 'weread-ui-settings:v1'

const DEFAULT_SETTINGS: AppSettings = {
  apiBaseUrl: '',
  apiKey: '',
}

type SettingsContextValue = {
  settings: AppSettings
  setSettings: (next: AppSettings) => void
  updateSettings: (patch: Partial<AppSettings>) => void
}

const SettingsContext = React.createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettingsState] = React.useState<AppSettings>(() => {
    return readJson<AppSettings>(STORAGE_KEY) ?? DEFAULT_SETTINGS
  })

  const setSettings = React.useCallback((next: AppSettings) => {
    setSettingsState(next)
    writeJson(STORAGE_KEY, next)
  }, [])

  const updateSettings = React.useCallback(
    (patch: Partial<AppSettings>) => setSettings({ ...settings, ...patch }),
    [settings, setSettings],
  )

  return (
    <SettingsContext.Provider value={{ settings, setSettings, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = React.useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}

