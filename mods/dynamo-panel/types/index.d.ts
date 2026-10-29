// The values the «Dynamo» pane keeps in `$.state`: the last view of `dynamo status --json`.
export type PanelRow = { ticket: number; column: string | null; round: number; running: boolean; step: string | null; turns: number; cost: number };
export type PanelView = {
  rows: PanelRow[]; blocked: { ticket: number; reason: string }[]; skipped: { ticket: number; why: string }[]; error: string | null;
};

declare module 'claude-code' {
  interface PluginState {
    'dynamo-panel': { view: Shaped<PanelView | null> }
  }
}
