# LockIn demo script (target: 75 seconds)

Use a fresh, real session and the installed Gemma model. This script describes what to show; it does not promise particular model outputs. If a page gets an unexpected or uncertain result, show it honestly, use the exact-page override, and record what happened. Do not pre-stage a dialog or edit footage to imply a live model decision.

| Time | Show / say |
|---|---|
| 0:00–0:10 | Open the LockIn popup. “LockIn helps when useful work and distractions live on the same websites.” Point out that only YouTube and Reddit are supported in this MVP. |
| 0:10–0:22 | Enter “Implement Stripe subscriptions in my web app,” choose a 25-minute session, and start it. Show the readiness check and that Gemma runs locally through Ollama. |
| 0:22–0:40 | Open a relevant subscription-integration tutorial and an unrelated page on the same supported site. Show the actual outcomes, including visible inference time. Explain that LockIn uses page context and the current goal, not a domain-only blocklist. |
| 0:40–0:52 | On a blocked page, use **Allow this page for this session**. Show that the exception is page-specific. If the model allowed the page, show the end-session action instead and state that the override path is available on a blocked result. |
| 0:52–1:05 | End the session, change the goal to a different real task, and evaluate the same page again. Show the actual outcome; do not imply a result the model did not produce. |
| 1:05–1:15 | Close with the architecture: Chrome MV3, bounded page snapshot, Gemma through local Ollama, and fail-open recovery. State the tested model/hardware and cite only measured evaluation results. |

Before recording, replace the generic page descriptions with the URLs and observed decisions from the actual run. Keep browser notifications and personal tabs out of view. If a live setup fails, explain the failure and use the written scenario for the narration; do not substitute a mock decision for the real one.
