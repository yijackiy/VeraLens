import { describe, expect, it } from 'vitest'

import {
  STORAGE_KEY,
  applyTheme,
  nextPreference,
  normalisePreference,
  readPreference,
  resolveTheme,
  writePreference,
} from './theme'

/** localStorage in a private window throws rather than returning null. */
function hostileStorage() {
  return {
    getItem() {
      throw new DOMException('denied', 'SecurityError')
    },
    setItem() {
      throw new DOMException('denied', 'SecurityError')
    },
  }
}

function memoryStorage(initial = {}) {
  const store = { ...initial }
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value)
    },
    read: () => store,
  }
}

describe('resolveTheme', () => {
  it('lets an explicit choice outrank the operating system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the operating system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('treats an unknown preference as system rather than failing', () => {
    expect(resolveTheme('sepia', true)).toBe('dark')
    expect(resolveTheme(undefined, false)).toBe('light')
  })
})

describe('normalisePreference', () => {
  it('accepts the three known values', () => {
    expect(normalisePreference('system')).toBe('system')
    expect(normalisePreference('light')).toBe('light')
    expect(normalisePreference('dark')).toBe('dark')
  })

  it.each([null, undefined, '', 'DARK', 'auto', 0, {}])(
    'falls back to system for %o',
    (value) => {
      expect(normalisePreference(value)).toBe('system')
    },
  )
})

describe('nextPreference', () => {
  it('always yields an explicit choice, never system', () => {
    expect(nextPreference('light')).toBe('dark')
    expect(nextPreference('dark')).toBe('light')
  })

  // The point of the design: someone on a system-dark laptop who presses the
  // control once must land in light, not cycle through system and appear to
  // have done nothing.
  it('gives light in one press from a system-resolved dark', () => {
    expect(nextPreference(resolveTheme('system', true))).toBe('light')
  })
})

describe('readPreference', () => {
  it('reads a stored choice', () => {
    expect(readPreference(memoryStorage({ [STORAGE_KEY]: 'dark' }))).toBe('dark')
  })

  it('returns system when nothing is stored', () => {
    expect(readPreference(memoryStorage())).toBe('system')
  })

  it('returns system when storage throws', () => {
    expect(readPreference(hostileStorage())).toBe('system')
  })

  it('returns system when there is no storage at all', () => {
    expect(readPreference(undefined)).toBe('system')
  })
})

describe('writePreference', () => {
  it('stores a normalised value', () => {
    const storage = memoryStorage()
    expect(writePreference(storage, 'dark')).toBe(true)
    expect(storage.read()[STORAGE_KEY]).toBe('dark')
  })

  it('never stores an unrecognised value', () => {
    const storage = memoryStorage()
    writePreference(storage, 'sepia')
    expect(storage.read()[STORAGE_KEY]).toBe('system')
  })

  it('reports failure instead of throwing when storage is blocked', () => {
    expect(writePreference(hostileStorage(), 'dark')).toBe(false)
  })
})

describe('applyTheme', () => {
  it('stamps an explicit attribute either way', () => {
    const attributes = {}
    const root = { setAttribute: (name, value) => (attributes[name] = value) }

    applyTheme(root, 'dark')
    expect(attributes['data-theme']).toBe('dark')

    applyTheme(root, 'light')
    expect(attributes['data-theme']).toBe('light')
  })

  // index.css keys its only dark block on data-theme="dark" and relies on
  // absence meaning light, so an unresolved value must not reach the DOM.
  it('resolves anything that is not dark to light', () => {
    const attributes = {}
    const root = { setAttribute: (name, value) => (attributes[name] = value) }

    applyTheme(root, 'system')
    expect(attributes['data-theme']).toBe('light')
  })

  it('does nothing when there is no root', () => {
    expect(() => applyTheme(null, 'dark')).not.toThrow()
  })
})
