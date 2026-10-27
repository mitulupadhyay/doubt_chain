export const EXPLANATION_MODES = [
  'beginner',
  'step_by_step',
  'simple_example',
  'hinglish',
  'debug_code'
] as const

export type ExplanationMode = (typeof EXPLANATION_MODES)[number]

export type ModeDefinition = {
  id: ExplanationMode
  label: string
  description: string
  /** Instructions appended to the system prompt. */
  instruction: string
}

export const MODE_DEFINITIONS: Record<ExplanationMode, ModeDefinition> = {
  beginner: {
    id: 'beginner',
    label: "Explain Like I'm a Beginner",
    description: 'Plain language, no assumed background, define every term.',
    instruction:
      'Explain as if the student has no background in this topic. Define every technical term in one short sentence the first time you use it. Prefer short sentences and everyday analogies. Do not skip steps that an expert would consider obvious.'
  },
  step_by_step: {
    id: 'step_by_step',
    label: 'Explain Step by Step',
    description: 'Numbered reasoning path from the question to the answer.',
    instruction:
      'Answer as a numbered sequence of steps (1, 2, 3, …). Each step must state what is done and why. End with a short "Final answer" line. Do not merge steps.'
  },
  simple_example: {
    id: 'simple_example',
    label: 'Give a Simple Example',
    description: 'One small, concrete, runnable example that shows the idea.',
    instruction:
      'Lead with one small, concrete example (short code snippet, numbers, or a tiny scenario) that demonstrates the concept. Keep it minimal and correct. After the example, add at most three sentences explaining what the example shows.'
  },
  hinglish: {
    id: 'hinglish',
    label: 'Explain in Hinglish',
    description: 'Romanised Hindi mixed with English technical terms.',
    instruction:
      'Respond in Hinglish: romanised Hindi mixed with English technical terms (for example "Yeh loop infinite ho raha hai kyunki condition kabhi false nahi hoti"). Keep technical terms in English so the student can still search for them. Do not use Devanagari script.'
  },
  debug_code: {
    id: 'debug_code',
    label: 'Help Me Debug This Code',
    description: 'Find the bug, explain the cause, and show the fix.',
    instruction:
      'Act as a debugging assistant. Structure the reply as: (1) Likely cause, (2) Why it happens, (3) Exact fix with corrected code, (4) How to verify the fix. If the code shown is too incomplete to identify a definite bug, say so explicitly and list the checks the student should run instead of guessing.'
  }
}

export function isExplanationMode(value: unknown): value is ExplanationMode {
  return typeof value === 'string' && (EXPLANATION_MODES as readonly string[]).includes(value)
}

export function resolveMode(value: unknown): ExplanationMode {
  return isExplanationMode(value) ? value : 'beginner'
}

export function listModes(): ModeDefinition[] {
  return EXPLANATION_MODES.map((mode) => MODE_DEFINITIONS[mode])
}
