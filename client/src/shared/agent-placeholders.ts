// A {model}/{reasoning} placeholder can be its own arg token ("{model}") or
// embedded in a combined one (e.g. codex's "-c model_reasoning_effort={reasoning}")
// — check substrings across all args, not exact array-element equality.
export function hasPlaceholder(args: string[] | undefined, token: string): boolean {
  return !!args?.some(a => a.includes(token))
}
