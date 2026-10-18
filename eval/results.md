# Classifier evaluation results

## Status

Live model evaluation is pending. No inference measurements or quality claims have been recorded yet. This agent's workspace has no Ollama binary, and its sandbox blocks loopback sockets. `npm run eval -- holdout` therefore exits with `Cannot reach local Ollama on 127.0.0.1:11434.` This is an environment limit, not a model result.

Run the following from the repository root in a terminal that can access local Ollama. Use Node 24 or newer. Ollama's [model listing API](https://docs.ollama.com/api/tags) supplies the digest and quantization recorded by the evaluator. The Node runner does not need `OLLAMA_ORIGINS`; that setting is needed later for the Chrome extension origin.

```bash
ollama pull gemma3:1b
ollama stop gemma3:1b # Ignore "model not loaded" on a first run.
node scripts/evaluate.ts dev > eval/dev-report.json
```

Use the six development cases for prompt tuning only. Once the prompt is frozen, unload the model and run the held-out set once:

```bash
ollama stop gemma3:1b
node scripts/evaluate.ts holdout > eval/holdout-report.json
```

The runner first checks that the configured tag is installed, then makes one development-fixture cold probe. The 20 held-out decisions follow while the model is warm; the report includes all 20 labels and timings, `warmCount: 20`, warm p95, CPU/RAM/OS, model digest and quantization. If an inference is unavailable, it counts as incorrect. A report is valid only if `warmCount` is 20, `actualCounts.unavailable` is zero, and the reported model matches the intended Gemma tag. A passing `meetsGate` is specific to this fixture set and machine. These generated JSON reports can be committed as evidence after review; they contain synthetic fixture IDs and outputs, not browsing history.

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
| Cold probe latency | Pending |
| Warm request timings (20 held-out requests) | Pending |
| Held-out exact-label accuracy | Pending / 20 |
| Relevant pages incorrectly labeled distracting | Pending / 8 |
| Distracting pages labeled distracting | Pending / 8 |
| Warm p95 latency | Pending |
| Quality gate | Pending |

The planned gate is at least 16/20 exact labels, no more than 1/8 relevant false blocks, at least 6/8 distractions blocked, and warm p95 at or below 5 seconds. Report every observed label and latency, including failures. These synthetic results only measure this small fixture set and do not establish general browsing accuracy.
