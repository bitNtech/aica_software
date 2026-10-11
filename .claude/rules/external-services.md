# External ASR / TTS / LLM Services

- These inference pipelines are hosted on separate servers and must be treated as external systems.
- Do not implement, duplicate, deploy, restart, or modify those servers.
- Keep all URLs and credentials configurable; use placeholders in examples.
- Inspect existing API documentation and repository code before proposing an integration.
- If contracts are missing, list the exact information needed: protocol, endpoint, authentication, payload, response/event format, streaming behavior, errors, timeouts, and CORS/network constraints.
- Avoid logging raw audio, transcripts, prompts, tokens, credentials, or personal data.
- Plan for disconnects, cancellation, timeouts, and partial streaming responses.
