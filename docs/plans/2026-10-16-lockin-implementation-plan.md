# LockIn Implementation Plan

> Runtime amendment (October 18): the user increased model requests to five minutes. A local offscreen document now hosts a dedicated inference worker (Chrome 116+); model UI/transport waits include a two-second delivery margin. Earlier 10-second inference, 12-second model UI, and no-offscreen statements below are superseded by [the timeout amendment](2026-10-18-inference-timeout.md). Recovery/state commands retain their 12-second bound.
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a usable context-aware MV3 focus extension with Gemma central to its decisions and evidence for appropriate Hacktoberfest partner categories within two days.

**Architecture:** A plain TypeScript MV3 extension extracts bounded context on two supported sites and calls Gemma through local Ollama. The worker owns session state and decision routing; content scripts render an overridable barrier. Optional partner tooling stays in evaluation and demo production, outside browsing inference.

**Tech Stack:** TypeScript, esbuild, Chrome extension APIs, Vitest/jsdom, Ollama, Gemma 3; optionally `@sentry/node` in developer tooling and ElevenLabs for narration.

**Spec:** [LockIn architecture](2026-10-16-lockin-architecture.md). Read both documents before execution.

Planning only: none of the files below exist yet except these two Markdown documents. No application implementation, dependency installation, model download, or account connection is authorized by this planning deliverable. The execution skills named by the template are not present in this session's skill catalog; resolve availability at execution time rather than assuming they exist.

## Global Constraints

- Hackathon MVP, maximum two days.
- Chrome Manifest V3.
- Open-source AI must be central.
- No unnecessary infrastructure; avoid overengineering.
- Consider partner technologies for prize eligibility.
- Support desktop Chrome, English goals/content, and HTTPS pages on `www.youtube.com` and `www.reddit.com` only.
- Goal: 10–300 trimmed characters; duration: 25 or 50 minutes; at least one supported host enabled.
- Model: initially `gemma3:1b`; one bounded comparison with `gemma3:4b` if needed; freeze one choice.
- Fail open for uncertain, unavailable, invalid, stale, and timed-out inference; explain degraded status.
- Inference timeout: 10 seconds; maximum UI pending lifetime: 12 seconds; one concurrent model request.
- No browsing-text persistence or browser-runtime cloud telemetry; optional Sentry uses synthetic evaluation data only.
- Gemma is open-weight with its own terms; do not call its license MIT or Apache.

## Review Focus

1. Late results after navigation, override or session end must never block the new page: Task 5.
2. Worker termination and delayed alarms must not lose the active session or strand an overlay: Tasks 2, 4, 7.
3. Delayed SPA titles, foreground changes and pre-existing tabs must get current-page decisions: Tasks 3, 5, 7.
4. Malicious page text, malformed model responses and oversized messages must not alter policy or inject UI: Tasks 1, 3, 4, 5.
5. Missing/slow inference and optional telemetry failures must leave usable pages and an honest status: Tasks 1, 4, 6, 8.

---

## Timebox and dependency order

Budget: **18 working hours across at most two calendar days**, including three hours of contingency. Solo execution assumed; no parallel developers required.

| Task | Hours | Depends on | Independent acceptance artifact |
|---|---:|---|---|
| 1. Classifier and feasibility gate | 2 | — | Measured Gemma report and tested API adapter |
| 2. Session/policy core | 1.5 | 1 contracts | Pure state tests with fake clock/storage |
| 3. Context extraction | 1.5 | 1 contracts | Fixture-driven DOM extraction tests |
| 4. Blocking UI | 2 | 1 contracts | Accessible DOM harness with fake actions |
| 5. Worker/navigation orchestration | 2 | 1–4 | Mocked Chrome integration tests |
| 6. Installable popup/extension | 2 | 1–5 | Unpacked Chrome vertical slice |
| 7. Lifecycle and end-to-end verification | 1 | 6 | Completed browser checklist |
| 8. Optional Sentry evidence | 1 | 1, 7 passes | Real AI trace plus redaction test |
| 9. Demo, user feedback, submission draft | 2 | 7; 8 if completed | Reproducible package and evidence-backed draft |
| Contingency | 3 | — | Fix core issues, not extra features |

Day 1: Tasks 1–4 and start Task 5. Day 2: finish Tasks 5–7, optional Task 8, then Task 9. Start a simple demo-script outline during Day 1. Freeze features before the final three hours. The two-day cap takes precedence over optional integrations.

Cut order: Sentry; ElevenLabs narration; cosmetic polish. Never cut same-site contextual decisions, override/end recovery, stale-result checks, or setup documentation. No automatic third inference architecture if the initial AI gate fails: use contingency to reassess feasibility and document any scope change.

## File map

| Planned path | Responsibility |
|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` | Toolchain, pinned dependencies and commands |
| `scripts/build.mjs`, `public/manifest.json` | Bundle worker/content/popup, copy HTML/assets, emit `dist/` |
| `src/config.ts`, `src/shared/types.ts` | Constants and shared contracts |
| `src/ai/prompt.ts`, `src/ai/classify.ts` | Prompt, Ollama request, response validation, readiness |
| `src/session/state.ts`, `src/session/store.ts` | Pure session policy and Chrome storage adapter |
| `src/content/extract.ts`, `src/content/overlay.ts`, `src/content/index.ts` | Bounded extraction, barrier, document lifecycle |
| `src/background/controller.ts`, `src/background/index.ts` | Testable routing and top-level Chrome listeners |
| `src/popup/index.html`, `src/popup/index.ts`, `src/popup/styles.css` | Setup, start/end, current status |
| `tests/ai.test.ts`, `tests/session.test.ts`, `tests/extract.test.ts`, `tests/overlay.test.ts`, `tests/controller.test.ts`, `tests/popup.test.ts` | Unit and mocked integration tests |
| `tests/fixtures/pages/*.html`, `tests/helpers/chrome.ts` | Synthetic DOM fixtures and minimal Chrome fake |
| `eval/dev.json`, `eval/holdout.json`, `scripts/evaluate.ts`, `eval/results.md` | Six tuning cases, twenty held-out cases, repeatable evaluation |
| `scripts/trace-evaluation.ts`, `tests/trace-evaluation.test.ts` | Optional Sentry wrapper and privacy assertions |
| `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `docs/testing/manual-checklist.md` | Installation, attribution, limitations and verification |
| `docs/demo/script.md`, `docs/demo/feedback.md`, `docs/submission.md` | Demo, honest user evidence, DEV draft |

Do not create a server, database, deployment manifest, landing page or abstraction for multiple AI providers. Add `tsx` only for executing TypeScript evaluation scripts. Tests import Chrome-independent modules directly; use injected Chrome/storage/fetch/clock dependencies for meaningful behavior tests.

## Shared contracts

These are interface specifications, not application implementation. Define them in Task 1 and import them throughout; avoid separately invented message shapes.

| Type | Fields / meaning |
|---|---|
| `SupportedHost` | `'www.youtube.com' \| 'www.reddit.com'` |
| `Preferences` | `{hosts: SupportedHost[], durationMinutes: 25 \| 50}` |
| `Session` | `{id: string, goal: string, startedAt: number, endsAt: number, hosts: SupportedHost[]}`; timestamps milliseconds |
| `Snapshot` | `{pageKey: string, modelUrl: string, title: string, description: string, text: string}`; `pageKey` never enters the prompt |
| `Label` | `'relevant' \| 'distracting' \| 'uncertain'` |
| `AIResult` | `{status:'ok', label:Label, reason:string, durationMs:number, inputTokens?:number, outputTokens?:number}` or `{status:'unavailable', error:'timeout'\|'network'\|'http'\|'invalid'\|'busy'\|'missing-model', durationMs:number}` |
| `Decision` | `{action:'allow'\|'block', source:'model'\|'override'\|'inactive'\|'uncertain'\|'unavailable', reason:string}` |
| `Correlation` | `{sessionId:string, tabId:number, documentId:string, generation:number, requestId:string}` |
| `EvaluationReply` | `{correlation:Correlation, pageKey:string, decision:Decision, endsAt:number}` |
| `SessionState` | `{session:Session\|null, overrides:string[]}`; overrides belong only to the current session |
| `StateStore` | `read(): Promise<SessionState>`; `write(state:SessionState): Promise<void>` |

Messages: popup sends `GET_STATE`, `CHECK_READY`, `START_SESSION {goal,durationMinutes,hosts}`, `END_SESSION`. Content sends `GET_STATE`, `EVALUATE {snapshot,generation,requestId}`, `OVERRIDE_PAGE {pageKey,generation}`, `END_SESSION`. Worker sends `SESSION_CHANGED`, `RESAMPLE {generation}`, and `EVALUATION_RESULT {reply}`. Every command returns a tagged `{ok:true,data}` or `{ok:false,error}` response. Define `data` per command in the shared types; do not permit arbitrary fetch URLs or model names.

The worker owns generation increments, supplies them on initial `GET_STATE` and `RESAMPLE`, and matches the echoed generation on `EVALUATE`. Message sender identity, not a caller-supplied tab ID, establishes authority. A top-frame content sender may end the session through its barrier but cannot start a session. Serialize state mutations through the controller so concurrent overrides do not overwrite one another.

## Task 1: Prove Gemma classification and establish the shared boundary

**Files:** create toolchain files, shared types/config, `src/ai/{prompt,classify}.ts`, `tests/ai.test.ts`, `eval/{dev,holdout}.json`, `scripts/evaluate.ts`, `eval/results.md`.

**Interfaces:** `classify(goal:string, snapshot:Snapshot, signal?:AbortSignal):Promise<AIResult>`; `checkReady():Promise<{ready:boolean,error?:string}>`. Inject fetch/clock through a small module factory for tests. Expose `buildPrompt(goal,snapshot)` for inspecting exactly what is transmitted. `evaluate(fixtures, classifier):Promise<EvalReport>` returns counts, false blocks, distracting recall, warm p95, model metadata and per-fixture results.

- [ ] Create the minimal test/typecheck/evaluation toolchain. Commands: `npm test` → `vitest run`; `npm run typecheck` → `tsc --noEmit`; `npm run eval` → run the evaluation script. Pin installed versions and commit a lockfile.
- [ ] Write failing tests: `valid_schema_maps_to_label` asserts a valid distracting response remains distracting; `invalid_label_fails_open` asserts `{status:'unavailable',error:'invalid'}`; `timeout_aborts_at_10000ms` asserts fetch is aborted; `page_identity_is_not_transmitted` asserts prompt excludes `pageKey`, query secrets and fragments. Also cover extra keys, oversized reason, network/non-2xx errors, sparse context and missing model.
- [ ] Run `npm test -- tests/ai.test.ts`; expect behavioral/import failures before implementation.
- [ ] Implement the signatures above with architecture limits, strict JSON schema and local endpoint. Never include page text in logs/errors. Capture actual Ollama token counters only when provided; do not estimate monetary cloud charges for local inference.
- [ ] Create six development fixtures and freeze twenty distinct held-out fixtures: 8 relevant, 8 distracting, 4 uncertain; include same-site pairs, a changed-goal pair, a misleading tutorial title, and page text instructing the model to ignore the goal. Record expected labels before evaluation. Unit tests use mocked fetch; model results are a separate, nondeterministic evaluation.
- [ ] Run `npm test -- tests/ai.test.ts` and `npm run typecheck`; expect PASS.
- [ ] On the demo machine, install/start Ollama when implementation is authorized, pull Gemma, configure exact extension origin when available, and run the live evaluation. Record hardware, Ollama version, model digest/quantization, prompt version, cold latency, 20 warm timings and all labels. Gate: at least 16/20 correct, at most 1/8 relevant false-blocked, at least 6/8 distractions blocked, warm p95 ≤5 seconds. If needed, try 4b once and record both results; do not tune on held-out failures and still call them held-out performance.
- [ ] Commit this independently testable classifier/evaluation deliverable: `feat: add local Gemma relevance classifier`.

**Stop condition:** if no model meets the gate within the allotted time/contingency, report the measured failure before building the rest around it. Do not hide failure with hard-coded site decisions.

## Task 2: Session lifetime, overrides and decision policy

**Files:** create `src/session/state.ts`, `src/session/store.ts`, `tests/session.test.ts`; extend config/types only for these contracts.

**Interfaces:** `startSession(goal, durationMinutes, hosts, now):Session`; `expire(state:SessionState, now:number):SessionState`; `addOverride(state,pageKey):SessionState`; `decide(session:Session|null,pageKey:string,overrides:string[],result:AIResult,now:number):Decision`; `createStore(chromeStorage):StateStore`.

- [ ] Write failing tests for 9/10/300/301-character trimmed goals; empty/unknown host selections; 25/50-minute expiry; rejected other durations; exact URL overrides; override cap 100; inactive/expired sessions; malformed stored state; and persistence across a newly created store instance. Example assertion: at `startedAt + 25*60*1000`, `expire(state, now).session` equals `null` and overrides equals `[]`.
- [ ] Run `npm test -- tests/session.test.ts`; expect FAIL before implementation.
- [ ] Implement pure state transitions and the storage adapter. Restrict session storage to trusted extension contexts, validate loaded state, store preferences separately in local storage, and clear session data on end/expiry. Model unavailable/uncertain yields allow; only valid distracting yields block without an override.
- [ ] Run `npm test -- tests/session.test.ts` and `npm run typecheck`; expect PASS, including clock-boundary and fresh-store recovery.
- [ ] Commit: `feat: add focus session lifecycle and page overrides`.

## Task 3: Bounded, privacy-conscious page snapshots

**Files:** create `src/content/extract.ts`, `tests/extract.test.ts`, and synthetic `tests/fixtures/pages/{youtube,reddit,sparse,hostile}.html`.

**Interfaces:** `extractSnapshot(document:Document, url:string):Snapshot`; `isSupportedUrl(url:string, hosts:SupportedHost[]):boolean`; `pageKey(url:string):string` preserves path/query/hash but excludes credentials. Unsupported protocols/hosts never reach inference.

- [ ] Write failing tests asserting the exact 500/200/300/1500 field caps and 500-element traversal cap; model URL contains no query/fragment; page key distinguishes two YouTube `v` values; hidden nodes, editable content, form values, scripts, nav and LockIn UI do not appear. Include sparse pages and hostile text as data. Assert `www.youtube.com.attacker.example` and `http://www.youtube.com` are unsupported.
- [ ] Run `npm test -- tests/extract.test.ts`; expect FAIL.
- [ ] Implement extraction with bounded DOM traversal and rendered-text filtering. Prefer `main` and fall back to body. Never attempt transcripts, image OCR, cross-origin frames, or continuous scraping.
- [ ] Run `npm test -- tests/extract.test.ts` and `npm run typecheck`; expect PASS. Keep real-layout/visibility verification for Task 7 because jsdom does not reproduce browser rendering.
- [ ] Commit: `feat: extract bounded context from supported pages`.

## Task 4: Blocking dialog with unconditional recovery

**Files:** create `src/content/overlay.ts`, `tests/overlay.test.ts`.

**Interfaces:** `mountBarrier(document:Document, actions:{override():Promise<void>,end():Promise<void>}):Barrier`; `Barrier.render({phase:'idle'|'checking'|'blocked'|'uncertain'|'unavailable',goal?:string,reason?:string,endsAt?:number}):void`; `Barrier.destroy():void`.

- [ ] Write failing DOM tests: distracting state creates exactly one dialog; repeated render is idempotent; malicious reason is plain text; end/override actions release correctly; expiry and 12-second pending deadline release; action failure leaves an accessible retry/end path; focus/scroll restore on release. Assert `document.querySelector('script[data-injected]')` remains null after rendering a hostile reason.
- [ ] Run `npm test -- tests/overlay.test.ts`; expect FAIL.
- [ ] Implement the shadow-root overlay, checking/uncertainty/unavailable indicators, keyboard focus handling, best-effort media pause, and action buttons. Only blocked state locks scrolling/focus. Expiry and messaging failure release locally even if the worker is unavailable; no indefinite “checking” barrier.
- [ ] Run `npm test -- tests/overlay.test.ts` and `npm run typecheck`; expect PASS. Do a simple browser DOM harness check during Task 6 for actual focus order and styling.
- [ ] Commit: `feat: add recoverable focus blocking dialog`.

## Task 5: Route navigation and decisions safely through MV3

**Files:** create `src/background/controller.ts`, `src/background/index.ts`, `src/content/index.ts`, `tests/controller.test.ts`, `tests/helpers/chrome.ts`.

**Interfaces:** `createController({chrome,store,classify,clock}):Controller`; `Controller.handleMessage(message,sender):Promise<CommandReply>`; `Controller.handleNavigation(details):Promise<void>`; `Controller.handleAlarm(name):Promise<void>`; `Controller.handleTabRemoved(tabId):Promise<void>`. Use the shared message protocol and Correlation fields. Content entry is idempotent and handles messages/visibility without page-world script injection.

- [ ] Write failing integration tests with deferred classifier promises: navigate A→B then resolve A; end then resolve; override then resolve; replace session then resolve; hidden tab then resolve. In each, assert no block result is applied. Test generation ownership, top-frame/sender/host checks, oversized payload rejection, command permissions, and serialized concurrent override writes.
- [ ] Run `npm test -- tests/controller.test.ts`; expect FAIL.
- [ ] Implement top-level event listeners, session/generation storage, message routing, 700 ms sampling, one bounded title resample, content visibility recheck, normal/SPA/fragment navigation, and session-change broadcasts. Inject guarded content entry into pre-existing supported tabs at session start. Persist no page snapshots.
- [ ] Implement one active inference slot, busy status with a single 1-second visible-document retry, abort/ignore on invalidation, tab-close cleanup and timestamp-based alarm cleanup. Recheck expiry and current generation immediately before applying a result; worker globals are never the source of session truth.
- [ ] Extend integration tests for two-tab contention, duplicate snapshot suppression, delayed title, pre-existing tabs, fresh controller over existing storage, delayed expiry alarm, and browser-restart empty session. `npm test -- tests/controller.test.ts` and `npm run typecheck` must PASS.
- [ ] Commit: `feat: connect navigation to session-aware AI decisions`.

## Task 6: Installable extension and usable popup

**Files:** create `scripts/build.mjs`, `public/manifest.json`, `src/popup/{index.html,index.ts,styles.css}`, `tests/popup.test.ts`; update package scripts; create README setup draft and notices/license.

**Interfaces:** popup consumes only shared commands. Build emits `dist/manifest.json`, `dist/background.js` (module), `dist/content.js` (self-contained classic script), `dist/popup.html`, `dist/popup.js`, and `dist/popup.css`. Copy/rename HTML paths consistently; bundle all runtime code locally.

- [ ] Write failing popup tests for valid start, readiness failure, active-session start rejection, end, countdown, current-tab unavailable status, unsupported active tab, host toggles and invalid form fields. Assert failed readiness never sends a successful START transition.
- [ ] Run `npm test -- tests/popup.test.ts`; expect FAIL.
- [ ] Implement popup and manifest with the exact permissions/hosts in the architecture. The worker performs readiness before session creation; the popup cannot bypass it. Bundle via esbuild and add `npm run build`. No remote scripts, eval, framework or broad all-sites access.
- [ ] Write setup instructions for unpacked loading, model download, exact extension origin configuration, restarting Ollama, checking readiness, and refreshing after extension reload. Include platform-specific Ollama FAQ links and the fact that loading a different unpacked path may change extension ID.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build`; expect PASS and valid MV3 output. Load `dist/` in Chrome; inspect worker errors and execute one real allow/block pair, override and end. Check network requests go only to loopback from extension code.
- [ ] Commit: `feat: ship installable MV3 focus extension`.

## Task 7: Verify browser behavior and release limits

**Files:** create `docs/testing/manual-checklist.md`; update tests only for actual defects found, and `eval/results.md` with final model/prompt evidence.

**Interfaces:** operates on the built extension; no new product API.

- [ ] Record Chrome version, OS, hardware, selected model/digest and build commit in the checklist. Run the following cases with expected outcomes, marking evidence/pass/fail rather than assuming success:

| Browser case | Expected result |
|---|---|
| Start with supported tabs already open | Guarded content script appears once; visible tab classified |
| Relevant vs unrelated page on same host; changed goal | Actual model yields contextual outcomes |
| YouTube SPA transition; Reddit navigation; back/forward | New generation, fresh metadata, no old-page barrier |
| Switch tabs during a slow inference | Stale/hidden result discarded, newly visible tab eventually evaluated or explicitly unavailable |
| Stop worker from extension inspector during active session, then navigate | Session recovered from storage; missing response releases UI |
| Stop/end/expire while request is pending | No late barrier; state/overrides cleared |
| End after blocking; exact-page override; navigate to other page | Immediate release; override not domain-wide |
| Stop Ollama or return invalid JSON through a local test stub | Fail open within deadline; status explains failure |
| Keyboard-only use and blocked playing video | Accessible controls/focus restoration; top-document media paused best effort |
| Unsupported host, iframe and browser restart | No unsupported inference; restart leaves focus off |

- [ ] Run the final live evaluation and `npm test && npm run typecheck && npm run build`; expect all deterministic checks PASS and documented model gates. No new tuning on the held-out set.
- [ ] Fix blocking bugs inside contingency, rerun only affected checks plus final build, and record known limitations. Do not claim universal site support or tamper-proof blocking.
- [ ] Commit: `test: verify focus lifecycle and real Chrome navigation`.

## Task 8: Optional Sentry AI tracing without production telemetry

**Files:** create `scripts/trace-evaluation.ts`, `tests/trace-evaluation.test.ts`; update package scripts, `.gitignore`, and evaluation report. Add `@sentry/node` as a development dependency only.

**Prerequisites:** Task 7 passes; Sentry project/DSN access exists; at most one hour remains allocated to this task. Otherwise mark skipped and omit its prize claim.

**Interfaces:** `traceEvaluation(fixtures,classifier,telemetry):Promise<EvalReport>` wraps Task 1's evaluator; `toTraceAttributes(result:AIResult, fixtureId:string, model:string):Record<string,string|number|boolean>` is an allowlist. Normal `npm run eval` still works without any Sentry account.

- [ ] Verify manual AI instrumentation names/attributes against current official Sentry Node docs or its official reference implementation. Use an evaluation parent span and model request child spans; do not assume a plain fetch span proves AI Agent Tracing integration.
- [ ] Write a failing redaction test that injects canary URL, goal, prompt and reason values and asserts none appears in serialized telemetry. Add a test that telemetry failure does not change classification results. Run `npm test -- tests/trace-evaluation.test.ts`; expect FAIL.
- [ ] Implement the wrapper with duration, model identity, fixture ID, token counters when present, classification label and error category only. Disable automatic PII/request-content collection; DSN comes from process environment, never extension assets. Flush before script exit. Do not create a backend or instrument real browsing.
- [ ] Run tests and `npm run eval:trace` against synthetic fixtures. Verify real AI request spans in Sentry and retain a redacted screenshot/link plus one actual finding, such as cold-load latency or invalid-output frequency. If only generic traces work, disclose that and do not assert the stronger category proof.
- [ ] Confirm built `dist/` has no Sentry SDK/DSN/cloud endpoint and the ordinary extension still works without Sentry access. Commit: `chore: add optional Sentry evaluation tracing`.

## Task 9: Demonstrate usefulness and prepare the submission

**Files:** create `docs/demo/script.md`, `docs/demo/feedback.md`, `docs/submission.md`; finalize README, notices and reproducible installation instructions.

**Interfaces:** consumes the working extension, measured evaluation report and any completed partner evidence; adds no runtime behavior.

- [ ] Write a 60–90-second demo script: goal setup → relevant page allowed → unrelated page on same host blocked → exact-page override → changed-goal example → local Gemma explanation. Show visible model latency honestly. Keep a written scenario and backup recording; do not claim edited footage is real-time.
- [ ] If ElevenLabs access and output usage rights are available, spend at most 30 minutes generating narration for that script, using its dashboard or a one-off developer tool. No API key in source or extension. Retain the generated asset and generation record. Otherwise use text captions/live narration and omit the ElevenLabs category. Recording a browser session is sufficient; no custom animation project is required.
- [ ] Prepare a short tester script and recruit/test with one willing person if available: installation, one real goal, one useful page and one distraction. Record consented anonymized feedback and actual answer to “Would you pay for this, and what would need to improve?” Do not invent a user, revenue or interest. This planning request does not authorize sending outreach messages; recruitment is a human-run step unless separately authorized.
- [ ] Draft the DEV post using the official template: problem/customer, demo, architecture, open-weight/local value, real results/failures, license/model attribution and only completed partner integrations. Pitch LockIn as a potentially sellable focus product; side-hustle users are not a requirement. Use `#devchallenge` and `#hf26challenge`; list team handles if applicable.
- [ ] Verify repository creation/build dates fit the contest window, review linked eligibility rules, check demo/repository links and document post-deadline changes if any. Reserve time for writing quality. Keep publication and submission as explicit human release actions; do not auto-publish from this plan.
- [ ] Rebuild and validate the unpacked distribution; document the source revision, commands and known limitations. Commit: `docs: add demo evidence and challenge submission draft`.

## Completion checklist

- [ ] Architecture acceptance criteria map to Tasks 1–7 and pass with recorded evidence.
- [ ] No application code was added during the planning phase.
- [ ] Core partner use is genuine: Gemma makes the relevance decisions.
- [ ] Optional category claims have screenshots/assets and working integration evidence, or are removed.
- [ ] No backend, database, exposed inference service, production API key, or unexplained permission was introduced.
- [ ] Setup works on the tested machine; local-install friction and model limitations are documented.
- [ ] Final draft and installable artifact are ready for the user to review and publish before the deadline.

## Planning self-review

Requirement coverage: product scope and AI centrality → Task 1; session semantics → Task 2; bounded context/privacy → Task 3; usable recovery → Task 4; lifecycle/SPA/concurrency → Task 5; MV3/installability → Task 6; real browser acceptance → Task 7; partner evidence → Tasks 1, 8, 9; commercial/theme story → Task 9. Each task has a separable verification artifact and explicit dependency. No claims of measured accuracy, completed integrations, or implementation are made by this plan.
