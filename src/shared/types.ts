export type SupportedHost = 'www.youtube.com' | 'www.reddit.com';

export interface Preferences {
  hosts: SupportedHost[];
  durationMinutes: 25 | 50;
}

export interface Session {
  id: string;
  goal: string;
  startedAt: number;
  endsAt: number;
  hosts: SupportedHost[];
}

export interface Snapshot {
  pageKey: string;
  modelUrl: string;
  title: string;
  description: string;
  text: string;
}

export type Label = 'relevant' | 'distracting' | 'uncertain';
export type AIError = 'timeout' | 'network' | 'http' | 'invalid' | 'busy' | 'missing-model';
export type AIResult =
  | {
      status: 'ok';
      label: Label;
      reason: string;
      durationMs: number;
      inputTokens?: number;
      outputTokens?: number;
    }
  | { status: 'unavailable'; error: AIError; durationMs: number };

export interface ReadyResult {
  ready: boolean;
  error?: string;
}

export interface Decision {
  action: 'allow' | 'block';
  source: 'model' | 'override' | 'inactive' | 'uncertain' | 'unavailable';
  reason: string;
}

export interface Correlation {
  sessionId: string;
  tabId: number;
  documentId: string;
  generation: number;
  requestId: string;
}

export interface EvaluationReply {
  correlation: Correlation;
  pageKey: string;
  decision: Decision;
  endsAt: number;
}

export interface SessionState {
  session: Session | null;
  overrides: string[];
}

export interface StateStore {
  read(): Promise<SessionState>;
  write(state: SessionState): Promise<void>;
}

export type Command =
  | { type: 'GET_STATE' }
  | { type: 'CHECK_READY' }
  | { type: 'START_SESSION'; goal: string; durationMinutes: 25 | 50; hosts: SupportedHost[] }
  | { type: 'END_SESSION' }
  | { type: 'EVALUATE'; snapshot: Snapshot; generation: number; requestId: string }
  | { type: 'OVERRIDE_PAGE'; pageKey: string; generation: number };

export interface CommandData {
  GET_STATE: { state: SessionState; generation: number | null };
  CHECK_READY: ReadyResult;
  START_SESSION: { state: SessionState };
  END_SESSION: { state: SessionState };
  EVALUATE: { status: 'accepted' | 'unavailable' };
  OVERRIDE_PAGE: { state: SessionState };
}

export type CommandReply<T extends Command['type'] = Command['type']> =
  | { ok: true; data: CommandData[T] }
  | { ok: false; error: string };

export type WorkerMessage =
  | { type: 'SESSION_CHANGED'; state: SessionState }
  | { type: 'RESAMPLE'; generation: number }
  | { type: 'EVALUATION_RESULT'; reply: EvaluationReply };
