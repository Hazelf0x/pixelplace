export const CURRENT_LANGUAGE_LINE = '0.1.x'
export const CURRENT_LANGUAGE_MAJOR = 0
export const CURRENT_LANGUAGE_MINOR = 1

export interface VersionPragmaValidationSuccess {
  ok: true
  normalized: string
}

export interface VersionPragmaValidationFailure {
  ok: false
  message: string
}

export type VersionPragmaValidationResult = VersionPragmaValidationSuccess | VersionPragmaValidationFailure

export function validateVersionPragma(rawValue: string): VersionPragmaValidationResult {
  const trimmed = rawValue.trim()
  const normalizedInput = trimmed.startsWith('v') || trimmed.startsWith('V')
    ? trimmed.slice(1)
    : trimmed

  const match = normalizedInput.match(/^(\d+)\.(\d+)(?:\.(x|\d+))?$/)
  if (!match) {
    return {
      ok: false,
      message: `Invalid version pragma "${rawValue}". Use 0.1, "0.1.x", or "0.1.0".`
    }
  }

  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = match[3]
  const normalized = patch ? `${major}.${minor}.${patch}` : `${major}.${minor}`

  if (major !== CURRENT_LANGUAGE_MAJOR || minor !== CURRENT_LANGUAGE_MINOR) {
    return {
      ok: false,
      message: `Version pragma "${rawValue}" is not compatible with current language line ${CURRENT_LANGUAGE_LINE}.`
    }
  }

  return {
    ok: true,
    normalized
  }
}
