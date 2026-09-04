import { readStored, writeStored } from './storage'

/**
 * The Explanation Register: which of the two presentations of one Analysis is
 * showing.
 *
 *   'plain'      — what the reasoning layer said, in its own words
 *   'technical'  — everything that was measured, numbers included
 *
 * Technical is the screen as it has always been. Plain is a reduction of it,
 * not an addition to it: nothing appears in plain that is absent from
 * technical, and the register never changes a verdict, a probability or the
 * disclosure about who wrote the explanation. It changes how much of the
 * apparatus is on show.
 */

export const STORAGE_KEY = 'veralens.register'

export const REGISTERS = ['plain', 'technical']

export const DEFAULT_REGISTER = 'plain'

export function normaliseRegister(value) {
  return REGISTERS.includes(value) ? value : DEFAULT_REGISTER
}

export function readRegister(storage) {
  return readStored(storage, STORAGE_KEY, REGISTERS, DEFAULT_REGISTER)
}

export function writeRegister(storage, register) {
  return writeStored(storage, STORAGE_KEY, register, REGISTERS, DEFAULT_REGISTER)
}

export function isTechnical(register) {
  return normaliseRegister(register) === 'technical'
}

/**
 * The models on the inference path, named where the register asks for them.
 * Mirrors the sidebar's pipeline list and backend/app — if a model is swapped
 * there, the verdict page will keep confidently naming the old one.
 */
export const MODELS = [
  { role: 'Face detector', name: 'InsightFace buffalo_l' },
  { role: 'Classifier', name: 'EfficientNet-B4' },
  { role: 'Reasoning layer', name: 'Qwen3-VL-2B-Instruct' },
]
