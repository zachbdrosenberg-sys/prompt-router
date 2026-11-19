export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type RouteModel = 'haiku' | 'sonnet' | 'opus'
export type Mode = 'suggest' | 'auto' | 'off'
export type Recommendation = {
  model: RouteModel
  effort: Effort
  reason: string
  source: 'classifier' | 'heuristic'
  applied: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-router': { last: Recommendation | null; mode: Mode }
  }
}
