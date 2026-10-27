import { useEffect, useRef, useState } from 'react'
import { asAuthError } from '../../auth/types'
import { useConsole } from '../../console/ConsoleProvider'
import { useOrg } from '../../console/useOrg'
import { Button } from '../ui/Button'

/** Plays `text` in a voice, from the voice server. When the server doesn't
 * have that voice yet, it answers in its active voice (and the agent's
 * Settings tab says so). Nothing plays by itself: it waits for a click. */
export function VoicePreview({ voiceId, voiceName, text }: { voiceId: string; voiceName: string; text: string }) {
  const client = useConsole()
  const { org } = useOrg()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const url = useRef<string | null>(null)

  useEffect(
    () => () => {
      audio.current?.pause()
      if (url.current) URL.revokeObjectURL(url.current)
    },
    [],
  )

  if (!client.previewVoice) return null

  async function play() {
    setBusy(true)
    setError(null)
    try {
      const blob = await client.previewVoice!(org.orgSlug, voiceId, text.trim().slice(0, 300) || 'Vanakkam, how can I help you today?')
      audio.current?.pause()
      if (url.current) URL.revokeObjectURL(url.current)
      url.current = URL.createObjectURL(blob)
      audio.current = new Audio(url.current)
      await audio.current.play()
    } catch (err) {
      setError(err instanceof DOMException ? 'Your browser didn’t play the sample. Try again.' : asAuthError(err).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="voice-preview">
      <Button variant="line" size="sm" busy={busy} busyLabel="Loading the sample…" onClick={() => void play()}>
        Hear {voiceName} say the greeting
      </Button>
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
