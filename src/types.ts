export type TaskStatus = 'draft' | 'running' | 'completed' | 'interrupted' | 'canceled' | 'ready-for-review' | 'stale' | 'applying' | 'needs-verification';
export type Task = {
  id: string; title: string; prompt: string; recipe: string; workspacePath: string | null; workspaceName: string | null;
  scenario: string; period: string; recordId: string | null; source: Source | null; allowNebius: boolean;
  status: TaskStatus; createdAt: string; updatedAt: string; answer: string | null; facts: any; error?: string | null; stage?: string | null;
  inference?: { modelRequested: string; modelReturned: string | null; usage: any; sent: string[] } | null;
  proposal?: { envelope: { command: string; payload: any; scenario_id: string; period: string }; preview: any; receipt: any; previewedAt: string } | null;
  notes?: string;
};
export type Source = { id: string; name: string; text: string; locations: { page: number | null; text: string }[]; coverage: string; parserVersion: number };
export type Settings = { connection: { origin: string; workspacePath: string; workspaceName: string } | null; model: string; externalInferenceBlocked: boolean; keepOnTop: boolean; hasNebKey: boolean; hasOrrToken: boolean };
export type Runtime = { name: string; path: string; runtimeVersion: string } | null;

declare global {
  interface Window {
    clerk: {
      bootstrap(): Promise<{ settings: Settings; runtime: Runtime; tasks: Task[]; expanded: boolean }>;
      connect(input: { origin: string; token: string; expectedPath: string }): Promise<{ runtime: Runtime; settings: Settings }>;
      disconnect(): Promise<Settings>;
      settings(input: object): Promise<Settings>;
      testNebius(): Promise<{ model: string }>;
      selectSource(): Promise<Source | null>;
      search(input: { query: string; scenario: string; period: string }): Promise<{ results: any[] }>;
      state(input: { scenario: string; period: string }): Promise<any>;
      reports(input: { scenario: string; period: string }): Promise<any>;
      createTask(input: object): Promise<Task>;
      saveTask(input: object): Promise<Task>;
      deleteTask(id: string): Promise<Task[]>;
      runTask(id: string): Promise<Task>;
      stopTask(id: string): Promise<boolean>;
      preview(input: { id: string; command: string; payload: object }): Promise<Task>;
      apply(id: string): Promise<Task>;
      verifyOutcome(id: string): Promise<Task>;
      setExpanded(value: boolean): Promise<boolean>;
      onTask(callback: (task: Task) => void): () => void;
    }
  }
}
