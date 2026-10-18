# Five-minute local inference amendment

The user explicitly requested a five-minute model timeout after real local Gemma requests exceeded ten seconds. This replaces the earlier model/UI timing constraints; it does not change the model, sites, session durations or decision policy.

- Every classifier/readiness call has a single 300,000 ms budget. Readiness discovery and its real classification share that budget.
- CHECK_READY, START_SESSION and EVALUATE messaging and page-check status allow 302,000 ms including delivery overhead. GET_STATE, END_SESSION and OVERRIDE_PAGE retain 12,000 ms recovery bounds.
- Chrome terminates service-worker fetches that wait over 30 seconds for a response. The service worker therefore delegates only model work to a bundled offscreen document and dedicated worker. The offscreen WORKERS reason is used for the actual worker; Chrome 116+ and the offscreen permission are required. No backend, cloud call, offscreen polling or indefinite keepalive is added.
- Inference remains globally serialized. The dedicated worker also rejects simultaneous jobs after a service-worker restart. Navigation/end cancellation reaches the inference worker; final decisions still require the current session, document and page generation.
- Pages stay usable during the wait; model failure, messaging failure and session expiry release locally.

Verification: fake-clock tests cover the full five-minute model budget, readiness budget sharing, model/recovery transport differences, UI waiting, offscreen creation/reuse, and cancellation. Typecheck, unit/DOM tests and bundled resource checks must pass. Real Chrome/Ollama timing remains a user-machine check because this workspace blocks local sockets and browser launch.

References: [Chrome service worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle), [offscreen documents and WORKERS](https://developer.chrome.com/docs/extensions/reference/api/offscreen).
