/**
 * The overlay's promise to the member: never claim a percentage for a stage
 * whose end is unknown, and never freeze on a number that has stopped moving.
 */
import { IDLE_STAGE, scanOverlayCopy } from '../receiptScanProgress';

describe('scanOverlayCopy', () => {
  it('keeps one headline across every stage', () => {
    const headlines = [
      IDLE_STAGE,
      { kind: 'preparing', done: 0, total: 3 },
      { kind: 'uploading', fraction: 0.5 },
      { kind: 'reading', items: 4 },
    ].map((stage) => scanOverlayCopy(stage as never).message);
    expect(new Set(headlines).size).toBe(1);
  });

  it('counts photos only when there is more than one', () => {
    expect(scanOverlayCopy({ kind: 'preparing', done: 1, total: 3 }).caption).toBe(
      'Preparing photo 2 of 3'
    );
    expect(scanOverlayCopy({ kind: 'preparing', done: 0, total: 1 }).caption).toBe(
      'Preparing photo'
    );
  });

  it('gives a determinate bar to the two stages that know their end', () => {
    expect(scanOverlayCopy({ kind: 'preparing', done: 1, total: 4 }).progress).toBe(0.25);
    expect(scanOverlayCopy({ kind: 'uploading', fraction: 0.42 }).progress).toBe(0.42);
    expect(scanOverlayCopy({ kind: 'uploading', fraction: 0.42 }).caption).toBe('Uploading… 42%');
  });

  it('never fakes a bar for the open-ended AI read', () => {
    const copy = scanOverlayCopy({ kind: 'reading', items: 12 });
    expect(copy.progress).toBeUndefined();
    expect(copy.detail).toBe('12 items read');
    expect(copy.caption).toBe('Extracting details with AI');
  });

  it('says nothing about items until the first one lands', () => {
    // A "0 items read" on screen reads as a failure, not as a start.
    expect(scanOverlayCopy({ kind: 'reading', items: 0 }).detail).toBeUndefined();
    expect(scanOverlayCopy({ kind: 'reading', items: 1 }).detail).toBe('1 item read');
  });

  it('degrades to the plain spinner when nothing has been reported', () => {
    const copy = scanOverlayCopy(IDLE_STAGE);
    expect(copy.progress).toBeUndefined();
    expect(copy.detail).toBeUndefined();
  });
});
