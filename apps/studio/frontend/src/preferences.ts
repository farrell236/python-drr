import type { BackendName, StudioPreferences, ThemePreference } from './types'

const STORAGE_KEY = 'pydrr-studio-preferences-v1'

export const DEFAULT_STUDIO_PREFERENCES: StudioPreferences = {
  theme: 'system',
  defaultBackend: 'auto',
  defaultCpuWorkers: 1,
}

const THEMES: ThemePreference[] = ['system', 'light', 'dark']
const BACKENDS: BackendName[] = ['auto', 'cpu', 'cuda', 'mps']

export function loadStudioPreferences(): StudioPreferences {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') as Partial<StudioPreferences>
    return {
      theme: THEMES.includes(stored.theme as ThemePreference) ? stored.theme as ThemePreference : DEFAULT_STUDIO_PREFERENCES.theme,
      defaultBackend: BACKENDS.includes(stored.defaultBackend as BackendName) ? stored.defaultBackend as BackendName : DEFAULT_STUDIO_PREFERENCES.defaultBackend,
      defaultCpuWorkers: Number.isInteger(stored.defaultCpuWorkers) && Number(stored.defaultCpuWorkers) >= 1 && Number(stored.defaultCpuWorkers) <= 64
        ? Number(stored.defaultCpuWorkers)
        : DEFAULT_STUDIO_PREFERENCES.defaultCpuWorkers,
    }
  } catch {
    return DEFAULT_STUDIO_PREFERENCES
  }
}

export function saveStudioPreferences(preferences: StudioPreferences) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch {
    // Studio remains usable when browser storage is disabled or unavailable.
  }
}

export function applyTheme(theme: ThemePreference) {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}
