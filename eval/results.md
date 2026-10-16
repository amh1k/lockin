# Classifier evaluation results

## Status

Live model evaluation is pending. No inference measurements or quality claims have been recorded yet. The execution environment checked for this implementation has no Ollama binary, and its sandbox blocks the loopback request needed to verify an Ollama service. Do not treat this as a model failure or a passing result.

Run `npm run eval -- dev` while tuning the prompt. After freezing the prompt, run `npm run eval -- holdout` once and record that output below. The evaluator reports the first request separately as cold latency; warm p95 uses only subsequent requests. An unavailable or failed inference is counted as incorrect and remains visible in the per-fixture results.

## Frozen datasets

- Development: 6 synthetic fixtures for prompt iteration.
- Held-out: 20 distinct synthetic fixtures with 8 relevant, 8 distracting, and 4 uncertain expected labels.
- Coverage includes same-site contrasts, the same page under two different goals, a tutorial title whose content is unrelated, sparse context, and hostile instructions embedded in page text.
- All examples are synthetic. They contain no collected browsing history or personal data.

## Required run record

Fill this section from actual evaluator output and machine inspection. Keep the held-out labels unchanged after the first run; if they are revised for a genuine labeling error, document the change and treat the set as no longer held out.

| Field | Result |
|---|---|
| Date and operator | Pending |
| Machine and OS | Pending |
| Ollama version | Pending |
| Model tag, digest, and quantization | Pending |
| Prompt version | Pending |
| Cold latency | Pending |
| Warm request timings (20 requests) | Pending |
| Held-out exact-label accuracy | Pending / 20 |
| Relevant pages incorrectly labeled distracting | Pending / 8 |
| Distracting pages labeled distracting | Pending / 8 |
| Warm p95 latency | Pending |
| Quality gate | Pending |

The planned gate is at least 16/20 exact labels, no more than 1/8 relevant false blocks, at least 6/8 distractions blocked, and warm p95 at or below 5 seconds. Report every observed label and latency, including failures. These synthetic results only measure this small fixture set and do not establish general browsing accuracy.
