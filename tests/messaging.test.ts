import { afterEach, expect, it, vi } from 'vitest';
import { sendCommand } from '../src/shared/messaging.ts';
import { MODEL_MESSAGE_TIMEOUT_MS, COMMAND_TIMEOUT_MS } from '../src/config.ts';

afterEach(() => vi.useRealTimers());
it('keeps slow model messages open while state and recovery commands retain short deadlines', async () => {
  vi.useFakeTimers();
  const runtime = { sendMessage: vi.fn(() => new Promise<never>(() => {})) };
  const model = sendCommand(runtime, { type: 'CHECK_READY' }).catch((error: Error) => error.message);
  const state = sendCommand(runtime, { type: 'GET_STATE' }).catch((error: Error) => error.message);
  let modelFinished = false; void model.then(() => { modelFinished = true; });
  await vi.advanceTimersByTimeAsync(COMMAND_TIMEOUT_MS);
  expect(await state).toContain('did not respond'); expect(modelFinished).toBe(false);
  await vi.advanceTimersByTimeAsync(MODEL_MESSAGE_TIMEOUT_MS - COMMAND_TIMEOUT_MS);
  expect(await model).toContain('did not respond');
});
