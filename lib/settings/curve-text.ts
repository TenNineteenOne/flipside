/**
 * Pure label/help text for the popularity-curve slider in Settings.
 * Derived from the inline ternaries in settings-form.tsx.
 */

export function curveLabel(k: number): string {
  if (k < 0.92) return "Niche only"
  if (k < 0.95) return "Mostly niche"
  if (k < 0.97) return "Balanced"
  if (k < 0.99) return "Mostly popular"
  return "Mainstream"
}

export function curveHelp(k: number): string {
  if (k < 0.92)
    return "The steepest curve — popularity is punished hard. Expect deep cuts only."
  if (k < 0.95)
    return "Obscurity is strongly preferred, with room for a few less-obvious names."
  if (k < 0.97)
    return "Default mix — obscurity wins, but not by a landslide."
  if (k < 0.99)
    return "Popularity barely hurts. Expect familiar names alongside some discoveries."
  return "The curve flattens — popularity is nearly ignored."
}
