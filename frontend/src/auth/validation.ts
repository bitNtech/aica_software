/** Client-side checks for faster feedback only. The server must repeat
 * every one of them; nothing here is a security boundary. */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const PASSWORD_MIN = 12

const COMMON = new Set([
  'password1234', 'password12345', '123456789012', 'qwertyuiop12', 'aica12345678',
  'letmein12345', 'welcome12345', 'hospital1234', 'iloveyou1234', 'admin1234567',
])

export function validateEmail(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Enter your work email.'
  if (!EMAIL.test(v)) return 'Enter an email like name@hospital.in.'
  return null
}

export function validatePasswordEntered(value: string): string | null {
  return value ? null : 'Enter your password.'
}

export interface PasswordCheck {
  id: 'length' | 'mix' | 'personal'
  label: string
  met: boolean
}

export function passwordChecks(password: string, email = ''): PasswordCheck[] {
  const local = email.split('@')[0]?.toLowerCase() ?? ''
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  return [
    { id: 'length', label: `At least ${PASSWORD_MIN} characters`, met: password.length >= PASSWORD_MIN },
    { id: 'mix', label: 'A mix of letters with numbers or symbols', met: kinds >= 2 },
    {
      id: 'personal',
      label: "Not your email or a common password",
      met:
        password.length > 0 &&
        !COMMON.has(password.toLowerCase()) &&
        !(local.length >= 3 && password.toLowerCase().includes(local)),
    },
  ]
}

export type Strength = 0 | 1 | 2 | 3 | 4

/** 0 empty · 1 weak · 2 fair · 3 good · 4 strong. Length matters most. */
export function passwordStrength(password: string, email = ''): Strength {
  if (!password) return 0
  const checks = passwordChecks(password, email)
  if (!checks.every((c) => c.met)) return 1
  if (password.length >= 20) return 4
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length
  if (password.length >= 16 || kinds >= 4) return 4
  return kinds >= 3 ? 3 : 2
}

export const STRENGTH_LABEL: Record<Strength, string> = {
  0: '',
  1: 'Too weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong',
}

export function validateNewPassword(password: string, email = ''): string | null {
  if (!password) return 'Choose a password.'
  const failed = passwordChecks(password, email).find((c) => !c.met)
  if (!failed) return null
  if (failed.id === 'length') return `Use at least ${PASSWORD_MIN} characters.`
  if (failed.id === 'mix') return 'Add a number or a symbol.'
  return "Pick something that isn't your email or a common password."
}

export function validateConfirm(password: string, confirm: string): string | null {
  if (!confirm) return 'Type the password again.'
  return confirm === password ? null : "The passwords don't match."
}

export function validateName(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Enter your name.'
  if (v.length < 2) return 'Enter your full name.'
  return null
}

/** Indian mobile numbers: optional +91 / 0, then 10 digits starting 6–9. */
export function normalisePhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '')
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.length === 11 && digits.startsWith('0') ? digits.slice(1) : digits
  return local
}

export function validatePhone(value: string): string | null {
  if (!value.trim()) return 'Enter a mobile number.'
  return /^[6-9]\d{9}$/.test(normalisePhone(value)) ? null : 'Enter a 10-digit mobile number, like 98765 43210.'
}

export function validateBusinessName(value: string): string | null {
  const v = value.trim()
  if (!v) return 'Enter the name callers know you by.'
  if (v.length < 3) return 'Enter the full business name.'
  return null
}

export function validateCity(value: string): string | null {
  return value.trim() ? null : 'Enter the city.'
}
