/**
 * Symply Health SCAN tab — the nutrition-label and meal-photo readers.
 *
 * Renders the REAL screen through <ThemeProvider>. The API client is mocked, so
 * no case here reaches a model; the picker modules are mocked because a test
 * runner has no camera.
 *
 * The invariants these cases exist to pin:
 *
 *  1. **NOTHING is saved by a scan.** The draft is a reading; only Save writes,
 *     and it writes through the ordinary food path with `source_type: 'scanned'`.
 *  2. **The per-100 basis is never computed here.** `src/api/healthFood.ts` calls
 *     that the recompute-on-device trap. Save sends the SERVING and the macros
 *     for that serving, and the Worker derives the basis — so a label with no
 *     serving size sends 100 g and the label's own per-100 figures instead of
 *     dividing anything on the device.
 *  3. **A missing figure reads as missing**, not as zero. "Not on the label" is a
 *     fact; a dash or a 0 is a claim the label did not make.
 *  4. **Every failure is plain words mapped from the STATUS**, never a server
 *     message and never an axios string.
 *  5. **A meal-photo/scale draft is reviewable and saveable.** `HealthScanReview`
 *     closes the old "not built yet" dead end — Save files the kept rows into
 *     the diary in one request (`logScannedFoodsToDiary`), and this suite pins
 *     that the screen resets and confirms only once that write has landed.
 */

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports, so they must use require() */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';

import {
  healthAiApi,
  type HealthMealPhotoDraft,
  type HealthMealPhotoFood,
  type HealthNutritionLabelDraft,
} from '@api/healthAi';
import { ThemeProvider } from '@contexts/ThemeContext';

import { createFood } from '../../healthFoodStorage';
import { logScannedFoodsToDiary } from '../../healthNutritionStorage';
import { HealthScanScreen, scanFailureMessage } from '../HealthScanScreen';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }),
}));

jest.mock('@api/healthAi');
jest.mock('../../healthFoodStorage', () => ({
  ...jest.requireActual('../../healthFoodStorage'),
  createFood: jest.fn(),
}));
jest.mock('../../healthNutritionStorage', () => ({
  ...jest.requireActual('../../healthNutritionStorage'),
  logScannedFoodsToDiary: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(async () => 'ZmFrZS1iYXNlNjQ='),
}));
jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate: () => ({ renderAsync: async () => ({ saveAsync: async () => ({ uri: 'file:///x.jpg' }) }) }),
  },
  SaveFormat: { JPEG: 'jpeg' },
}));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('@services/image-picker-compat', () => ({
  __esModule: true,
  default: { openCamera: jest.fn(), openPicker: jest.fn() },
}));

// The live guided camera (`HealthScanCamera`) is mounted for every mode (just
// hidden via its own `visible` prop), so its own native dependencies need a
// seam here too — pinned in depth by `HealthScanCamera.test.tsx`.
const mockTakePictureAsync = jest.fn();
jest.mock('expo-camera', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  const CameraView = ReactMock.forwardRef((props: Record<string, unknown>, ref: unknown) => {
    ReactMock.useImperativeHandle(ref, () => ({ takePictureAsync: mockTakePictureAsync }));
    return ReactMock.createElement(View, { testID: 'health-scan-camera-view', ...props });
  });
  return {
    __esModule: true,
    CameraView,
    useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
  };
});
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('@components/cloud-storage', () => {
  const ReactMock = require('react');
  const { View } = require('react-native');
  // Rendered as a host node carrying its props so a case can drive the two
  // callbacks (pick / close) without a Google session.
  return {
    CloudFilePicker: (props: Record<string, unknown>) =>
      ReactMock.createElement(View, { testID: 'cloud-file-picker', ...props }),
  };
});

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
    ProcessingOverlay: ({ visible, message }: { visible: boolean; message?: string }) =>
      visible
        ? ReactMock.createElement(View, {
            testID: 'health-scan-overlay',
            accessibilityLabel: message,
          })
        : null,
    ScanImportSources: (props: Record<string, unknown>) =>
      ReactMock.createElement(View, { testID: 'scan-import-sources', ...props }),
  };
});

const api = healthAiApi as unknown as jest.Mocked<typeof healthAiApi>;
const ImageCropPicker = jest.requireMock('@services/image-picker-compat').default as {
  openCamera: jest.Mock;
  openPicker: jest.Mock;
};
const DocumentPicker = jest.requireMock('expo-document-picker') as {
  getDocumentAsync: jest.Mock;
};
const FileSystem = jest.requireMock('expo-file-system/legacy') as {
  readAsStringAsync: jest.Mock;
};
const mockCreateFood = createFood as jest.Mock;
const mockLogScannedFoods = logScannedFoodsToDiary as jest.Mock;

/** A meal-photo food row, as `analyzeMealPhoto` hands it over. */
function mealFood(over: Partial<HealthMealPhotoFood> = {}): HealthMealPhotoFood {
  return {
    food_name: 'Chicken breast',
    brand: null,
    cooking_state: 'cooked',
    portion: 150,
    unit: 'g',
    calories: 248,
    proteins: 46,
    carbohydrates: 0,
    fats: 5,
    fiber: null,
    sugar: null,
    calories_per_100g: 165,
    proteins_per_100g: 31,
    carbs_per_100g: 0,
    fats_per_100g: 3.6,
    confidence: 0.9,
    data_source: 'nutrition_label',
    ...over,
  };
}

function mealDraft(over: Partial<HealthMealPhotoDraft> = {}): HealthMealPhotoDraft {
  return {
    foods: [mealFood()],
    scale_reading: null,
    meal_type: null,
    total_calories: 248,
    image_quality: 'good',
    notes: null,
    ...over,
  };
}

/** Drive the screen into meal mode, attach a shot, and run the scan. */
async function runMealScan(draft: HealthMealPhotoDraft) {
  api.analyzeMealPhoto.mockResolvedValue({ draft });
  const tree = await render();
  await act(async () => {
    tree.root.findByProps({ testID: 'health-scan-mode-meal' }).props.onPress();
  });
  await attachShot(tree, 'plate.jpg');
  await act(async () => {
    tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
  });
  return tree;
}

function labelDraft(over: Partial<HealthNutritionLabelDraft> = {}): HealthNutritionLabelDraft {
  return {
    product_name: 'Greek Yoghurt',
    brand: 'Symply Dairy',
    serving_size: '3/4 cup (170g)',
    serving_size_g: 170,
    serving_size_unit: 'g',
    servings_per_container: 4,
    calories: 150,
    proteins: 15,
    carbohydrates: 12,
    fats: 4,
    saturated_fat: 2,
    trans_fat: 0,
    cholesterol: null,
    sodium: null,
    dietary_fiber: null,
    total_sugars: null,
    added_sugars: null,
    vitamin_d: null,
    calcium: null,
    iron: null,
    potassium: null,
    ingredients: null,
    base_calories_per_100: 88.2,
    base_proteins_per_100: 8.8,
    base_carbs_per_100: 7.1,
    base_fats_per_100: 2.4,
    per_100_source: 'derived',
    confidence: 0.94,
    notes: null,
    ...over,
  };
}

async function render() {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = ReactTestRenderer.create(
      <ThemeProvider>
        <HealthScanScreen />
      </ThemeProvider>
    );
  });
  return tree;
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance | string) => {
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as never);
  };
  walk(tree.root);
  return out.join(' ');
}

/**
 * Attach one shot so a scan can be run. Goes through the GALLERY tile
 * (`ImageCropPicker.openPicker`), not Camera — Camera's own behaviour now
 * differs by mode (meal keeps the system camera; label/scale open the live
 * guided `HealthScanCamera`, pinned separately in `HealthScanCamera.test.tsx`
 * and the "guided camera" cases below), while Gallery is unchanged across all
 * three and, unlike a real camera, can plausibly hand back any extension —
 * which is what the HEIC/PNG/WebP re-encode cases below need.
 */
async function attachShot(tree: ReactTestRenderer.ReactTestRenderer, name = 'label.jpg') {
  ImageCropPicker.openPicker.mockResolvedValue({ path: 'file:///a.jpg', filename: name });
  await act(async () => {
    tree.root.findByProps({ testID: 'scan-import-sources' }).props.onGallery();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateFood.mockResolvedValue({ foods: [], status: 'saved', message: null });
  mockLogScannedFoods.mockResolvedValue({ entries: [], logged: 1, status: 'logged', message: null });
  FileSystem.readAsStringAsync.mockResolvedValue('ZmFrZS1iYXNlNjQ=');
});

describe('HealthScanScreen', () => {
  it('HEALTH-AI-280: renders both modes and the shared source row, label first', async () => {
    const tree = await render();
    expect(tree.root.findByProps({ testID: 'health-scan-screen' })).toBeTruthy();
    // The shared Camera/Gallery/File/Drive row, never a re-forked set of buttons.
    expect(tree.root.findByProps({ testID: 'scan-import-sources' })).toBeTruthy();
    // `findByProps` returns the innermost match; the selected state lives on
    // the Pressable, so read it off whichever node actually carries it.
    expect(
      tree.root
        .findAllByProps({ testID: 'health-scan-mode-label' })
        .some((n) => n.props.accessibilityState?.selected === true)
    ).toBe(true);
    expect(textOf(tree)).toContain('Photograph the Nutrition Facts panel');
  });

  it('HEALTH-AI-281: Read is disabled until an image is attached', async () => {
    const tree = await render();
    expect(
      tree.root.findByProps({ testID: 'health-scan-run' }).props.accessibilityState.disabled
    ).toBe(true);

    await attachShot(tree);
    expect(
      tree.root.findByProps({ testID: 'health-scan-run' }).props.accessibilityState.disabled
    ).toBe(false);
  });

  it('HEALTH-AI-282: a label scan renders the draft and saves NOTHING on its own', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'health-scan-label-draft' })).toBeTruthy();
    expect(textOf(tree)).toContain('Nothing is saved yet');
    expect(mockCreateFood).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-283: Save sends the SERVING and its macros — never a per-100 basis', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });

    expect(mockCreateFood).toHaveBeenCalledWith({
      name: 'Greek Yoghurt',
      brand: 'Symply Dairy',
      portion: 170,
      unit: 'g',
      calories: 150,
      protein: 15,
      carbs: 12,
      fat: 4,
      isFavorite: false,
      sourceType: 'scanned',
    });
  });

  it('HEALTH-AI-284: a per-100-only label saves 100 g of the per-100 figures, with no division here', async () => {
    // EU/UK labels commonly print no serving size. Sending 100 g plus the
    // label's own per-100 column is the same statement with no client
    // arithmetic — the Worker still derives the basis.
    api.scanNutritionLabel.mockResolvedValue({
      draft: labelDraft({
        serving_size_g: null,
        serving_size: 'per 100 g',
        calories: null,
        proteins: null,
        carbohydrates: null,
        fats: null,
        base_calories_per_100: 88,
        base_proteins_per_100: 9,
        base_carbs_per_100: 7,
        base_fats_per_100: 2.4,
        per_100_source: 'label',
      }),
    });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });

    expect(mockCreateFood).toHaveBeenCalledWith(
      expect.objectContaining({ portion: 100, calories: 88, protein: 9, carbs: 7, fat: 2.4 })
    );
  });

  it('HEALTH-AI-285: the basis note says WHERE the per-100 figures came from', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft({ per_100_source: 'label' }) });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(textOf(tree)).toContain("copied from the label's own column");

    api.scanNutritionLabel.mockResolvedValue({
      draft: labelDraft({ per_100_source: 'none', serving_size_g: null }),
    });
    const second = await render();
    await attachShot(second);
    await act(async () => {
      second.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(textOf(second)).toContain('cannot be re-portioned later');
  });

  it('HEALTH-AI-286: a figure the label did not carry reads as missing, never as 0', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft({ proteins: null }) });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    const protein = tree.root.findByProps({ testID: 'health-scan-protein' });
    expect(JSON.stringify(protein.props)).not.toContain('0 g');
    expect(textOf(tree)).toContain('Not on the label');
  });

  it('HEALTH-AI-287: a low-confidence reading tells the person to check it', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft({ confidence: 0.4 }) });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(tree.root.findByProps({ testID: 'health-scan-low-confidence' })).toBeTruthy();
  });

  it('HEALTH-AI-288: the meal mode shows provenance per row and offers a real Save', async () => {
    api.analyzeMealPhoto.mockResolvedValue({
      draft: {
        foods: [
          {
            food_name: 'Chicken breast',
            brand: null,
            cooking_state: 'cooked',
            portion: 150,
            unit: 'g',
            calories: 248,
            proteins: 46,
            carbohydrates: 0,
            fats: 5,
            fiber: null,
            sugar: null,
            calories_per_100g: 165,
            proteins_per_100g: 31,
            carbs_per_100g: 0,
            fats_per_100g: 3.6,
            confidence: 0.5,
            data_source: 'estimation',
          },
        ],
        scale_reading: { value: 150, unit: 'g', detected: true },
        meal_type: null,
        total_calories: 248,
        image_quality: 'good',
        notes: null,
      },
    });
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-meal' }).props.onPress();
    });
    await attachShot(tree, 'plate.jpg');
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'health-scan-meal-draft' })).toBeTruthy();
    // The provenance chip is the one thing that tells a reading from a guess.
    expect(textOf(tree)).toContain('Estimated');
    expect(textOf(tree)).toContain('Scale reading');
    // REGRESSION: this card used to dead-end at "not built yet" — it now has a
    // real Save that is enabled once a calorie-bearing row is on screen, and
    // nothing has gone over the wire yet.
    const save = tree.root.findByProps({ testID: 'health-scan-review-save' });
    expect(save.props.accessibilityState.disabled).toBe(false);
    expect(mockLogScannedFoods).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-289: switching mode clears the draft rather than showing a stale one', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-meal' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' })).toHaveLength(0);
  });

  it('HEALTH-AI-290: the blocking overlay is the SHARED one, and only while scanning', async () => {
    let release: (value: { draft: HealthNutritionLabelDraft }) => void = () => {};
    api.scanNutritionLabel.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    // The overlay ELEMENT is always in the tree (it owns its own `visible`
    // prop), so presence is asserted on what it RENDERS — the mock emits a host
    // node carrying the message only while visible.
    const shown = () =>
      tree.root.findAllByProps({ accessibilityLabel: 'Reading that label…' }).length;

    const tree = await render();
    await attachShot(tree);
    expect(shown()).toBe(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(shown()).toBeGreaterThan(0);

    await act(async () => {
      release({ draft: labelDraft() });
    });
    expect(shown()).toBe(0);
  });

  it('HEALTH-AI-291: every failure is mapped from the STATUS, in plain words', () => {
    const status = (n: number) => ({ response: { status: n, data: { error: { message: 'raw' } } } });

    // The denial names WHERE to fix it, not just that it is denied.
    expect(scanFailureMessage(status(403), 'label')).toContain('More → AI access');
    expect(scanFailureMessage(status(415), 'label')).toContain('JPEG or PNG');
    expect(scanFailureMessage(status(422), 'label')).toContain('No nutrition information');
    expect(scanFailureMessage(status(422), 'meal')).toContain('No food could be identified');
    expect(scanFailureMessage(status(429), 'label')).toContain('few minutes');
    expect(scanFailureMessage(new Error('Network request failed'), 'label')).toContain(
      'could not be reached'
    );

    for (const code of [403, 415, 422, 429, 500]) {
      const copy = scanFailureMessage(status(code), 'label');
      expect(copy).not.toContain('raw');
      expect(copy).not.toMatch(/Error|undefined|null|\b\d{3}\b/);
    }
  });

  it('HEALTH-AI-292: a failed scan surfaces that copy on the screen', async () => {
    api.scanNutritionLabel.mockRejectedValue({ response: { status: 415 } });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    expect(tree.root.findByProps({ testID: 'health-scan-message' })).toBeTruthy();
    expect(textOf(tree)).toContain('JPEG or PNG');
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' })).toHaveLength(0);
  });

  /* ---- where the images come from ---- */

  it('HEALTH-AI-310: a camera failure is explained; a cancel is silent, and an unnamed shot still has a name', async () => {
    // Meal mode: the ONE mode whose Camera tile is still the plain system
    // camera (`FoodImageAnalysis/FoodCameraView.swift` has no custom frame at
    // all) — label/scale route through the live guided camera instead, see
    // the "guided camera" cases below.
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-meal' }).props.onPress();
    });

    // Backing out of the camera is not a failure and must not leave a message
    // card behind — the member simply changed their mind.
    ImageCropPicker.openCamera.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onCamera();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-message' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'health-scan-shots' })).toHaveLength(0);

    ImageCropPicker.openCamera.mockRejectedValue({ code: 'E_NO_CAMERA_PERMISSION' });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onCamera();
    });
    expect(textOf(tree)).toContain('The camera could not be opened.');
    expect(textOf(tree)).not.toContain('E_NO_CAMERA_PERMISSION');

    // Some cameras hand back no filename at all; the row still has to be
    // listed and removable.
    ImageCropPicker.openCamera.mockResolvedValue({ path: 'file:///a.jpg', filename: null });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onCamera();
    });
    expect(textOf(tree)).toContain('scan.jpg');
  });

  /* ---- the live guided camera (label/scale) ---- */

  it('HEALTH-AI-330: label mode opens the live guided camera, not the system one', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-view' })).toHaveLength(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onCamera();
    });

    expect(tree.root.findByProps({ testID: 'health-scan-camera-view' })).toBeTruthy();
    expect(ImageCropPicker.openCamera).not.toHaveBeenCalled();
  });

  it('HEALTH-AI-331: the guided camera shutter adds a shot and closes the camera', async () => {
    mockTakePictureAsync.mockResolvedValue({ uri: 'file:///scale.jpg', width: 10, height: 10, format: 'jpg' });
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-scale' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onCamera();
    });
    expect(tree.root.findByProps({ testID: 'health-scan-camera-view' })).toBeTruthy();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-camera-shutter' }).props.onPress();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockTakePictureAsync).toHaveBeenCalledTimes(1);
    expect(tree.root.findByProps({ testID: 'health-scan-shots' })).toBeTruthy();
    // The captured shot is a synthesised name, not something a user typed.
    expect(textOf(tree)).toMatch(/scan-\d+\.jpg/);
  });

  it('HEALTH-AI-311: the gallery takes several shots at once, and reports only real failures', async () => {
    const tree = await render();

    ImageCropPicker.openPicker.mockResolvedValue([
      { path: 'file:///panel.jpg', filename: 'panel.jpg' },
      { path: 'file:///front.jpg', filename: 'front.jpg' },
    ]);
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onGallery();
    });
    expect(textOf(tree)).toContain('panel.jpg');
    expect(textOf(tree)).toContain('front.jpg');
    expect(textOf(tree)).toContain('2 of 4 images');

    // A picker configured for multiple can still answer with ONE object.
    ImageCropPicker.openPicker.mockResolvedValue({ path: 'file:///side.jpg', filename: null });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onGallery();
    });
    expect(textOf(tree)).toContain('scan.jpg');

    ImageCropPicker.openPicker.mockRejectedValue({ code: 'E_PICKER_CANCELLED' });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onGallery();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-message' })).toHaveLength(0);

    ImageCropPicker.openPicker.mockRejectedValue(new Error('permission denied'));
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onGallery();
    });
    expect(textOf(tree)).toContain('The photo library could not be opened.');
    expect(textOf(tree)).not.toContain('permission denied');
  });

  it('HEALTH-AI-312: the file picker adds every chosen file, and a cancel adds none', async () => {
    const tree = await render();

    DocumentPicker.getDocumentAsync.mockResolvedValue({ canceled: true });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onFile();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-shots' })).toHaveLength(0);

    DocumentPicker.getDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'file:///a.png', name: 'panel.png' },
        { uri: 'file:///b.png', name: null },
      ],
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onFile();
    });
    expect(textOf(tree)).toContain('panel.png');
    expect(textOf(tree)).toContain('scan.jpg');

    DocumentPicker.getDocumentAsync.mockRejectedValue(new Error('EACCES /storage'));
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onFile();
    });
    expect(textOf(tree)).toContain('The file picker could not be opened.');
    expect(textOf(tree)).not.toContain('EACCES');
  });

  it('HEALTH-AI-313: a Drive pick adds the file and closes the picker', async () => {
    const tree = await render();
    expect(tree.root.findAllByProps({ testID: 'cloud-file-picker' })).toHaveLength(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onDrive();
    });
    const picker = tree.root.findByProps({ testID: 'cloud-file-picker' });
    // Only image types the Worker's sniffer accepts are offered.
    expect(picker.props.mimeTypeFilter).toEqual(['image/jpeg', 'image/png', 'image/webp']);

    await act(async () => {
      picker.props.onFileSelected({ uri: 'drive:///x', name: '' });
    });
    expect(textOf(tree)).toContain('scan.jpg');
    expect(tree.root.findAllByProps({ testID: 'cloud-file-picker' })).toHaveLength(0);

    // Closing without choosing adds nothing.
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onDrive();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'cloud-file-picker' }).props.onClose();
    });
    expect(tree.root.findAllByProps({ testID: 'cloud-file-picker' })).toHaveLength(0);
    expect(textOf(tree)).toContain('1 of 4 images');
  });

  it('HEALTH-AI-314: four images is the ceiling, it says so, and one can be taken back off', async () => {
    const tree = await render();
    for (const name of ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg']) {
      await attachShot(tree, name);
    }

    // The fifth is dropped rather than silently replacing one of the four the
    // member already lined up.
    expect(textOf(tree)).not.toContain('e.jpg');
    expect(textOf(tree)).toContain('That is the most this can read at once (4).');
    expect(
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.disabled
    ).toBe(true);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-remove-1' }).props.onPress();
    });
    expect(textOf(tree)).not.toContain('b.jpg');
    expect(textOf(tree)).toContain('3 of 4 images');
    expect(
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.disabled
    ).toBe(false);
  });

  it('HEALTH-AI-315: choosing the mode already selected keeps the draft on screen', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' }).length).toBeGreaterThan(0);

    // Re-tapping the selected chip is a no-op, not a reset — losing an
    // unreviewed draft to a stray tap costs another model call.
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-label' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' }).length).toBeGreaterThan(0);
    expect(textOf(tree)).toContain('label.jpg');
  });

  it('HEALTH-AI-316: Read does nothing with no image, and nothing again while one is in flight', async () => {
    let release: (value: { draft: HealthNutritionLabelDraft }) => void = () => {};
    api.scanNutritionLabel.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const tree = await render();

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(api.scanNutritionLabel).not.toHaveBeenCalled();

    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    // A second tap under the overlay must not buy a second vision call.
    expect(api.scanNutritionLabel).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ draft: labelDraft() });
    });
  });

  it('HEALTH-AI-317: a HEIC photo is re-encoded to JPEG; PNG and WebP go up as themselves', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree, 'panel.png');
    await attachShot(tree, 'front.webp');
    await attachShot(tree, 'IMG_0042.HEIC');
    await attachShot(tree, 'side.jpeg');

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    // The Worker identifies the type from the MAGIC BYTES and refuses what it
    // does not know, so a HEIC forwarded as-is comes back as "could not read
    // that label" — the re-encode has to happen on the device.
    expect(api.scanNutritionLabel).toHaveBeenCalledWith([
      { data: 'ZmFrZS1iYXNlNjQ=', media_type: 'image/png' },
      { data: 'ZmFrZS1iYXNlNjQ=', media_type: 'image/webp' },
      { data: 'ZmFrZS1iYXNlNjQ=', media_type: 'image/jpeg' },
      { data: 'ZmFrZS1iYXNlNjQ=', media_type: 'image/jpeg' },
    ]);
    // The re-encode reads the RENDERED file, never the original HEIC.
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///x.jpg', {
      encoding: 'base64',
    });
  });

  /* ---- what comes back ---- */

  it('HEALTH-AI-318: a meal photo with nothing identified says so and shows no review card', async () => {
    const tree = await runMealScan(mealDraft({ foods: [], total_calories: null }));

    expect(textOf(tree)).toContain('No food could be identified in that photo');
    expect(tree.root.findAllByProps({ testID: 'health-scan-meal-draft' })).toHaveLength(0);
  });

  it('HEALTH-AI-319: a meal draft with no food list renders the empty state, not a white screen', async () => {
    // REGRESSION. `foods` was stored exactly as it arrived and then indexed on
    // the next render, so a payload that omitted the key threw during render —
    // a blank screen instead of "nothing was identified".
    const tree = await runMealScan({ total_calories: null } as unknown as HealthMealPhotoDraft);

    expect(tree.root.findByProps({ testID: 'health-scan-screen' })).toBeTruthy();
    expect(textOf(tree)).toContain('No food could be identified in that photo');
    expect(tree.root.findAllByProps({ testID: 'health-scan-meal-draft' })).toHaveLength(0);
  });

  /* ---- weigh food (scale) — same endpoint as meal, its own copy ---- */

  it('HEALTH-AI-332: scale mode is a third chip, and switching to it clears any draft', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' }).length).toBeGreaterThan(0);

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-scale' }).props.onPress();
    });
    expect(
      tree.root
        .findAllByProps({ testID: 'health-scan-mode-scale' })
        .some((n) => n.props.accessibilityState?.selected === true)
    ).toBe(true);
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' })).toHaveLength(0);
    expect(textOf(tree)).toContain('WEIGH FOOD');
  });

  it('HEALTH-AI-333: scale mode calls the SAME analyzeMealPhoto endpoint as meal mode, not a separate route', async () => {
    api.analyzeMealPhoto.mockResolvedValue({
      draft: mealDraft({ scale_reading: { value: 150, unit: 'g', detected: true } }),
    });
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-scale' }).props.onPress();
    });
    await attachShot(tree, 'plate-on-scale.jpg');
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    expect(api.analyzeMealPhoto).toHaveBeenCalledTimes(1);
    expect(api.scanNutritionLabel).not.toHaveBeenCalled();
    expect(tree.root.findByProps({ testID: 'health-scan-meal-draft' })).toBeTruthy();
    expect(textOf(tree)).toContain('Scale reading');
  });

  it('HEALTH-AI-334: an empty scale result uses the SCALE empty copy, not the meal one', async () => {
    // REGRESSION: the empty-state message was hardcoded to `MODE_COPY.meal`,
    // so a scale scan that found nothing told the member to check their
    // "photo" lighting rather than mentioning the scale display at all.
    api.analyzeMealPhoto.mockResolvedValue({ draft: mealDraft({ foods: [], total_calories: null }) });
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-scale' }).props.onPress();
    });
    await attachShot(tree, 'scale.jpg');
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    expect(textOf(tree)).toContain('No food could be identified on the scale');
    expect(textOf(tree)).not.toContain('No food could be identified in that photo');
  });

  it('HEALTH-AI-335: the scale guided camera frames a dashed guide with a scale icon and no bottom hint row', async () => {
    const tree = await render();
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-mode-scale' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'scan-import-sources' }).props.onCamera();
    });

    expect(tree.root.findByProps({ testID: 'health-scan-camera-frame' })).toBeTruthy();
    expect(tree.root.findAllByProps({ testID: 'health-scan-camera-hints' })).toHaveLength(0);
    expect(textOf(tree)).toContain('Position food on scale in frame');
    expect(textOf(tree)).toContain('Make sure the scale display is visible');
  });

  it('HEALTH-AI-320: every meal row carries a provenance chip, including one the ladder does not name', async () => {
    const tree = await runMealScan(
      mealDraft({
        foods: [
          mealFood({ food_name: 'Yoghurt', data_source: 'nutrition_label' }),
          mealFood({ food_name: 'Berries', data_source: 'estimation' }),
          // The Worker CASTS this field rather than validating it, so a model
          // that answers its own word reaches the screen intact.
          mealFood({
            food_name: 'Granola',
            data_source: 'visual_guess' as HealthMealPhotoFood['data_source'],
          }),
          mealFood({ food_name: 'Honey', data_source: null }),
        ],
      })
    );

    const chip = (index: number) =>
      tree.root.findAllByProps({ testID: `health-scan-review-food-${index}-source` });

    expect(textOf(tree)).toContain('From the label');
    expect(textOf(tree)).toContain('Estimated');
    // An unnamed rung must never render as an EMPTY chip: a blank chip reads as
    // "no caveat" on exactly the row that has not been vouched for.
    expect(textOf(tree)).toContain('Source not stated');
    expect(textOf(tree)).not.toContain('visual_guess');
    // A row the server gave no source for shows no chip at all — that is the
    // one case where silence is honest.
    expect(chip(3)).toHaveLength(0);

    // Anything not on the trusted ladder is flagged in the same colour as an
    // outright estimate.
    const colourOf = (index: number) => chip(index)[0].props.color;
    expect(colourOf(1)).toBe(colourOf(2));
    expect(colourOf(0)).not.toBe(colourOf(1));
  });

  it('HEALTH-AI-321: a meal row missing a figure leaves its field blank, never "undefined" or "NaN"', async () => {
    const tree = await runMealScan(
      mealDraft({
        foods: [
          mealFood({ food_name: 'Salad', portion: null, unit: null, calories: null }),
          mealFood({ food_name: 'Bread', portion: 40, unit: undefined as never }),
        ],
        scale_reading: { value: 150, unit: null, detected: true },
        total_calories: null,
      })
    );

    // Row 0 has no calorie figure, so it starts unchecked rather than included
    // with a fabricated "0" — see `rowsFromDraft` in `HealthScanReview`.
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-food-0-toggle' }).props.accessibilityState
        .checked
    ).toBe(false);
    expect(tree.root.findByProps({ testID: 'health-scan-review-food-0-calories' }).props.value).toBe('');

    // Row 1's portion prefills from what the model actually read. A missing
    // unit falls back to grams, the basis unit, never the word "undefined".
    expect(tree.root.findByProps({ testID: 'health-scan-review-food-1-portion' }).props.value).toBe(
      '40'
    );

    const text = textOf(tree);
    expect(text).toContain('Total not known');
    expect(text).toContain('Scale reading');
    expect(text).not.toMatch(/undefined|null|NaN/);
  });

  /* ---- saving the label draft ---- */

  it('HEALTH-AI-322: a scan with no calorie figure at all refuses to save, and says why', async () => {
    api.scanNutritionLabel.mockResolvedValue({
      draft: labelDraft({ calories: null, base_calories_per_100: null, per_100_source: 'none' }),
    });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });

    expect(mockCreateFood).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('no calorie figure');
    // The draft stays on screen so the figures can still be read off it.
    expect(tree.root.findByProps({ testID: 'health-scan-label-draft' })).toBeTruthy();
  });

  it('HEALTH-AI-323: a label with a serving size but only a per-100 column still saves', async () => {
    // REGRESSION. Plenty of packs print a serving mass and then only a per-100
    // table. The portion and the macros were derived from two different tests,
    // so this landed as "100 g of the per-serving figures" — or, when the
    // per-serving column was blank, as a refusal to save a draft that held a
    // complete basis.
    api.scanNutritionLabel.mockResolvedValue({
      draft: labelDraft({
        serving_size_g: 170,
        serving_size: '1 pot (170 g)',
        calories: null,
        proteins: null,
        carbohydrates: null,
        fats: null,
        base_calories_per_100: 88,
        base_proteins_per_100: 9,
        base_carbs_per_100: 7,
        base_fats_per_100: 2.4,
        per_100_source: 'label',
      }),
    });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });

    // The portion and the macros describe the SAME column, and no arithmetic
    // happened on the device.
    expect(mockCreateFood).toHaveBeenCalledWith(
      expect.objectContaining({ portion: 100, calories: 88, protein: 9, carbs: 7, fat: 2.4 })
    );
  });

  it('HEALTH-AI-324: a macro the label did not carry is saved as 0 FOR THAT PORTION, never as null', async () => {
    api.scanNutritionLabel.mockResolvedValue({
      draft: labelDraft({
        brand: null,
        serving_size_g: null,
        serving_size_unit: null,
        calories: null,
        base_calories_per_100: 88,
        base_proteins_per_100: null,
        base_carbs_per_100: null,
        base_fats_per_100: null,
        per_100_source: 'label',
      }),
    });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    // With no unit on the label, the basis note still names one — grams, the
    // unit the whole `base_*_per_100` contract is written in.
    expect(textOf(tree)).toContain("Per 100 g figures were copied from the label's own column");

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });

    // The route requires a number per macro; 0 g of fat for a 100 g portion is
    // the only value that does not change the calorie basis the Worker derives.
    // An unbranded pack sends NO brand rather than an empty string, so the
    // column stays null instead of holding a blank the row would print.
    expect(mockCreateFood).toHaveBeenCalledWith({
      name: 'Greek Yoghurt',
      brand: undefined,
      portion: 100,
      unit: 'g',
      calories: 88,
      protein: 0,
      carbs: 0,
      fat: 0,
      isFavorite: false,
      sourceType: 'scanned',
    });
  });

  it('HEALTH-AI-325: a save in flight cannot be started twice', async () => {
    let release: (value: { status: string; message: string | null }) => void = () => {};
    mockCreateFood.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });
    expect(
      tree.root.findByProps({ testID: 'health-scan-save' }).props.accessibilityState.disabled
    ).toBe(true);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });
    // A double tap would put the same food in the library twice.
    expect(mockCreateFood).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ status: 'saved', message: null });
    });
    // REGRESSION: the confirmation used to be written and then wiped by the
    // reset in the same batch, so a successful save cleared the whole screen
    // with no word that anything had been saved.
    expect(textOf(tree)).toContain('Greek Yoghurt was added to your food library.');
    // A saved scan clears the way for the next one.
    expect(tree.root.findAllByProps({ testID: 'health-scan-label-draft' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'health-scan-shots' })).toHaveLength(0);
  });

  it('HEALTH-AI-327: an offline save says it will sync, and a refused one keeps the draft', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft() });
    mockCreateFood.mockResolvedValue({
      foods: [],
      status: 'offline',
      message: 'Saved on this device — it will sync when you are back online.',
    });
    const offline = await render();
    await attachShot(offline);
    await act(async () => {
      offline.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      offline.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });
    expect(textOf(offline)).toContain('it will sync when you are back online');
    expect(offline.root.findAllByProps({ testID: 'health-scan-label-draft' })).toHaveLength(0);

    mockCreateFood.mockResolvedValue({
      foods: [],
      status: 'rejected',
      message: 'Those numbers do not add up. Check the portion, calories and macros.',
    });
    const rejected = await render();
    await attachShot(rejected);
    await act(async () => {
      rejected.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      rejected.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });
    const text = textOf(rejected);
    expect(text).toContain('do not add up');
    expect(text).not.toContain('added to your food library');
    // The draft survives a refusal so the figures can be corrected.
    expect(rejected.root.findByProps({ testID: 'health-scan-label-draft' })).toBeTruthy();
  });

  it('HEALTH-AI-326: a millilitre label states its basis in ml, and the model’s note is shown', async () => {
    api.scanNutritionLabel.mockResolvedValue({
      draft: labelDraft({
        serving_size_unit: null,
        per_100_source: 'derived',
        notes: 'The panel was partly obscured by a price sticker.',
      }),
    });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });

    // With no unit stated the basis note still has to name one, and grams is
    // the unit the whole `base_*_per_100` contract is written in.
    expect(textOf(tree)).toContain('Per 100 g figures are worked out from the serving size');
    expect(tree.root.findByProps({ testID: 'health-scan-notes' })).toBeTruthy();
    expect(textOf(tree)).toContain('partly obscured by a price sticker');
  });

  it('HEALTH-AI-293: saving without a name refuses rather than writing an unnamed food', async () => {
    api.scanNutritionLabel.mockResolvedValue({ draft: labelDraft({ product_name: null }) });
    const tree = await render();
    await attachShot(tree);
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-run' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-save' }).props.onPress();
    });

    expect(mockCreateFood).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('Give the food a name');
  });

  /* ---- saving the meal-photo review (the old dead end) ---- */

  it('HEALTH-AI-328: saving the review files the kept rows in ONE bulk request and resets the screen', async () => {
    mockLogScannedFoods.mockResolvedValue({ entries: [], logged: 2, status: 'logged', message: null });
    const tree = await runMealScan(
      mealDraft({
        foods: [mealFood({ food_name: 'Chicken breast' }), mealFood({ food_name: 'Rice', calories: 200 })],
        total_calories: 448,
      })
    );

    await act(async () => {
      // Add to Lunch instead of the row-derived default, to prove the picked
      // slot — not the draft's own `meal_type` — is what gets sent.
      tree.root.findByProps({ testID: 'health-scan-review-slot-lunch' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.onPress();
    });

    expect(mockLogScannedFoods).toHaveBeenCalledTimes(1);
    const [entries] = mockLogScannedFoods.mock.calls[0];
    expect(entries).toEqual([
      expect.objectContaining({ name: 'Chicken breast', slot: 'lunch', calories: 248 }),
      expect.objectContaining({ name: 'Rice', slot: 'lunch', calories: 200 }),
    ]);

    // The confirmation lands and the draft clears, same order-matters contract
    // as the label save: `reset` would otherwise wipe the message it just set.
    expect(textOf(tree)).toContain('Added 2 foods to Lunch.');
    expect(tree.root.findAllByProps({ testID: 'health-scan-meal-draft' })).toHaveLength(0);
    expect(tree.root.findAllByProps({ testID: 'health-scan-shots' })).toHaveLength(0);
  });

  it('HEALTH-AI-329: a row can be excluded, and the draft stays put when nothing lands', async () => {
    const tree = await runMealScan(
      mealDraft({ foods: [mealFood({ food_name: 'Chicken breast' })], total_calories: 248 })
    );

    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-food-0-toggle' }).props.onPress();
    });
    expect(
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.accessibilityState.disabled
    ).toBe(true);

    // A refusal (nothing checked, or the write itself failing) leaves the
    // draft on screen so the member is not left re-scanning the same plate.
    mockLogScannedFoods.mockResolvedValue({
      entries: [],
      logged: 0,
      status: 'failed',
      message: 'That did not save. Check your connection and try again.',
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-food-0-toggle' }).props.onPress();
    });
    await act(async () => {
      tree.root.findByProps({ testID: 'health-scan-review-save' }).props.onPress();
    });

    expect(textOf(tree)).toContain('Check your connection and try again');
    expect(tree.root.findByProps({ testID: 'health-scan-meal-draft' })).toBeTruthy();
  });
});
