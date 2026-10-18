export const MODEL = 'gemma3:1b';
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const PROMPT_VERSION = 'lockin-relevance-v1';
export const INFERENCE_TIMEOUT_MS = 5 * 60_000;
// Allow the model deadline plus delivery time; quick state/recovery commands stay bounded.
export const MODEL_MESSAGE_TIMEOUT_MS = INFERENCE_TIMEOUT_MS + 2_000;
export const COMMAND_TIMEOUT_MS = 12_000;
export const SUPPORTED_HOSTS = ['www.youtube.com', 'www.reddit.com'] as const;
export const LIMITS = {
  goalMin: 10,
  goalMax: 300,
  modelUrl: 500,
  title: 200,
  description: 300,
  text: 1_500,
  reason: 160,
  sparseText: 80,
  traversalElements: 500,
  overrides: 100,
} as const;
