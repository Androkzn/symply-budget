/**
 * Progress model for the receipt scan overlay.
 *
 * A receipt scan is three waits stacked, and only the first two know their own
 * length: shrinking each photo to a vision-safe size (files, countable),
 * uploading them (bytes, countable), and the model reading the receipt (open
 * ended — nothing knows how many lines a receipt has until the model reaches
 * the end). So the first two stages get a determinate bar and the third gets an
 * honest counter of what has been read so far, never a fake percentage.
 *
 * Kept apart from the screen so the copy is unit-testable without rendering.
 */

export type ScanStage =
  | { kind: 'idle' }
  /** Shrinking/converting attachments before upload. `done` of `total` files. */
  | { kind: 'preparing'; done: number; total: number }
  /** Bytes on the wire. `fraction` in [0, 1]. */
  | { kind: 'uploading'; fraction: number }
  /** Model is reading. `items` is lines written so far; total unknowable. */
  | { kind: 'reading'; items: number };

export const IDLE_STAGE: ScanStage = { kind: 'idle' };

export interface ScanOverlayCopy {
  message: string;
  caption: string;
  /** Determinate bar fraction, or undefined for the open-ended stage. */
  progress?: number;
  /** Third line, only once there is something real to report. */
  detail?: string;
}

/**
 * Overlay copy for a stage. The message stays constant across every stage on
 * purpose — swapping the headline three times in ten seconds reads as churn,
 * so movement is carried by the caption, bar and detail underneath it.
 */
export function scanOverlayCopy(stage: ScanStage): ScanOverlayCopy {
  const message = 'Reading your receipt…';
  switch (stage.kind) {
    case 'preparing':
      return {
        message,
        // One photo prepares fast enough that "1 of 1" is just noise.
        caption: stage.total > 1 ? `Preparing photo ${stage.done + 1} of ${stage.total}` : 'Preparing photo',
        progress: stage.total > 0 ? stage.done / stage.total : 0,
      };
    case 'uploading':
      return {
        message,
        caption: `Uploading… ${Math.round(stage.fraction * 100)}%`,
        progress: stage.fraction,
      };
    case 'reading':
      return {
        message,
        caption: 'Extracting details with AI',
        // Nothing to say until the first line lands — an eager "0 items read"
        // looks like a failure rather than a start.
        detail: stage.items > 0 ? `${stage.items} ${stage.items === 1 ? 'item' : 'items'} read` : undefined,
      };
    case 'idle':
    default:
      return { message, caption: 'Extracting details with AI' };
  }
}
