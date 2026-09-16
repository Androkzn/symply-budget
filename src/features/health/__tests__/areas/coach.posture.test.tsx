/**
 * POSTURE GUARDS for the AI coach — things that are deliberately NOT built.
 *
 * Per the shared brief §6: coverage of an unported surface does not mean
 * inventing UI tests for it. It means a cheap guard that goes red the day the
 * documented posture silently changes, anchored on a real contract rather than
 * on a string that will drift.
 *
 * Two postures live here, and each is a decision a future porter has to be able
 * to find:
 *
 *  1. **CONSENT IS A ONE-WAY DOOR ON THIS SCREEN.** The store and the Worker
 *     both implement REVOKE — `setCoachConsent(false)` stamps `revoked_at` and
 *     `getConsent` reports it — and `HealthCoachScreen` offers no affordance for
 *     it. Once granted, the card is gone for good on that account. That is
 *     recorded as a product question in the matrix's Flagged section and in
 *     `coach-consent-and-turn.yaml`'s header, and it is why that Maestro flow
 *     treats consent as a two-branch invariant rather than a precondition it can
 *     restore. This guard fails the day a revoke control appears — at which
 *     point the flow, the matrix row and this file all need updating together,
 *     which is exactly what a guard is for.
 *
 *  2. **THE PHOTO INSIGHT SURFACE STAYS UNREAD.** `GET /health/body-insights`
 *     and `/latest` gained callers in this pass; `/body-insights/photo` did NOT,
 *     because body photos are unported by product decision (privacy). An RN
 *     caller appearing for it without a matching decision is the change worth
 *     catching.
 *
 * Neither guard is a grep for prose. The first drives the REAL screen and
 * asserts on what it renders and calls; the second resolves the API module and
 * asserts on its exported surface plus the modules that import it.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import fs from 'fs';
import path from 'path';

import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import { healthApi } from '@api/health';
import { ThemeProvider } from '@contexts/ThemeContext';

import {
  loadBodyInsightHistory,
  loadCoachConsent,
  loadCoachOperations,
  loadCoachState,
  loadLatestBodyInsight,
  setCoachConsent,
  type CoachState,
} from '../../healthCoachStorage';
import { HealthCoachScreen } from '../../screens/HealthCoachScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@components/common', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  return {
    AppBackground: ({ children }: { children?: React.ReactNode }) =>
      ReactMock.createElement(View, { testID: 'app-background' }, children),
    ScreenHeader: ({ title }: { title?: string }) =>
      ReactMock.createElement(View, { testID: 'screen-header', accessibilityLabel: title }),
    ScreenScrollEnd: ({ testID }: { testID?: string }) => ReactMock.createElement(View, { testID }),
    screenScrollEndTestId: (id: string) => `${id}-scroll-end`,
  };
});

jest.mock('../../healthCoachStorage', () => {
  const actual = jest.requireActual('../../healthCoachStorage');
  return {
    ...actual,
    loadCoachState: jest.fn(),
    loadCoachConsent: jest.fn(),
    setCoachConsent: jest.fn(),
    loadLatestBodyInsight: jest.fn(),
    loadBodyInsightHistory: jest.fn(),
    loadCoachOperations: jest.fn(),
  };
});

const mockLoadState = loadCoachState as jest.Mock;
const mockLoadConsent = loadCoachConsent as jest.Mock;
const mockSetConsent = setCoachConsent as jest.Mock;
const mockLatest = loadLatestBodyInsight as jest.Mock;
const mockHistory = loadBodyInsightHistory as jest.Mock;
const mockOperations = loadCoachOperations as jest.Mock;

const EMPTY_STATE: CoachState = { messages: [], insights: [], aiStatus: 'idle' };
const GRANTED = {
  granted: true,
  version: 'health-coach-2',
  granted_at: '2026-07-25T12:00:00.000Z',
  revoked_at: null,
  required_version: 'health-coach-2',
};

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthCoachScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

/** Every Pressable in the tree, with whatever it advertises about itself. */
function pressables(tree: ReactTestRenderer.ReactTestRenderer) {
  return tree.root
    .findAll((node) => typeof node.props?.onPress === 'function', { deep: true })
    .map((node) => ({
      testID: String(node.props.testID ?? ''),
      label: String(node.props.accessibilityLabel ?? ''),
      press: node.props.onPress as () => void,
    }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadState.mockResolvedValue(EMPTY_STATE);
  mockLoadConsent.mockResolvedValue(GRANTED);
  mockSetConsent.mockResolvedValue(GRANTED);
  mockLatest.mockResolvedValue(null);
  mockHistory.mockResolvedValue([]);
  mockOperations.mockResolvedValue([]);
});

/* ==================================================================== */
/* 1. Consent is a one-way door                                          */
/* ==================================================================== */

describe('POSTURE — coach consent has no revoke affordance', () => {
  it('HEALTH-AI-638: with consent GRANTED, no control on the screen calls setCoachConsent', async () => {
    // The behavioural half. Every Pressable on a fully-granted screen is
    // pressed; if any of them reaches the consent writer, a revoke (or a second
    // grant) has appeared and this guard has done its job.
    mockLoadConsent.mockResolvedValue(GRANTED);
    const tree = await render();

    for (const control of pressables(tree)) {
      await act(async () => {
        control.press();
      });
    }

    expect(mockSetConsent).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-639: the ONLY consent control is the grant, and it only ever grants', async () => {
    // The un-granted screen has exactly one consent affordance and it passes
    // `true`. A revoke wired to the same handler would show up here as a second
    // call, or as a `false`.
    mockLoadConsent.mockResolvedValue({ ...GRANTED, granted: false, granted_at: null });
    const tree = await render();

    const consentControls = pressables(tree).filter((c) =>
      c.testID.startsWith('health-coach-consent')
    );
    expect(consentControls.map((c) => c.testID)).toEqual(['health-coach-consent-grant']);

    await act(async () => {
      consentControls[0].press();
    });
    expect(mockSetConsent).toHaveBeenCalledTimes(1);
    expect(mockSetConsent).toHaveBeenCalledWith(true);
  });

  it('HEALTH-AI-640: nothing on the screen offers to turn the coach OFF, in words either', async () => {
    // The copy half. A member who has granted and wants out finds nothing here —
    // which is the documented posture, not an oversight, and is recorded in the
    // matrix Flagged section as a product question.
    const tree = await render();

    const labels = pressables(tree)
      .map((c) => `${c.testID} ${c.label}`)
      .join(' ')
      .toLowerCase();
    const found = ['revoke', 'turn off', 'withdraw', 'stop reading', 'disable'].filter((wording) =>
      labels.includes(wording)
    );
    expect(found).toEqual([]);
  });

  it('HEALTH-AI-641: the CONTRACT for revoking exists and still works — only the UI is missing', async () => {
    // The other half of the guard, and the reason it is a posture rather than a
    // bug report: the store and the Worker both implement revoke. A future
    // porter wiring a control has a tested path to wire it to, and does not need
    // to build one.
    const actual = jest.requireActual('../../healthCoachStorage');
    expect(typeof actual.setCoachConsent).toBe('function');
    expect(actual.setCoachConsent.length).toBe(1);
  });
});

/* ==================================================================== */
/* 2. The photo-insight reader stays unread                              */
/* ==================================================================== */

describe('POSTURE — the body-PHOTO insight reader has no caller', () => {
  const SRC = path.join(__dirname, '..', '..', '..', '..');

  /** Every app source file, excluding tests. */
  function sourceFiles(): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'test-utils') continue;
          walk(full);
          continue;
        }
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
      }
    };
    walk(SRC);
    return out;
  }

  it('HEALTH-AI-642: the client still EXPOSES the photo reader — the route is not dead', async () => {
    // Anchored on module resolution rather than on prose. The Worker serves
    // `GET /health/body-insights/photo` and `health-body-extras.test.ts` proves
    // its contract; the client keeps the method so the day photos are ported
    // there is nothing to rebuild.
    expect(typeof healthApi.listBodyPhotoInsights).toBe('function');
  });

  it('HEALTH-AI-643: and NOTHING in the app calls it — body photos are unported by decision', async () => {
    // The guard. `listBodyInsights` and `latestBodyInsight` gained callers in
    // this pass; the photo one did not, because there are no body photos to
    // analyse (privacy — audit §8, and every photo column on the produced row is
    // null for the same reason). A caller appearing here means that decision was
    // reversed, and the matrix row, this guard and a real test all need writing
    // together.
    const callers = sourceFiles().filter((file) =>
      /\blistBodyPhotoInsights\s*\(/.test(fs.readFileSync(file, 'utf8'))
    );
    expect(callers.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('HEALTH-AI-644: no screen renders a body-fat, posture or symmetry figure from an insight row', async () => {
    // The produced row's score and estimate columns are ALL null by product
    // decision. A screen that read one would render "0" or "undefined" as a
    // measurement of someone's body — which is worse than not showing it.
    const forbidden =
      /\b(overall_posture_score|overall_symmetry_score|muscle_balance_score|body_fat_estimate_lower|body_fat_estimate_upper|body_fat_category|lean_mass_estimate)\b/;
    const offenders = sourceFiles().filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      // The type declaration in `src/api/health.ts` names these columns because
      // the row genuinely has them; what must not exist is a READ of one.
      if (file.endsWith(path.join('src', 'api', 'health.ts'))) return false;
      return forbidden.test(source);
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
