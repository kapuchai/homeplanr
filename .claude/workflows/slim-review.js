export const meta = {
  name: 'slim-review',
  description: 'Cost-capped diff review: 2 opus finders + 1 opus verifier wave (max 4 agents)',
  whenToUse: 'Routine milestone pre-commit review when a full multi-agent review is too expensive',
  phases: [
    { title: 'Find', detail: 'two opus finders: correctness + invariants/cleanup', model: 'opus' },
    { title: 'Verify', detail: 'one opus refuter per surviving candidate (capped at 6)', model: 'opus' },
  ],
}

const FINDINGS = {
  type: 'object',
  required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'object',
        required: ['file', 'line', 'summary', 'failure_scenario'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          summary: { type: 'string' },
          failure_scenario: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT = {
  type: 'object',
  required: ['refuted', 'evidence'],
  properties: {
    refuted: { type: 'boolean' },
    evidence: { type: 'string' },
  },
}

const context = `Repo: /home/vlad/Projects/Homeplanr (Tauri 2 + React floor-planner).
Review scope: the UNCOMMITTED working-tree diff — run \`git diff HEAD\` first (also \`git status -s\`).
Project invariants live in RUNBOOK.md ("Non-negotiable invariants") — violations of those are the highest-value findings.
Report only defects you are confident survive scrutiny: concrete inputs/state leading to wrong behavior. No style nits.${args ? `\nExtra reviewer instructions: ${args}` : ''}`

phase('Find')
const [correctness, invariants] = await parallel([
  () =>
    agent(
      `${context}\n\nYou are a CORRECTNESS reviewer. Hunt for behavioral bugs in the diff: wrong logic, broken edge cases, state machine holes, regressions against existing tests' intent. Read the changed files fully and trace the failure paths before reporting. Return up to 6 candidates.`,
      { label: 'find:correctness', phase: 'Find', schema: FINDINGS, model: 'opus' },
    ),
  () =>
    agent(
      `${context}\n\nYou are an INVARIANTS & INTEGRATION reviewer. Check the diff against RUNBOOK.md's pinned invariants and against how the changed code is CALLED from elsewhere (grep the call sites): stale assumptions, missed call-site updates, derived-state reference stability, undo/transaction rules. Return up to 6 candidates.`,
      { label: 'find:invariants', phase: 'Find', schema: FINDINGS, model: 'opus' },
    ),
])

const seen = new Set()
const pooled = []
for (const c of [...(correctness?.candidates ?? []), ...(invariants?.candidates ?? [])]) {
  const key = `${c.file}:${c.line}`
  if (seen.has(key)) continue
  seen.add(key)
  pooled.push(c)
}
log(`${pooled.length} unique candidates pooled`)
const capped = pooled.slice(0, 6)
if (pooled.length > capped.length) log(`capped to 6 (dropped ${pooled.length - 6})`)

phase('Verify')
const verified = await parallel(
  capped.map((c) => () =>
    agent(
      `${context}\n\nAdversarially VERIFY this claimed defect — your default stance is that it is WRONG; try hard to refute it with code evidence (read the file, trace callers, check tests):\n\nFile: ${c.file}:${c.line}\nClaim: ${c.summary}\nScenario: ${c.failure_scenario}\n\nSet refuted=false ONLY if the failure genuinely reproduces on the current working tree.`,
      { label: `verify:${c.file.split('/').pop()}:${c.line}`, phase: 'Verify', schema: VERDICT, model: 'opus' },
    ).then((v) => ({ ...c, verdict: v })),
  ),
)

return {
  confirmed: verified.filter(Boolean).filter((f) => f.verdict && !f.verdict.refuted),
  refuted: verified.filter(Boolean).filter((f) => f.verdict?.refuted),
}
