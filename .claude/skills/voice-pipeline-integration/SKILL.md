---
name: voice-pipeline-integration
description: Use when the application must communicate with separately hosted ASR, TTS, or LLM services.
---

# External Voice Pipeline Integration

Treat ASR, TTS, and LLM inference as externally hosted services. This repository owns only its local application code and integration layer.

## Before proposing implementation
- Locate existing API clients, configuration, WebSocket code, environment templates, and docs.
- Do not infer endpoint names, authentication, or message formats.
- Establish a contract for HTTP/WebSocket, auth, payloads, response/event schema, streaming chunks, cancellation, heartbeat, error codes, timeouts, and retry safety.
- Confirm whether audio is PCM/WAV/encoded, sample rate, channels, and binary/text framing if relevant.
- Identify browser permission, CORS, TLS, proxy, and network constraints.
- Present a plan and wait for explicit approval.

## Design principles
- Keep a provider/service adapter between UI and remote services.
- Configure service URLs and secrets via environment variables.
- Separate connection state, session state, transcript state, and playback state.
- Handle partial results, disconnects, timeouts, cancellation, and reconnects explicitly.
- Avoid sending audio/transcripts to analytics or logs by default.
- Use mock adapters only when requested or approved; visibly label mock mode.
- Never modify or deploy the remote inference servers as part of this workflow.
