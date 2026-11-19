import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Effort, Mode, Recommendation, RouteModel } from '../types'

const last = atom({ plugin: 'prompt-router', key: 'last' } as const, null)
const modeAtom = atom({ plugin: 'prompt-router', key: 'mode' } as const, 'suggest')

const MODELS: readonly RouteModel[] = ['haiku', 'sonnet', 'opus']
const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const MODES: readonly Mode[] = ['suggest', 'auto', 'off']

const RULES = `You route prompts for a coding assistant to the cheapest model and effort that will do the job well.
Models: haiku (fast, cheap: lookups, quick edits, short Q&A, formatting), sonnet (solid default: typical coding, debugging, writing, multi-file changes), opus (hardest: architecture, subtle bugs, long agentic tasks, deep research, high-stakes reasoning).
Effort: low (trivial), medium (routine), high (needs care), xhigh (hard, multi-step), max (only for exceptionally hard problems).
Reply with ONLY one line of JSON: {"model":"haiku|sonnet|opus","effort":"low|medium|high|xhigh|max","reason":"<= 12 words"}`

// Cheap fallback when the classifier call fails or times out.
function heuristic(text: string): Omit<Recommendation, 'applied'> {
  const t = text.toLowerCase()
  const words = t.split(/\s+/).filter(Boolean).length
  const hard = /(architect|design a|refactor|migrat|race condition|concurren|security|prove|optimi[sz]e|debug|root cause|from scratch|end-to-end|research|deadlock|memory leak)/.test(t)
  const trivial = /^(what is|what's|how do i|rename|typo|format|list|show|explain this line|thanks|ok|yes|no)\b/.test(t)
  if (hard || words > 250) return { model: 'opus', effort: words > 400 ? 'xhigh' : 'high', reason: 'complex or open-ended task', source: 'heuristic' }
  if (trivial || words < 12) return { model: 'haiku', effort: 'low', reason: 'short, simple request', source: 'heuristic' }
  return { model: 'sonnet', effort: 'medium', reason: 'routine task', source: 'heuristic' }
}

function parse(reply: string): Omit<Recommendation, 'applied' | 'source'> | null {
  const m = reply.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const j = JSON.parse(m[0]) as { model?: string; effort?: string; reason?: string }
    const model = MODELS.find(x => x === j.model)
    const effort = EFFORTS.find(x => x === j.effort)
    if (!model || !effort) return null
    return { model, effort, reason: String(j.reason ?? '').slice(0, 80) }
  } catch {
    return null
  }
}

export const register: Register = on => {
  // Recommendation to apply to the main loop's steps this turn (auto mode).
  let pending: { model: RouteModel; effort: Effort } | null = null

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get('mode')
    const mode = MODES.find(m => m === saved) ?? 'suggest'
    await update($, modeAtom, () => mode)
    await $.command.register({
      name: 'route',
      description: 'Prompt router: /route suggest | auto | off (no argument shows the current mode)',
    })
    return next(e)
  })

  on('command.run', { command: 'route' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (!arg) {
      const mode = await read($, modeAtom)
      return { text: `Prompt router mode: ${mode}. Use /route suggest | auto | off.` }
    }
    const wanted = MODES.find(m => m === arg)
    if (!wanted) return { text: `Unknown mode "${arg}". Use /route suggest | auto | off.` }
    await $.store.set('mode', wanted)
    await update($, modeAtom, () => wanted)
    if (wanted === 'off') $.ui.status(undefined)
    const what = {
      suggest: 'recommends a model and effort for each prompt',
      auto: 'recommends and applies a model and effort to each prompt',
      off: 'is off',
    }[wanted]
    return { text: `Prompt router now ${what}.` }
  })

  on('prompt.submit', async ($, e, next) => {
    pending = null
    const mode = await read($, modeAtom)
    if (mode === 'off' || e.command || e.isMeta || !e.text.trim()) return next(e)

    let rec: Omit<Recommendation, 'applied'> = heuristic(e.text)
    const r = await $.model.complete({
      model: 'haiku',
      system: RULES,
      prompt: `Prompt to route:\n<<<\n${e.text.slice(0, 6000)}\n>>>`,
      maxTokens: 120,
      effort: 'low',
      timeoutMs: 6000,
    })
    if (r.isAnswered) {
      const p = parse(r.text)
      if (p) rec = { ...p, source: 'classifier' }
    }

    const applied = mode === 'auto'
    if (applied) pending = { model: rec.model, effort: rec.effort }
    await update($, last, () => ({ ...rec, applied }))
    $.ui.status(`route: ${rec.model} · ${rec.effort}${applied ? ' (auto)' : ''}`)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Auto mode: apply the recommendation to the main conversation's requests.
  on('turn.step', async function* ($, e, next) {
    const use = pending && e.agentId === undefined
      ? { ...e, model: pending.model, effort: pending.effort }
      : e
    return yield* next(use)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) pending = null
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rec = await read($, last)
    const mode = await read($, modeAtom)
    if (e.props.hasSurvey || rec === null || mode === 'off') return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text dimColor>{rec.applied ? 'Routed to ' : 'Recommended: '}</Text>
        <Text bold>{rec.model}</Text>
        <Text dimColor> · effort </Text>
        <Text bold>{rec.effort}</Text>
        <Text dimColor> — {rec.reason}{rec.source === 'heuristic' ? ' (heuristic)' : ''} </Text>
        <Button
          key="mode"
          label={mode === 'auto' ? 'Switch to suggest' : 'Auto-apply'}
          onPress={async () => {
            const nextMode: Mode = mode === 'auto' ? 'suggest' : 'auto'
            await $.store.set('mode', nextMode)
            await update($, modeAtom, () => nextMode)
          }}
        />
      </Box>
    )
  })
}
