# LockIn MVP polish implementation plan

**Goal:** Finish the approved two-site MV3 MVP with reliable recovery and a clear, consistent focus experience.
**Architecture:** Keep plain TypeScript, local Gemma/Ollama, bounded extraction and session storage. No additional runtime infrastructure or partner integrations.
**Spec:** Existing LockIn architecture and implementation plan in this directory. Execution and commits are authorized by the user's request to finalize and polish the MVP.

## Tasks

- [x] Harden the worker: serialize generation writes, reject stale document messages, acquire the inference slot before asynchronous work, and keep readiness checks within that slot. Add regression tests for contention and navigation races.
- [x] Harden content lifecycle: use a guard that survives bundle reinjection, refresh session/generation on visibility and navigation, bound messaging, correlate results with session/request/page identity, and cancel obsolete timers.
- [x] Finish the barrier: preserve focus across repeated renders, bound actions, ignore late actions from obsolete states, and make local recovery clear. Verify malicious text remains plain text.
- [x] Finish the popup: unified visual styling, setup instructions with the installed extension origin, actionable readiness errors, protected loading states, countdown/progress and session-change synchronization. Keep goals, durations and supported sites unchanged.
- [x] Add local extension icons and a reproducible distribution build. Verify actual DOM behavior using an available browser or DOM harness, then run typecheck, tests and build.
- [x] Record observed verification and remaining live-model limitations; commit and push the finished MVP. Do not claim the real model gate passed without measurements.

Verification: deterministic DOM/controller tests, typecheck and MV3 build are complete. Real Chrome launch was attempted but blocked by the sandbox (`setsockopt: Operation not permitted`); live Ollama measurements remain pending. These are explicitly recorded in the manual checklist and evaluation report.
