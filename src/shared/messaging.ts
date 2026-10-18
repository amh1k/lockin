import type { Command, CommandReply } from './types.ts';

export interface CommandRuntime {
  sendMessage(message: Command): Promise<CommandReply>;
}

/** A lost worker response must never leave a UI waiting indefinitely. */
export async function sendCommand<T extends Command['type']>(runtime: CommandRuntime, command: Extract<Command, { type: T }>): Promise<CommandReply<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runtime.sendMessage(command),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('LockIn did not respond. Please try again.')), 12_000);
      }),
    ]) as CommandReply<T>;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
