import { COMMAND_TIMEOUT_MS, MODEL_MESSAGE_TIMEOUT_MS } from '../config.ts';
import type { Command, CommandReply } from './types.ts';

export interface CommandRuntime {
  sendMessage(message: Command): Promise<CommandReply>;
}

/** A lost worker response must never leave a UI waiting indefinitely. */
export async function sendCommand<T extends Command['type']>(runtime: CommandRuntime, command: Extract<Command, { type: T }>): Promise<CommandReply<T>> {
  const timeout = ['CHECK_READY', 'START_SESSION', 'EVALUATE'].includes(command.type) ? MODEL_MESSAGE_TIMEOUT_MS : COMMAND_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runtime.sendMessage(command),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('LockIn did not respond. Please try again.')), timeout);
      }),
    ]) as CommandReply<T>;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
