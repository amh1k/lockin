import { describe, expect, it } from 'vitest';
import { evaluate, type EvaluationFixture } from '../scripts/evaluate.ts';
import type { AIResult, Snapshot } from '../src/shared/types.ts';

const snapshot: Snapshot = {
  pageKey: 'https://www.youtube.com/watch?v=secret-query',
  modelUrl: 'https://www.youtube.com/watch',
  title: 'Fixture title',
  description: '',
  text: 'Synthetic content',
};

const fixture = (id: string, expected: EvaluationFixture['expected']): EvaluationFixture => ({
  id,
  goal: 'Secret test goal',
  snapshot,
  expected,
});

describe('evaluation metrics', () => {
  it('counts distraction recall from true positives rather than all distracting predictions', async () => {
    const fixtures = [
      fixture('relevant-page', 'relevant'),
      fixture('distraction-1', 'distracting'),
      fixture('distraction-2', 'distracting'),
      fixture('ambiguous-page', 'uncertain'),
    ];
    const responses: AIResult[] = [
      { status: 'ok', label: 'distracting', reason: 'Wrongly blocked', durationMs: 10 },
      { status: 'ok', label: 'distracting', reason: 'Correctly blocked', durationMs: 20, inputTokens: 42 },
      { status: 'ok', label: 'relevant', reason: 'Missed distraction', durationMs: 30 },
      { status: 'unavailable', error: 'timeout', durationMs: 40 },
    ];

    const report = await evaluate(fixtures, async () => responses.shift()!);

    expect(report.correct).toBe(1);
    expect(report.relevantFalseBlocks).toBe(1);
    expect(report.distractingBlocked).toBe(1);
    expect(report.distractingRecall).toBe(0.5);
    expect(report.actualCounts).toEqual({ relevant: 1, distracting: 2, uncertain: 0, unavailable: 1 });
    expect(report.coldDurationMs).toBe(10);
    expect(report.warmP95Ms).toBe(40);
    expect(report.results[1]?.inputTokens).toBe(42);
    expect(JSON.stringify(report)).not.toContain('Secret test goal');
    expect(JSON.stringify(report)).not.toContain('secret-query');
  });

  it('returns null warm latency and recall when the fixture set has no distractions', async () => {
    const report = await evaluate([fixture('one', 'relevant')], async () => ({
      status: 'ok', label: 'relevant', reason: 'Useful', durationMs: 7,
    }));

    expect(report.distractingRecall).toBeNull();
    expect(report.warmP95Ms).toBeNull();
    expect(report.coldDurationMs).toBe(7);
  });
});
