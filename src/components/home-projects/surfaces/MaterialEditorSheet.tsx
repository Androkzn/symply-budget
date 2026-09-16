/**
 * Create or edit one material.
 *
 * ## The form is organised around the two numbers that matter
 *
 * A member adding a tile is asked for its **real size in millimetres** and its
 * **joint width** before anything else, because those two numbers are what make
 * the preview to scale and the tile count correct. Every other field —
 * pattern, waste, price, vendor — refines an answer that is already usable;
 * without the size there is no answer at all, only a coloured rectangle.
 *
 * So the size row is not buried under "advanced", it carries a live preview
 * strip beside it, and `quantityGap` puts a plain-English prompt under the
 * quantity whenever the numbers are not enough to produce one. A field that is
 * load-bearing and optional-looking is how a feature quietly stops working.
 *
 * ## Photos
 *
 * The swatch is an ordinary project attachment. That is what makes it work on
 * both backends with no new mechanism: sealed into the H6 blob channel on a
 * local-first household, an R2 object otherwise, and `uploadSelectionPhoto`
 * already normalises the picker's HEIC into something `<Image>` can render at a
 * sane size. The material stores the attachment id and nothing else.
 *
 * ## The colour picker is not the only way in
 *
 * It used to be. A member who had already imported a tile — colour, size, grout
 * and photo captured by the link importer — still had to read the hex off the
 * material card and type it in here, because nothing connected a shopping
 * selection to a finish. "Use a material from this project" is that connection
 * (`materialFromSelection` in `@symply/contracts`), and it sits above the form
 * rather than replacing any of it: the manual path is untouched and is still
 * the only path for a member with nothing imported, and still the answer when
 * an import states no colour.
 */

import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScanImportSources } from '@components/common/ScanImportSources';
import { SheetHeader } from '@components/common/SheetHeader';
import {
  MATERIAL_KIND_DEFAULTS,
  TILE_PATTERN_LABELS,
  createMaterial,
  describeMaterialUnit,
  quantityGap,
} from '@features/house/surfaces';
import { useKeyboardInset } from '@hooks/useKeyboardInset';
import type { Material, MaterialKind, TilePattern } from '@symply/contracts';
import { useAppColors } from '@theme';
import { numericTextHandler } from '@utils/keyboard';

import { SwatchPreview } from './SwatchPreview';

const KIND_ORDER: MaterialKind[] = [
  'paint',
  'tile',
  'flooring',
  'panel',
  'wallpaper',
  'stone',
  'other',
];

const PATTERN_ORDER: TilePattern[] = [
  'grid',
  'brick',
  'brick_third',
  'herringbone',
  'vertical_stack',
];

/**
 * A neutral, legible palette — warm and cool neutrals, then a small set of
 * saturated accents.
 *
 * A full colour wheel is the wrong tool on a phone for a decision a member
 * makes against a physical sample anyway, and a hex field is here for anyone
 * who has the exact value off a paint chip.
 */
const SWATCHES = [
  '#ffffff',
  '#f7f5f1',
  '#efeae1',
  '#e3ddd2',
  '#d3ccc0',
  '#b8b0a3',
  '#f4f6f7',
  '#e4e9ec',
  '#cdd6dc',
  '#a8b5bd',
  '#7c8b95',
  '#4d5a63',
  '#2c3338',
  '#1c2226',
  '#e8d5c0',
  '#c99f6d',
  '#b98a55',
  '#8a6238',
  '#dfe9e2',
  '#a9c6b4',
  '#6f9a80',
  '#3f6b52',
  '#c7dced',
  '#5d8cb8',
  '#f0d9d9',
  '#c98d8d',
  '#9b5a5a',
  '#e9dcef',
  '#a98cbb',
  '#6f5686',
];

/**
 * One imported material, offered as a finish.
 *
 * The conversion happens in the screen (`materialFromSelection`) rather than
 * here, so this sheet stays presentational and the two failure shapes arrive
 * already decided: `material` is the finish to apply, or it is null and
 * `blockedReason` says — in the member's words — what the import is missing.
 * A selection with no colour is the case that matters, and it is shown rather
 * than hidden: dropping it silently would leave the member wondering why the
 * tile they just imported is not in the list.
 */
export interface ProjectFinishOption {
  /** `home_project_selections.id`. Also the option's testID suffix. */
  selectionId: string;
  name: string;
  /** "Tile Depot · 600 × 600 mm", or why it cannot be applied yet. */
  caption: string;
  /** The finish this becomes, or null when the import states no colour. */
  material: Material | null;
  /** Resolved swatch photo, when the household has the bytes. */
  textureUri?: string;
  /** Present exactly when `material` is null. */
  blockedReason?: string;
}

export interface MaterialEditorSheetProps {
  visible: boolean;
  /** What is being finished — "S wall · Wainscot · 18 sq ft". */
  subtitle?: string;
  /** Absent for a create. */
  material?: Material | null;
  /** Preselected kind when creating. */
  initialKind?: MaterialKind;

  /**
   * The project's whole palette, offered at the top of this sheet.
   *
   * Reusing a finish you already added is the commonest thing to do and used
   * to live behind a separate picker sheet — one more modal, one more hop, and
   * the source of the stacked-modal freeze. It belongs here: choosing and
   * adjusting are the same decision.
   */
  materials?: Material[];
  textureUris?: Record<string, string | undefined>;
  /** What this area currently uses. `null` is "no finish yet". */
  selectedMaterialId?: string | null;
  /** Assign an existing material — or `null` — to the area. */
  onSelectMaterial?: (materialId: string | null) => void;
  /** Start a brand-new material of this kind, without leaving the sheet. */
  onStartNew?: (kind: MaterialKind) => void;
  /** Kinds offered on the "new" row — a wall does not need flooring. */
  suggestedKinds?: MaterialKind[];

  /**
   * Materials the member has already imported into this project.
   *
   * Additive in every direction: absent, empty, or with no handler, the sheet
   * renders exactly as it did before, which is what keeps the manual path
   * working for a member who has imported nothing.
   */
  projectMaterials?: ProjectFinishOption[];
  /** Open the list on arrival — set when the member came in via that button. */
  projectMaterialsExpanded?: boolean;
  onUseProjectMaterial?: (option: ProjectFinishOption) => void;

  /**
   * Other surfaces this finish can go on at the same time.
   *
   * One paint usually covers every wall in the room, and choosing it four
   * times — reopening the sheet on each wall — is the same decision typed out
   * repeatedly. The surface the sheet was opened from is always included and
   * cannot be unticked, because that is the one being edited.
   */
  applyTargets?: Array<{
    id: string;
    label: string;
    selected: boolean;
    locked?: boolean;
  }>;
  onToggleApplyTarget?: (surfaceId: string) => void;

  textureUri?: string;
  /**
   * The four sources a material photo may come from, from
   * `useAttachmentSources`. Spread onto the shared `ScanImportSources` row,
   * which the "Add photo" chip discloses — this sheet is a `Modal`, so a photo
   * chooser that was itself a modal would be the double-presentation this
   * screen's own comments already warn about.
   */
  textureSources?: {
    onCamera: () => void;
    onGallery: () => void;
    onFile: () => void;
    onDrive: () => void;
  };
  onClearTexture?: () => void;
  onSave: (material: Material) => void;
  onDelete?: (materialId: string) => void;
  onClose: () => void;
  /** How many regions currently use this material — shown before a delete. */
  usageCount?: number;
  currency?: string;
}

export function MaterialEditorSheet({
  visible,
  subtitle,
  material,
  initialKind = 'paint',
  materials = [],
  textureUris,
  selectedMaterialId = null,
  onSelectMaterial,
  onStartNew,
  suggestedKinds = ['paint', 'tile', 'panel', 'wallpaper'],
  projectMaterials = [],
  projectMaterialsExpanded = false,
  onUseProjectMaterial,
  applyTargets = [],
  onToggleApplyTarget,
  textureUri,
  textureSources,
  onClearTexture,
  onSave,
  onDelete,
  onClose,
  usageCount = 0,
  currency = 'USD',
}: MaterialEditorSheetProps) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  // A long form in a sheet pinned to the bottom edge: the price and size fields
  // sit lowest, so the keypad opened directly on top of them. Lift the sheet by
  // the inset and cap its height against what is left above the keyboard.
  const keyboardInset = useKeyboardInset();
  const sheetMaxHeight = Math.min(
    windowHeight * 0.92,
    windowHeight - keyboardInset - insets.top - 24,
  );
  const [draft, setDraft] = useState<Material>(
    () => material ?? createMaterial({ name: '', kind: initialKind }),
  );
  // Remount on open rather than syncing in an effect: the sheet is short-lived
  // and an effect that copies props into state is the classic way to lose a
  // member's half-typed edit when an unrelated re-render fires.
  const [instanceKey, setInstanceKey] = useState(0);
  /** Whether the Camera · Gallery · File · Drive row under "Add photo" is open. */
  const [textureSourcesOpen, setTextureSourcesOpen] = useState(false);
  const openedFor = useMemo(
    () => material?.id ?? `new-${initialKind}`,
    [material, initialKind],
  );
  const [lastOpenedFor, setLastOpenedFor] = useState(openedFor);
  if (visible && openedFor !== lastOpenedFor) {
    setLastOpenedFor(openedFor);
    setDraft(material ?? createMaterial({ name: '', kind: initialKind }));
    setInstanceKey(key => key + 1);
  }

  /**
   * Whether the imported-materials list is open.
   *
   * Synced from the prop in the render phase rather than in an effect, the same
   * way `lastOpenedFor` above is: the member arriving from the "From project"
   * button must land with the list already open, and an effect would show them
   * a collapsed row for one frame first.
   */
  const [projectListOpen, setProjectListOpen] = useState(
    projectMaterialsExpanded,
  );
  const [lastExpandedProp, setLastExpandedProp] = useState(
    projectMaterialsExpanded,
  );
  if (projectMaterialsExpanded !== lastExpandedProp) {
    setLastExpandedProp(projectMaterialsExpanded);
    setProjectListOpen(projectMaterialsExpanded);
  }

  const patch = (next: Partial<Material>) =>
    setDraft(current => ({ ...current, ...next }));

  const changeKind = (kind: MaterialKind) => {
    // Kind defaults are applied only to fields the member has not set, so
    // switching Paint → Tile fills in a tile size without wiping a name, a
    // colour they picked or a price they typed.
    const defaults = MATERIAL_KIND_DEFAULTS[kind];
    setDraft(current => ({
      ...current,
      kind,
      unit_w_mm: current.unit_w_mm ?? defaults.unit_w_mm,
      unit_h_mm: current.unit_h_mm ?? defaults.unit_h_mm,
      groutMm: current.groutMm ?? defaults.groutMm,
      groutColorHex: current.groutColorHex ?? defaults.groutColorHex,
      pattern: current.pattern ?? defaults.pattern,
      wastePct: current.wastePct ?? defaults.wastePct,
      coverageM2PerUnit:
        current.coverageM2PerUnit ?? defaults.coverageM2PerUnit,
      coats: current.coats ?? defaults.coats,
      unitLabel: current.unitLabel ?? defaults.unitLabel,
    }));
  };

  const gap = quantityGap(draft);
  const unitSummary = describeMaterialUnit(draft);
  const canSave = draft.name.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { paddingBottom: keyboardInset }]}>
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.backgroundMain,
              maxHeight: sheetMaxHeight,
            },
          ]}
        >
          {/* The app-wide sheet header: ✕ left, title centred, the commit on
              the right. Edits here apply live, so Done only closes — but it
              stays on the right where every other sheet puts its commit. */}
          <SheetHeader
            title={material ? 'Edit finish' : 'New finish'}
            leftVariant="close"
            onLeftPress={onClose}
            leftTestID="material-sheet-close"
            rightLabel="Done"
            onRightPress={onClose}
            rightTestID="material-sheet-done"
            style={styles.headerRow}
          />
          {subtitle ? (
            <Text
              style={[styles.subtitle, { color: colors.textSecondary }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}

          {/* No `automaticallyAdjustKeyboardInsets` here, and that is deliberate: the
              sheet is ALREADY lifted clear of the keypad by `keyboardInset` on the
              backdrop above. Letting the scroller offset by the keyboard height as
              well counts it twice and drives the focused field's own label off the
              top of the card. Verified on a device via ProjectionTargetModal. */}
          <ScrollView
            keyboardShouldPersistTaps="handled"
            key={instanceKey}
            contentContainerStyle={styles.body}
          >
            {/*
              What the member already shopped for, first.

              Ahead of the room's own palette because it is the one list they
              did not have to build here, and ahead of the form because typing
              a hex off a card that is already in the project is the friction
              this whole section removes. Collapsed by default so it never
              pushes the palette below the fold for someone who is not using it.
            */}
            {onUseProjectMaterial && projectMaterials.length > 0 ? (
              <View style={styles.paletteBlock}>
                <Pressable
                  onPress={() => setProjectListOpen(open => !open)}
                  style={styles.disclosure}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: projectListOpen }}
                  accessibilityLabel="Use a material from this project"
                  testID="material-editor-from-project"
                >
                  <Text
                    style={[styles.fieldLabel, { color: colors.textPrimary }]}
                  >
                    Use a material from this project
                  </Text>
                  <Text style={{ color: colors.primary, fontWeight: '600' }}>
                    {projectListOpen ? 'Hide' : `${projectMaterials.length}`}
                  </Text>
                </Pressable>
                {projectListOpen ? (
                  <>
                    <Text
                      style={[
                        styles.fieldHint,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Its colour, size and grout come across, so the preview is
                      to scale without you typing them again.
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.paletteRow}
                      keyboardShouldPersistTaps="handled"
                    >
                      {projectMaterials.map(option => (
                        <PaletteChip
                          key={option.selectionId}
                          label={option.name}
                          caption={option.caption}
                          selected={false}
                          onPress={() => onUseProjectMaterial(option)}
                          testID={`surface-material-option-${option.selectionId}`}
                          swatch={
                            // No swatch for an import with no colour: the dashed
                            // placeholder `PaletteChip` falls back to is the
                            // honest picture of "we do not know what this looks
                            // like", where a grey square would read as a choice.
                            option.material ? (
                              <SwatchPreview
                                material={option.material}
                                textureUri={option.textureUri}
                                width={PALETTE_SWATCH_WIDTH}
                                height={52}
                                showScaleNote={false}
                              />
                            ) : undefined
                          }
                        />
                      ))}
                    </ScrollView>
                  </>
                ) : null}
              </View>
            ) : null}

            {/*
              The palette first, because reusing a finish you already chose is
              the commonest thing to do here and the form below is only worth
              scrolling to once you know none of these is the answer.
            */}
            {onSelectMaterial ? (
              <View style={styles.paletteBlock}>
                <Text
                  style={[styles.fieldLabel, { color: colors.textPrimary }]}
                >
                  Use one you already have
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.paletteRow}
                  keyboardShouldPersistTaps="handled"
                >
                  <PaletteChip
                    label="No finish"
                    caption="Still to decide"
                    selected={selectedMaterialId === null}
                    onPress={() => onSelectMaterial(null)}
                    testID="finish-option-none"
                  />
                  {materials.map(entry => (
                    <PaletteChip
                      key={entry.id}
                      label={entry.name}
                      caption={MATERIAL_KIND_DEFAULTS[entry.kind].label}
                      selected={entry.id === selectedMaterialId}
                      onPress={() => onSelectMaterial(entry.id)}
                      testID={`finish-option-${entry.id}`}
                      swatch={
                        <SwatchPreview
                          material={entry}
                          textureUri={
                            entry.textureAttachmentId
                              ? textureUris?.[entry.textureAttachmentId]
                              : undefined
                          }
                          width={PALETTE_SWATCH_WIDTH}
                          height={52}
                          showScaleNote={false}
                        />
                      }
                    />
                  ))}
                </ScrollView>

                {onStartNew ? (
                  <View style={styles.chipRow}>
                    {suggestedKinds.map(kind => (
                      <Chip
                        key={kind}
                        label={`+ ${MATERIAL_KIND_DEFAULTS[kind].label}`}
                        onPress={() => onStartNew(kind)}
                        testID={`finish-new-${kind}`}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/*
              Where it lands. One paint normally covers every wall, and the
              alternative is opening this sheet once per wall and making the
              same choice four times.
            */}
            {onToggleApplyTarget && applyTargets.length > 1 ? (
              <View style={styles.paletteBlock}>
                <Text
                  style={[styles.fieldLabel, { color: colors.textPrimary }]}
                >
                  Apply to
                </Text>
                <View style={styles.chipRow}>
                  {applyTargets.map(target => (
                    <Chip
                      key={target.id}
                      label={target.label}
                      selected={target.selected}
                      onPress={() =>
                        !target.locked && onToggleApplyTarget(target.id)
                      }
                      testID={`apply-to-${target.id}`}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View
              style={[styles.divider, { backgroundColor: colors.borderColor }]}
            />

            <SwatchPreview
              material={draft}
              textureUri={textureUri}
              width={0}
              height={120}
              caption={unitSummary ?? 'Flat colour'}
            />

            <Field label="Name">
              <TextInput
                value={draft.name}
                onChangeText={name => patch({ name })}
                placeholder="e.g. Calacatta 600×600"
                placeholderTextColor={colors.textSecondary}
                style={[input(colors), { color: colors.textPrimary }]}
                testID="material-name"
              />
            </Field>

            <Field label="Type">
              <View style={styles.chipRow}>
                {KIND_ORDER.map(kind => (
                  <Chip
                    key={kind}
                    label={MATERIAL_KIND_DEFAULTS[kind].label}
                    selected={draft.kind === kind}
                    onPress={() => changeKind(kind)}
                    testID={`material-kind-${kind}`}
                  />
                ))}
              </View>
            </Field>

            <Field
              label="Colour"
              hint="Drawn wherever the photo has not loaded."
            >
              <View style={styles.swatchGrid}>
                {SWATCHES.map(hex => (
                  <Pressable
                    key={hex}
                    onPress={() => patch({ colorHex: hex })}
                    style={[
                      styles.swatch,
                      {
                        backgroundColor: hex,
                        borderColor:
                          draft.colorHex.toLowerCase() === hex
                            ? colors.primary
                            : colors.borderColor,
                        borderWidth:
                          draft.colorHex.toLowerCase() === hex ? 3 : 1,
                      },
                    ]}
                    testID={`material-swatch-${hex}`}
                  />
                ))}
              </View>
              <TextInput
                value={draft.colorHex}
                onChangeText={value => {
                  // Only committed once it is a full, valid hex — otherwise
                  // every keystroke of "#a" would repaint the preview black.
                  const next = value.startsWith('#') ? value : `#${value}`;
                  if (/^#[0-9a-fA-F]{6}$/.test(next))
                    patch({ colorHex: next.toLowerCase() });
                  else
                    setDraft(current => ({
                      ...current,
                      colorHex: current.colorHex,
                    }));
                }}
                placeholder="#rrggbb"
                placeholderTextColor={colors.textSecondary}
                autoCapitalize="none"
                style={[
                  input(colors),
                  { color: colors.textPrimary, marginTop: 8 },
                ]}
                testID="material-hex"
              />
            </Field>

            {textureSources ? (
              <Field
                label="Photo of the material"
                hint="A flat, straight-on shot of one tile or plank works best."
              >
                <View style={styles.chipRow}>
                  <Chip
                    label={textureUri ? 'Replace photo' : 'Add photo'}
                    onPress={() => setTextureSourcesOpen(open => !open)}
                    testID="material-pick-texture"
                  />
                  {textureUri && onClearTexture ? (
                    <Chip
                      label="Remove"
                      onPress={onClearTexture}
                      testID="material-clear-texture"
                    />
                  ) : null}
                </View>
                {textureSourcesOpen ? (
                  <View style={styles.textureSources}>
                    <ScanImportSources
                      testIDPrefix="material-texture"
                      {...textureSources}
                    />
                  </View>
                ) : null}
              </Field>
            ) : null}

            <Field
              label="Real size of one piece"
              hint="Millimetres — this is what makes the preview and the count correct."
            >
              <View style={styles.inlineRow}>
                <NumberInput
                  value={draft.unit_w_mm}
                  onChange={unit_w_mm => patch({ unit_w_mm })}
                  placeholder="width"
                  testID="material-unit-w"
                />
                <Text style={{ color: colors.textSecondary }}>×</Text>
                <NumberInput
                  value={draft.unit_h_mm}
                  onChange={unit_h_mm => patch({ unit_h_mm })}
                  placeholder="height"
                  testID="material-unit-h"
                />
                <Text style={{ color: colors.textSecondary }}>mm</Text>
              </View>
            </Field>

            <Field label="Joint / grout (mm)">
              <NumberInput
                value={draft.groutMm}
                onChange={groutMm => patch({ groutMm })}
                placeholder="3"
                testID="material-grout"
              />
            </Field>

            <Field label="Layout">
              <View style={styles.chipRow}>
                {PATTERN_ORDER.map(pattern => (
                  <Chip
                    key={pattern}
                    label={TILE_PATTERN_LABELS[pattern]}
                    selected={(draft.pattern ?? 'grid') === pattern}
                    onPress={() => patch({ pattern })}
                    testID={`material-pattern-${pattern}`}
                  />
                ))}
              </View>
            </Field>

            <Field
              label="Waste allowance (%)"
              hint="Cuts and breakage. 10% is the usual rule."
            >
              <NumberInput
                value={draft.wastePct}
                onChange={wastePct => patch({ wastePct })}
                placeholder="10"
                testID="material-waste"
              />
            </Field>

            {draft.kind === 'paint' ? (
              <>
                <Field label="Coverage (m² per litre)">
                  <NumberInput
                    value={draft.coverageM2PerUnit}
                    onChange={coverageM2PerUnit => patch({ coverageM2PerUnit })}
                    placeholder="11"
                    testID="material-coverage"
                  />
                </Field>
                <Field label="Coats">
                  <NumberInput
                    value={draft.coats}
                    onChange={coats =>
                      patch({ coats: coats ? Math.round(coats) : undefined })
                    }
                    placeholder="2"
                    testID="material-coats"
                  />
                </Field>
              </>
            ) : null}

            <Field
              label={`Price per ${draft.unitLabel ?? 'unit'} (${currency})`}
              hint="Leave empty and the estimate simply says “no price yet”."
            >
              <NumberInput
                value={
                  draft.unitPriceCents === undefined
                    ? undefined
                    : draft.unitPriceCents / 100
                }
                onChange={value =>
                  patch({
                    unitPriceCents:
                      value === undefined ? undefined : Math.round(value * 100),
                  })
                }
                placeholder="0.00"
                testID="material-price"
              />
            </Field>

            {gap ? (
              <Text
                style={[styles.gap, { color: colors.warning }]}
                testID="material-gap"
              >
                {gap}
              </Text>
            ) : null}

            <Pressable
              style={[
                styles.primaryBtn,
                {
                  backgroundColor: canSave
                    ? colors.primary
                    : colors.borderColor,
                },
              ]}
              disabled={!canSave}
              onPress={() => onSave({ ...draft, name: draft.name.trim() })}
              testID="material-save"
            >
              <Text style={styles.primaryBtnText}>
                {material ? 'Save material' : 'Add material'}
              </Text>
            </Pressable>

            {material && onDelete ? (
              <Pressable
                style={[styles.dangerBtn, { borderColor: colors.error }]}
                onPress={() => onDelete(material.id)}
                testID="material-delete"
              >
                <Text style={{ color: colors.error, fontWeight: '600' }}>
                  {usageCount > 0
                    ? `Delete — clears it from ${usageCount} area${
                        usageCount === 1 ? '' : 's'
                      }`
                    : 'Delete material'}
                </Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

/** Width of a palette swatch, and of the chip that holds it. */
const PALETTE_SWATCH_WIDTH = 92;

/**
 * One entry in the "use one you already have" row.
 *
 * A picture first, then the name — a finish is chosen by eye, and at this size
 * the swatch says more than the word does. `SwatchPreview` draws it at true
 * scale, so a 600 mm tile and a 75 mm mosaic are visibly different here.
 */
function PaletteChip({
  label,
  caption,
  selected,
  onPress,
  swatch,
  testID,
}: {
  label: string;
  caption: string;
  selected: boolean;
  onPress: () => void;
  swatch?: React.ReactNode;
  testID: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.paletteChip,
        {
          width: PALETTE_SWATCH_WIDTH + 12,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
          borderColor: selected ? colors.primary : colors.borderColor,
          backgroundColor: colors.card,
        },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${label}, ${caption}`}
      testID={testID}
    >
      {swatch ?? (
        <View
          style={[
            styles.paletteEmptySwatch,
            {
              width: PALETTE_SWATCH_WIDTH,
              height: 52,
              borderColor: colors.borderColor,
            },
          ]}
        />
      )}
      <Text
        style={[styles.paletteChipLabel, { color: colors.textPrimary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text
        style={[styles.paletteChipCaption, { color: colors.textSecondary }]}
        numberOfLines={1}
      >
        {caption}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const colors = useAppColors();
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: colors.textPrimary }]}>
        {label}
      </Text>
      {hint ? (
        <Text style={[styles.fieldHint, { color: colors.textSecondary }]}>
          {hint}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useAppColors();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.card,
          borderColor: selected ? colors.primary : colors.borderColor,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? '#fff' : colors.textPrimary,
          fontWeight: '600',
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * A numeric field that keeps what the member typed.
 *
 * The text is local state and only a *parsable* value is lifted, so clearing
 * the box to retype does not immediately push `NaN` upward and bounce a `0`
 * back into it — the single most irritating bug class in a numeric form, and
 * the reason `parseLength` has the same rule.
 */
function NumberInput({
  value,
  onChange,
  placeholder,
  testID,
}: {
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  placeholder?: string;
  testID?: string;
}) {
  const colors = useAppColors();
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setText(value === undefined ? '' : String(value));
  }
  return (
    <TextInput
      value={text}
      // Raw RN input, so the decimal pad is only a suggestion — a paste or a
      // Bluetooth keyboard still puts letters into a size, a percentage or a
      // price. `numericTextHandler` is the chokepoint the shared
      // `@components/ui` field has built in.
      onChangeText={numericTextHandler(next => {
        setText(next);
        const trimmed = next.trim();
        if (trimmed === '') {
          onChange(undefined);
          return;
        }
        const parsed = Number(trimmed);
        if (Number.isFinite(parsed) && parsed >= 0) onChange(parsed);
      })}
      keyboardType="decimal-pad"
      placeholder={placeholder}
      placeholderTextColor={colors.textSecondary}
      style={[input(colors), styles.numberInput, { color: colors.textPrimary }]}
      testID={testID}
    />
  );
}

function input(colors: ReturnType<typeof useAppColors>) {
  return {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderColor,
    backgroundColor: colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  } as const;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  // No `maxHeight` here: it is computed against the live keyboard inset above,
  // because a percentage measured before the keypad existed does not survive
  // the field being focused.
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerRow: { paddingTop: 8 },
  subtitle: { fontSize: 13, textAlign: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  paletteBlock: { gap: 8 },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  paletteRow: { gap: 10, paddingVertical: 4, paddingHorizontal: 2 },
  paletteChip: { borderRadius: 12, padding: 6, alignItems: 'center' },
  paletteChipLabel: { fontSize: 12, fontWeight: '700', marginTop: 6 },
  paletteChipCaption: { fontSize: 11, marginTop: 1 },
  paletteEmptySwatch: {
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 18 },
  body: { padding: 16, paddingTop: 4, paddingBottom: 40, gap: 4 },
  field: { marginTop: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '700', marginBottom: 2 },
  fieldHint: { fontSize: 12, marginBottom: 8, lineHeight: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  textureSources: { marginTop: 10 },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 38, height: 38, borderRadius: 8 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  numberInput: { flex: 1, minWidth: 72 },
  gap: { marginTop: 14, fontSize: 13, lineHeight: 18 },
  primaryBtn: {
    marginTop: 22,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  dangerBtn: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1,
  },
});
