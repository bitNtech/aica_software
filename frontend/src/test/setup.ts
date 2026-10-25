import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetPlatform } from '../console/demo/platform'

// The whole suite runs files side by side: a page that loads several things
// can take longer than the 1s default to settle when the machine is busy.
configure({ asyncUtilTimeout: 3000 })

// jsdom has no <dialog> modality yet: enough of it for ConfirmDialog.
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.open = false
  }
}

afterEach(() => {
  cleanup()
  sessionStorage.clear()
  localStorage.clear()
  // Platform-wide demo settings live in the module too: start each test afresh.
  resetPlatform()
})
