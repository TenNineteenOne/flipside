export interface Finding { title: string; detail: string; evidence: string; fix: string; effort: "S" | "M" | "L" }

// The launch-scale audit is kept out of the public branch. It lives on the local-only
// branch `design-lab-full` (same path).
export const SCALE_FINDINGS: Finding[] = []
export const PERF_FINDINGS: Finding[] = []
