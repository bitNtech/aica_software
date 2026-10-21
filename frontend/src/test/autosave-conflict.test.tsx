import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AuthError } from '../auth/types'
import { useAutosave } from '../pages/console/builder/useAutosave'

describe('autosave after someone else saved', () => {
  it('stops saving and asks for a reload instead of retrying', async () => {
    const save = vi.fn().mockRejectedValue(new AuthError('conflict', 'Someone else saved changes.'))
    const { result } = renderHook(() => useAutosave({ a: 1 }, save, 0))
    act(() => result.current.changed())
    await act(async () => {
      await result.current.flush().catch(() => undefined)
    })
    expect(result.current.state).toBe('conflict')
    act(() => result.current.changed())
    await act(async () => {
      await result.current.retry()
    })
    expect(save).toHaveBeenCalledTimes(1)
  })
})
