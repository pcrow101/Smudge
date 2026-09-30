import type { PerfProfileOverride, ResolvedPerfProfile } from "./bridge";

/**
 * Graded performance profiles for large documents.
 *
 * - **full** (below `reducedThresholdBytes`): all widgets and live-preview
 *   decorations render normally.
 * - **reduced** (below `plainThresholdBytes`): math/image/table widgets
 *   collapse to compact placeholders (no KaTeX layout, no image decode);
 *   inline styling (bold/italic/headings/links) and marker-hiding stay on.
 * - **plain** (above `plainThresholdBytes`): live preview is off entirely —
 *   syntax-highlighted raw source only — and spellcheck is disabled.
 *
 * Thresholds are overridable (Settings ▸ Performance, Phase 9); `auto`
 * resolution always happens here so both Swift and JS agree on one source of
 * truth for "what profile is this document at".
 */
export interface PerfThresholds {
  /** Documents at or above this size (bytes) drop from `full` to `reduced`. */
  reducedThresholdBytes: number;
  /** Documents at or above this size (bytes) drop from `reduced` to `plain`. */
  plainThresholdBytes: number;
}

export const defaultPerfThresholds: PerfThresholds = {
  reducedThresholdBytes: 2 * 1024 * 1024,
  plainThresholdBytes: 10 * 1024 * 1024
};

let thresholds: PerfThresholds = { ...defaultPerfThresholds };

export function setPerfThresholds(next: Partial<PerfThresholds>): void {
  thresholds = { ...thresholds, ...next };
}

export function getPerfThresholds(): PerfThresholds {
  return thresholds;
}

/** UTF-16 code unit count is a fine proxy for "roughly how many bytes on disk". */
export function docSizeBytes(length: number): number {
  return length;
}

function autoResolve(bytes: number): ResolvedPerfProfile {
  if (bytes >= thresholds.plainThresholdBytes) return "plain";
  if (bytes >= thresholds.reducedThresholdBytes) return "reduced";
  return "full";
}

/** Resolves an override (`auto` or an explicit profile) against document size. */
export function resolveProfile(
  override: PerfProfileOverride,
  bytes: number
): { profile: ResolvedPerfProfile; auto: boolean } {
  if (override === "auto") {
    return { profile: autoResolve(bytes), auto: true };
  }
  return { profile: override, auto: false };
}
