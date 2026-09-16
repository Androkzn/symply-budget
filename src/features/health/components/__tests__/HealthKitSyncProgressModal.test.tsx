/**
 * HealthKitSyncProgressModal — the overlay `useHealthKitConnection().busy`
 * screens show instead of a bare spinner: a per-area breakdown of the
 * two-month historical backfill (`healthKitHistoricalWindows`), then a
 * completion summary once `importNow()` settles.
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { ThemeProvider } from '@contexts/ThemeContext';

import type { HealthKitImportResult, HealthKitSyncProgress } from '../../healthKit';
import { HEALTHKIT_DESCRIPTORS } from '../../healthKitTypes';
import { HealthKitSyncProgressModal } from '../HealthKitSyncProgressModal';

type Rendered = ReactTestRenderer.ReactTestRenderer;

const MODAL = 'healthkit-sync-progress-modal';

function render(element: React.ReactElement): Rendered {
  let tree!: Rendered;
  act(() => {
    tree = ReactTestRenderer.create(<ThemeProvider>{element}</ThemeProvider>);
  });
  return tree;
}

function byTestId(tree: Rendered, id: string) {
  return tree.root.findAll((n) => n.props?.testID === id);
}

function textOf(inst: ReactTestRenderer.ReactTestInstance): string {
  return inst
    .findAll((n) => typeof n.type === 'string')
    .flatMap((n) => {
      const c = n.props?.children;
      return Array.isArray(c) ? c : [c];
    })
    .filter((c) => typeof c === 'string' || typeof c === 'number')
    .map(String)
    .join(' ');
}

function pendingAreas(): HealthKitSyncProgress['areas'] {
  return HEALTHKIT_DESCRIPTORS.map((descriptor) => ({
    type: descriptor.type,
    label: descriptor.label,
    icon: descriptor.icon,
    samplesRead: 0,
    status: 'pending',
  }));
}

function progressFixture(over: Partial<HealthKitSyncProgress> = {}): HealthKitSyncProgress {
  return {
    stage: 'reading',
    areas: pendingAreas(),
    completedAreas: 0,
    totalAreas: HEALTHKIT_DESCRIPTORS.length,
    result: null,
    ...over,
  };
}

function importResult(over: Partial<HealthKitImportResult> = {}): HealthKitImportResult {
  return {
    state: 'connected',
    imported: 0,
    superseded: 0,
    skipped: [],
    failed: 0,
    weightImported: 0,
    weightSuperseded: 0,
    weightSkipped: [],
    weightFailed: 0,
    workoutImported: 0,
    workoutSkipped: 0,
    workoutFailed: 0,
    nutritionImported: 0,
    nutritionSuperseded: 0,
    nutritionSkipped: 0,
    nutritionFailed: 0,
    samplesRead: 0,
    syncedAt: '2026-07-28T00:00:00.000Z',
    ...over,
  };
}

describe('HealthKitSyncProgressModal — visibility', () => {
  it('renders nothing when not visible and there is no held-open completion frame', () => {
    const tree = render(<HealthKitSyncProgressModal visible={false} progress={null} />);
    expect(byTestId(tree, MODAL)).toHaveLength(0);
  });

  it('mounting already-invisible with a stale "done" frame does not show anything', () => {
    // Only a transition FROM visible holds the modal open — a screen that never
    // showed it should not resurrect a previous sync's summary on mount.
    const tree = render(
      <HealthKitSyncProgressModal visible={false} progress={progressFixture({ stage: 'done' })} />,
    );
    expect(byTestId(tree, MODAL)).toHaveLength(0);
  });

  it('shows a connecting message before the first progress frame arrives', () => {
    const tree = render(<HealthKitSyncProgressModal visible progress={null} />);
    expect(textOf(byTestId(tree, `${MODAL}-title`)[0])).toContain('Connecting');
  });
});

describe('HealthKitSyncProgressModal — reading stage', () => {
  it('lists every scoped area', () => {
    const tree = render(<HealthKitSyncProgressModal visible progress={progressFixture()} />);
    for (const descriptor of HEALTHKIT_DESCRIPTORS) {
      expect(byTestId(tree, `healthkit-sync-progress-area-${descriptor.type}`)).not.toHaveLength(0);
    }
  });

  it('shows a spinner only for the area currently reading', () => {
    const active = HEALTHKIT_DESCRIPTORS[0].type;
    const progress = progressFixture({
      areas: pendingAreas().map((area) => (area.type === active ? { ...area, status: 'reading' } : area)),
    });
    const tree = render(<HealthKitSyncProgressModal visible progress={progress} />);

    expect(byTestId(tree, `healthkit-sync-progress-area-${active}-spinner`)).not.toHaveLength(0);
    const other = HEALTHKIT_DESCRIPTORS[1].type;
    expect(byTestId(tree, `healthkit-sync-progress-area-${other}-spinner`)).toHaveLength(0);
  });

  it('shows the running sample count once an area finishes reading', () => {
    const progress = progressFixture({
      areas: pendingAreas().map((area, index) => (index === 0 ? { ...area, status: 'done', samplesRead: 12 } : area)),
    });
    const tree = render(<HealthKitSyncProgressModal visible progress={progress} />);
    expect(textOf(tree.root)).toContain('12');
  });
});

describe('HealthKitSyncProgressModal — saving + done stages', () => {
  it('shows the saving copy once every area has been read', () => {
    const progress = progressFixture({
      stage: 'saving',
      areas: pendingAreas().map((area) => ({ ...area, status: 'done' })),
      completedAreas: HEALTHKIT_DESCRIPTORS.length,
    });
    const tree = render(<HealthKitSyncProgressModal visible progress={progress} />);
    expect(textOf(byTestId(tree, `${MODAL}-title`)[0])).toContain('Saving');
  });

  it('summarises how much landed once the sync completes', () => {
    const progress = progressFixture({
      stage: 'done',
      completedAreas: HEALTHKIT_DESCRIPTORS.length,
      result: importResult({ imported: 3, weightImported: 1, samplesRead: 4 }),
    });
    const tree = render(<HealthKitSyncProgressModal visible progress={progress} />);
    expect(textOf(byTestId(tree, `${MODAL}-summary`)[0])).toContain('4 entries added');
  });

  it('says "already up to date" rather than "0 entries" when nothing new landed', () => {
    const progress = progressFixture({ stage: 'done', result: importResult() });
    const tree = render(<HealthKitSyncProgressModal visible progress={progress} />);
    expect(textOf(byTestId(tree, `${MODAL}-summary`)[0])).toContain('already up to date');
  });

  it('mentions days already matching Apple Health, without a raw skip count of zero', () => {
    const withSkips = render(
      <HealthKitSyncProgressModal
        visible
        progress={progressFixture({
          stage: 'done',
          result: importResult({ imported: 1, samplesRead: 1, skipped: [{ date: '2026-07-01', entry_type: 'steps', reason: 'unchanged' }] }),
        })}
      />,
    );
    expect(textOf(byTestId(withSkips, `${MODAL}-summary`)[0])).toContain('already matched');

    const withoutSkips = render(
      <HealthKitSyncProgressModal
        visible
        progress={progressFixture({ stage: 'done', result: importResult({ imported: 1, samplesRead: 1 }) })}
      />,
    );
    expect(textOf(byTestId(withoutSkips, `${MODAL}-summary`)[0])).not.toContain('already matched');
  });
});

describe('HealthKitSyncProgressModal — hold-open after completion', () => {
  it('stays open for a beat after `visible` drops, then closes on its own', () => {
    jest.useFakeTimers();
    try {
      const progress = progressFixture({ stage: 'done', result: importResult({ imported: 2, samplesRead: 2 }) });

      let tree!: Rendered;
      act(() => {
        tree = ReactTestRenderer.create(
          <ThemeProvider>
            <HealthKitSyncProgressModal visible progress={progress} />
          </ThemeProvider>,
        );
      });
      expect(byTestId(tree, MODAL)).not.toHaveLength(0);

      act(() => {
        tree.update(
          <ThemeProvider>
            <HealthKitSyncProgressModal visible={false} progress={progress} />
          </ThemeProvider>,
        );
      });
      // Still up immediately after `visible` drops — the summary gets a beat.
      expect(byTestId(tree, MODAL)).not.toHaveLength(0);

      act(() => {
        jest.advanceTimersByTime(2000);
      });
      expect(byTestId(tree, MODAL)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not linger after `visible` drops mid-sync (no "done" stage reached)', () => {
    jest.useFakeTimers();
    try {
      const progress = progressFixture({ stage: 'reading' });

      let tree!: Rendered;
      act(() => {
        tree = ReactTestRenderer.create(
          <ThemeProvider>
            <HealthKitSyncProgressModal visible progress={progress} />
          </ThemeProvider>,
        );
      });

      act(() => {
        tree.update(
          <ThemeProvider>
            <HealthKitSyncProgressModal visible={false} progress={progress} />
          </ThemeProvider>,
        );
      });
      expect(byTestId(tree, MODAL)).toHaveLength(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
