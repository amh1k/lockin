# LockIn browser verification

This checklist is for a real desktop Chrome session with Ollama available. Unit tests and a successful bundle do not count as browser or live-model evidence. Mark each case only after observing it; attach notes or a redacted screen capture where useful. Do not include page text, goals, model prompts, or personal URLs in public evidence.

## Run details

| Field | Record |
|---|---|
| Date and operator | Pending |
| Source commit | Pending |
| Chrome version | Pending |
| Operating system | Pending |
| CPU / RAM / GPU | Pending |
| Ollama version | Pending |
| Model tag / digest / quantization | Pending |
| Extension ID origin configured in Ollama | Pending |
| Live held-out report | See [`eval/results.md`](../../eval/results.md); pending |

## Install and readiness

- [ ] `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` pass from a clean checkout.
- [ ] Load `dist/` using **Load unpacked**; record the extension ID and allow only that origin through `OLLAMA_ORIGINS`.
- [ ] Restart Ollama, open the popup, and confirm **Check local Gemma** reports Gemma ready.
- [ ] Stop Ollama and confirm readiness fails with setup guidance and does not start a session.
- [ ] Inspect the built bundle and browser network panel: the only runtime inference request is to `http://127.0.0.1:11434`; no page text is written to extension storage or sent to a remote telemetry endpoint.

## Session and navigation cases

| Case | Expected behavior | Result / evidence |
|---|---|---|
| Start with YouTube and Reddit tabs already open | Existing supported tabs receive the content entry once; the visible tab is evaluated. | Pending |
| Useful tutorial and unrelated video on YouTube under the same goal | Gemma gives contextual outcomes; relevant stays open and distracting gets the barrier. | Pending |
| Change the goal for the same page | The decision can change with the goal; no URL-scripted outcome is used. | Pending |
| YouTube SPA transition, Reddit navigation, back/forward, and fragment navigation | Each new URL generation gets a fresh snapshot; a previous barrier releases while the page is rechecked. | Pending |
| Delayed title update after SPA navigation | One bounded follow-up snapshot catches a changed title; no continuing polling occurs. | Pending |
| Switch away while a model request is slow, then return | The hidden-tab result is discarded; returning triggers a fresh foreground check. | Pending |
| Navigate A → B, then allow A's delayed model response to finish | A's result never blocks B. | Covered by controller unit test; browser smoke pending |
| End session while inference is pending | The pending result cannot recreate a barrier; overrides clear. | Covered by controller unit test; browser smoke pending |
| Override exact page and navigate to another page | The exact page stays allowed for this session; another page on that site is independently judged. | Pending |
| Click **End focus session** from the dialog | The barrier releases promptly and the popup reflects the inactive session. | Pending |
| Let a session expire while the worker alarm is delayed | The barrier releases from its local timestamp; a delayed alarm cannot strand it. | Pending |
| Stop/restart the service worker during an active session, then navigate | Stored session recovers; stale work is dropped and no overlay is stranded. | Pending |
| Two supported tabs request inference together | Only one request is active; a busy tab retries once after one second if still foreground, otherwise fails open. | Pending |

## Fail-open, accessibility and limits

| Case | Expected behavior | Result / evidence |
|---|---|---|
| Ollama is stopped during a session or returns malformed output | Page remains usable and shows unavailable status within the 12-second UI deadline. | Pending |
| Sparse page, uncertain result, or unsupported site | No barrier; status explains uncertainty/unavailability where applicable. | Pending |
| Keyboard-only blocked dialog | Focus enters the dialog, Tab stays inside, actions work, and focus returns to the page after release. | Pending |
| Page is playing top-document media when blocked | Video/audio is paused best-effort; cross-origin media remains an acknowledged limitation. | Pending |
| Hostile page text resembles HTML or instructions | It is treated as data; no markup/script is created and only validated model labels affect policy. | Plain-text rendering covered by DOM regression tests; browser smoke pending |
| Iframe, unsupported host, or browser restart | No unsupported-page inference; browser restart leaves focus off because `storage.session` is cleared. | Pending |

## Current status

The repository's deterministic checks currently pass: `npm test` (90 tests), `npm run typecheck`, and `npm run build`. A cached Chrome binary is present, but launching it fails with `setsockopt: Operation not permitted`; the sandbox also blocks local Ollama access, so every browser and live-model row above remains unverified. Keep those statuses pending until the checks are run on the demo machine. The held-out quality and latency gate is documented in [`eval/results.md`](../../eval/results.md).


## MVP polish verification — October 18, 2026

- Popup DOM: valid start/end, input/site validation, duplicate-submit prevention, actionable missing-model help, bounded setup checks, session broadcasts, countdown and progress.
- Barrier DOM: hostile text stays plain text, repeated rendering preserves focus, Tab trapping and focus restoration, local expiry, 12-second deadline, retry after override failure, local release after end failure, and ignored obsolete action completions.
- Content: reinjecting the bundle does not duplicate listeners; old-session results cannot reblock a page; visibility changes refresh state.
- Worker: atomic model-slot ownership, readiness contention, stale document/generation rejection, exact-page overrides, worker restart, delayed alarm ordering, and generation cleanup.
- Extraction: bounded fields/traversal, hidden/editable/form/UI exclusions, local URL identity and lookalike-host rejection.

These DOM checks use jsdom and mocked Chrome/model APIs. They establish deterministic behavior; visual rendering, actual site navigation and real Gemma quality still require the browser rows above.
