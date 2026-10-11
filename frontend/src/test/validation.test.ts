import { describe, expect, it } from 'vitest'
import { passwordStrength, validateConfirm, validateEmail, validateNewPassword } from '../auth/validation'

describe('validateEmail', () => {
  it('asks for an email when empty', () => expect(validateEmail('  ')).toMatch(/enter your work email/i))
  it('rejects malformed addresses', () => {
    for (const bad of ['name', 'name@', 'name@host', 'a b@x.in']) expect(validateEmail(bad)).not.toBeNull()
  })
  it('accepts a normal address, ignoring surrounding spaces', () => expect(validateEmail(' meena@hospital.in ')).toBeNull())
})

describe('validateNewPassword', () => {
  it('requires 12 characters', () => expect(validateNewPassword('Short1!')).toMatch(/12 characters/))
  it('requires more than one kind of character', () => expect(validateNewPassword('aaaaaaaaaaaaaa')).toMatch(/number or a symbol/))
  it('rejects a password containing the email name', () =>
    expect(validateNewPassword('meena-front-2026', 'meena@hospital.in')).toMatch(/isn't your email/))
  it('rejects common passwords', () => expect(validateNewPassword('Password1234')).not.toBeNull())
  it('accepts a long mixed password', () => expect(validateNewPassword('river-lamp-2026-blue')).toBeNull())
})

describe('passwordStrength', () => {
  it('scores empty as 0 and failing rules as 1', () => {
    expect(passwordStrength('')).toBe(0)
    expect(passwordStrength('short')).toBe(1)
  })
  it('scores long mixed passwords as strong', () => expect(passwordStrength('river-lamp-2026-blue')).toBe(4))
})

describe('validateConfirm', () => {
  it('flags a mismatch', () => expect(validateConfirm('abc', 'abd')).toMatch(/don't match/))
  it('passes a match', () => expect(validateConfirm('abc', 'abc')).toBeNull())
})
