# Voice orchestrator: the contract AICA uses

The AICA voice orchestrator (`https://orc.api.aica.bitntech.in`) answers calls. It does VAD, ASR, barge-in and handoff itself, uses the LLM server for the conversation, and uses the TTS server for speech. The orchestrator's own docs (README, API, PROTOCOL, ADMIN, CONFIGURATION) are the source; this page records what AICA relies on, and what was checked against the live server on 2026-10-27 (test tenant `ten_7e28f7eeaaf97338038c4bb3`).

## Credentials and tenants

- The API holds one **platform admin key** (`ORCH_API_KEY`). Every tenant call sends `X-Tenant-ID`, which always comes from the organisation's own record (`OrgDoc.orchTenantId`), never from the browser. The master admin links an organisation to its tenant in Ops → organisation → Voice server; the tenant is checked first, and one tenant belongs to one organisation.
- **The browser never gets a key.** It gets short-lived tokens from `POST /v1/voice/tokens`, minted by the API: `kind: voice` pinned to one voice agent (10 minutes), or `kind: operator` pinned to one call. Sockets carry them as the `bearer.<token>` subprotocol.
- Only calls of the organisation's own agents are shown or recorded, even if a tenant were shared. A call belongs to an organisation when its voice agent is one of ours, or when it was started from that organisation's console (`metadata.aica_org`).

## Mapping an agent (`app/domain/agentcompile.py`)

Every AICA agent has up to two pairs of copies. Each pair is an **LLM agent** (created through `/v1/llm/agents`) and a **voice agent** (`/v1/voice-agents`) that answers with it:

- `live`: the published version, which callers get.
- `test`: the saved working setup, used for test calls and scenarios.

Builder drafts have a test pair of their own.

| AICA setup | Voice stack |
|---|---|
| persona, tone, languages, rules, refused topics, flow (intents, steps, branches, joins), details to collect, global flows, failures before handover, closing, tools, FAQ knowledge, pronunciations | LLM agent `instructions` (written the same way every time) |
| greeting (+ recording notice) · temperature · language model | LLM `greeting` · `params.temperature` · `model` (if the catalogue offers it) |
| always | built-ins `get_current_time`, `end_conversation` |
| HTTP tools in `context.toolIds` | LLM `http` tools (`/v1/llm/tools`), secret header decrypted from the vault at sync; `side_effects` from "acts" |
| voice (`behaviour.voiceId`, or `pipeline.voiceModel`) | `voice.reference_id` when the TTS server has that voice; otherwise its active voice, with a warning |
| speech model | `asr.provider` (if offered) |
| languages | `asr.language`: `ta` / `en` for one language, auto-detect for mixed or Tanglish |
| hints | `asr.prompt` |
| turn detection, min / max endpoint | `vad.semantic_turn`, `vad.turn_check_ms` (40–2000), `vad.end_silence_ms` (100–5000) |
| interruptions on, min ms, resume after a false one | `pipeline.barge_in.enabled`, `.min_speech_ms`, `.false_interruption` |
| backchannel | `pipeline.acknowledgement.enabled` |
| filler phrases | `pipeline.fillers` |
| silence seconds, reprompts | `pipeline.idle.reprompt_after_s`, `.max_reprompts` |
| longest call | `pipeline.max_call_duration_s` |
| handoff global flow | `handoff.enabled`, `prompts.handoff_message`; silence flow → `prompts.idle_goodbye` |
| paused / live | voice agent `status` `disabled` / `active` |

**Not used by the voice stack:** keypad input, ambience, noise cancellation (it's set server-wide), a word count before interrupting, turning off early replies, and speaking rate. Document and web knowledge aren't used either: only FAQ knowledge reaches the agent. Each of these is listed on the agent's Settings tab.

**Checked live:**
- A voice agent can be created with our own id (`vagent_` + 24 hex, derived from the organisation, the agent and the copy). Creating it again gives 409 `already_exists`, so a retried create can't make two.
- PATCH replaces each section it's given and keeps the others, so the compiler always sends every section it manages; `prompts: {}` clears prompts set earlier. `null` is refused for a section.
- A stale `If-Match` gives 412 `version_mismatch`. Our copies are ours: on 412 we read the current version and write over it.
- The handover tool must carry the orchestrator's own description, or the model talks about transferring without calling it.

## Sync (`app/integrations/voicesync.py`)

- Firestore is the source of truth. Publish, rollback and draft-publish save the version first, then sync the live pair. A failed sync is recorded on the agent (`voice.live.status = "failed"` plus the error) and never undoes the publish. Retry is `POST /api/orgs/{slug}/agents/{id}/voice/sync`.
- A rename forces a resync (the copies carry the name). Pausing only patches `status`. Deleting the agent deletes both pairs; discarding a draft deletes its test pair.
- The test pair is synced when a test call or a scenario run starts, and skipped when nothing changed (a hash of the two bodies).
- LLM agent creates send an `Idempotency-Key`. Tool copies are rewritten only when the tool, or when its secret was set, changes; the secret itself is never hashed or stored.

## Calls

| Need | Route used |
|---|---|
| Live calls (polled every 4 s) | `GET /v1/voice/sessions?status=live`, plus `…/{id}/events?types=transcript,response.interrupted` |
| Controls | `POST /v1/voice/sessions/{id}/end`, `/interrupt`, `/say`, `/handoff`, `/handoff/release` |
| Listen in / take over | operator token, then `wss://…/v1/voice/sessions/{id}/operator?mode=&sample_rate=&name=`, subprotocols `aica.operator.v1`, `bearer.<token>` |
| Call history | `call.ended` webhook, or `POST /api/orgs/{slug}/calls/sync`, which pulls `status=ended` pages and stops at a page with nothing new. Both write through `record_call` (once per id) |
| Handoff queue | `handoff.*` webhooks, and `GET /v1/handoffs` read when the queue is opened (last 24 h) |

- Test calls (`metadata.aica_target = "test"`, or a test voice agent) stay out of Call history and reports.
- The outcome is provisional until calls are analysed:
  - "handed over" when a person was asked for;
  - "dropped" when the caller hung up after one turn or less;
  - otherwise "resolved".
- The intent is "Not analysed yet".

**Personal data.** The orchestrator's transcripts aren't marked. Everything the caller or staff said is stored as `{{caller_words:…}}`; the agent's words are stored as `{{agent_words:…}}` when the agent hides personal details. People without `calls.personal` see "[caller words]". This applies to live calls too.

## Webhooks (`POST /api/hooks/orchestrator`)

- The signature is `X-AICA-Signature: t=<unix>,v1=<hex HMAC-SHA256(ORCH_WEBHOOK_SECRET, "<t>.<body>")>`. It's checked in constant time, with at most 5 minutes of clock difference.
- The route sits outside the browser Origin check and is trusted by its signature alone.
- The call is always read back from the orchestrator before it's written. Every write is idempotent, so retries (same `X-AICA-Delivery`) change nothing.
- Unknown tenants or agents get 204, so the orchestrator stops retrying.
- If the orchestrator can't be read back, we answer 503, so it retries.
- Only our live voice agents carry `webhook_url`, set to `<API_URL>/api/hooks/orchestrator`, and only when `API_URL` is public https and the secret is set. The orchestrator's global `webhooks.url` isn't changed.

## Browser call (`frontend/src/console/voice/`)

- One AudioContext at its native rate, for both directions (44.1 and 48 kHz are accepted).
- The microphone uses echo cancellation, noise suppression and AGC, through an AudioWorklet, sent as 40 ms pcm16 LE frames.
- Playback has a 120 ms jitter buffer.
- On `audio.clear`, everything queued stops at once, before the page hears about it.
- `playback.mark` every 300 ms, and `playback.done` once a reply has been generated and played.
- Typed turns are sent as `input_text`.
- Close codes 1000, 1013, 4400, 4401, 4403, 4404, 4409 and 4429 each have a message.
- Unknown events are ignored.

## Admin (`/api/ops/voice/*` → `/v1/admin/*`)

Staff may read: status, models and live calls. The master admin may do everything else:
- settings (generated from the JSON Schema; locked fields read-only; secrets round-trip as `***`; reset per field or per section; a dry run before every save; `If-Match` on every write, so a 412 becomes "conflict");
- presets, checked first;
- model switches, with `in_use` shown and a 409 explained;
- ASR load and unload;
- testing an upstream, then switching to it;
- reloading components;
- maintenance (admission);
- ending any call;
- the change history.

Every change also goes to AICA's platform audit log, without values.

## Not available from the orchestrator

- A whisper only the agent hears. "Say" is spoken to the caller, and the console words it that way.
- A desk-phone transfer: staff join in the browser instead.
- Reading a flow from uploaded recordings, which needs offline transcription.
- Per-call AI analysis: summary, sentiment, intent, success.
