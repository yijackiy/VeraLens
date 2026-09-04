import { describe, expect, it } from 'vitest'

import {
  DEFAULT_REGISTER,
  MODELS,
  REGISTERS,
  STORAGE_KEY,
  isTechnical,
  normaliseRegister,
  readRegister,
  writeRegister,
} from './register'

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

describe('the register itself', () => {
  it('offers exactly two, and starts plain', () => {
    expect(REGISTERS).toEqual(['plain', 'technical'])
    expect(DEFAULT_REGISTER).toBe('plain')
  })

  it('reports whether the technical register is showing', () => {
    expect(isTechnical('technical')).toBe(true)
    expect(isTechnical('plain')).toBe(false)
  })

  // Everything the verdict screen hides is keyed on this, so an unreadable
  // stored value must fall to the register that shows less, never to the one
  // that shows measurements to someone who did not ask for them.
  it('treats anything unrecognised as plain', () => {
    expect(normaliseRegister('expert')).toBe('plain')
    expect(normaliseRegister(null)).toBe('plain')
    expect(normaliseRegister('TECHNICAL')).toBe('plain')
    expect(isTechnical(undefined)).toBe(false)
  })
})

describe('persistence', () => {
  it('reads a stored register', () => {
    expect(readRegister(memoryStorage({ [STORAGE_KEY]: 'technical' }))).toBe('technical')
  })

  it('starts plain when nothing is stored', () => {
    expect(readRegister(memoryStorage())).toBe('plain')
  })

  it('starts plain when storage throws', () => {
    expect(readRegister(hostileStorage())).toBe('plain')
  })

  it('round-trips a choice', () => {
    const storage = memoryStorage()
    writeRegister(storage, 'technical')
    expect(readRegister(storage)).toBe('technical')
  })

  it('never stores an unrecognised register', () => {
    const storage = memoryStorage()
    writeRegister(storage, 'expert')
    expect(storage.read()[STORAGE_KEY]).toBe('plain')
  })

  it('does not share a key with the theme', () => {
    expect(STORAGE_KEY).not.toBe('veralens.theme')
  })
})

describe('the model list', () => {
  // It is displayed as fact on a verdict page, so it has to name the models
  // that actually ran. Nothing enforces that but this list and a human.
  it('names all three models on the inference path', () => {
    expect(MODELS).toHaveLength(3)
    expect(MODELS.map((model) => model.name)).toEqual([
      'InsightFace buffalo_l',
      'EfficientNet-B4',
      'Qwen3-VL-2B-Instruct',
    ])
  })

  it('gives every model a role and a name', () => {
    for (const model of MODELS) {
      expect(model.role).toBeTruthy()
      expect(model.name).toBeTruthy()
    }
  })
})
