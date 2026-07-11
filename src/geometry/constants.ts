/** Shared numerical tolerances. See src/model/README.md before touching. */

/** Pure-math epsilon (determinants, parameter comparisons). */
export const EPS = 1e-9

/** Geometric coincidence in meters (points considered identical). */
export const GEOM_EPS = 1e-6

/**
 * Graph-normalization welding tolerance in meters: node merging,
 * endpoint-on-segment T-splits, near-crossing X-welds. Matches the
 * "no two nodes closer than 1cm" document invariant.
 */
export const MERGE_EPS = 0.01

/** Miter length limit as a multiple of wall thickness; beyond it, bevel. */
export const MITER_LIMIT = 3

/** Maximum normalizeGraph fixed-point passes before best-effort bailout. */
export const NORMALIZE_MAX_PASSES = 8
