/**
 * One material, in full.
 *
 * ## Why this screen exists
 *
 * The link importer extracts a dozen things off a product page — the price and
 * what basis it is on, how much one box covers, the size of a piece, the brand,
 * the sku, the retailer, the spec table, the photo — and writes every one of
 * them to the row. The card then showed the name and "No price · link", and the
 * only editor was three inputs squeezed into the list. Everything else was
 * extracted, stored, and unreachable.
 *
 * So: a real screen. Everything the row holds is shown, and everything a member
 * could reasonably want to correct is editable in place.
 *
 * ## The two numbers that decide a renovation
 *
 * `unit_price_cents` and `coverage_per_unit` are the pair that answers "what
 * does this floor cost", and they are the two the extraction is most likely to
 * get subtly wrong — a page showing both "$4.29/sq. ft." and "$45.99/case" has
 * two right answers and one of them is not the one you meant. They sit together
 * under a live line that spells out the arithmetic, because a member who can
 * see "$48.80 per box · covers 8.16 sq ft · $5.98/sq ft" can tell at a glance
 * whether the import read the right row.
 *
 * ## Specs are editable rows, not a blob
 *
 * They come out of the model as `[{label, value}]` and go back the same way.
 * Making them editable is not polish: a wrong wear layer or PEI rating is the
 * kind of thing a member spots and cannot otherwise fix without deleting the
 * material and losing the photo with it.
 */
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  describeMaterialCard,
  homeProjectsApi,
  parseSpecs,
  useHomeProjectHub,
  useHomeProjectMutation,
  type AreaUnit,
  type MaterialSpec,
} from '@api/home-projects';
import { CloudFilePicker } from '@components/cloud-storage';
import { ScanImportSources, ScreenHeader } from '@components/common';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { Icon } from '@components/ui/Icon';
import {
  CHAT_SUBJECT_MATERIAL,
  houseChatConfig,
  SubjectChatButton,
  type SubjectChatTarget,
} from '@features/chat';
import { toMemberFacingError } from '@features/house/local/memberFacingError';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import { useUnsavedChanges } from '@hooks/useUnsavedChanges';
import type { HomeProjectsStackParamList } from '@navigation/types';
import ImageCropPicker from '@services/image-picker-compat';
import { useHouseholdStore } from '@stores/householdStore';
import { normalizeHomeProjectVisibility } from '@symply/contracts';
import { useAppColors } from '@theme';
import {
  isNumericKeyboardType,
  keyboardDismissScrollProps,
  numericTextHandler,
} from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';
import {
  isPickerPermissionError,
  presentPickerPermissionDeniedAlert,
} from '@utils/pickerPermissionAlert';

import { buildMaterialChatContext } from './projectChatContext';

type Props = NativeStackScreenProps<
  HomeProjectsStackParamList,
  'MaterialDetail'
>;

/**
 * Reference thumbnail size.
 *
 * Landscape and large enough to read a ROOM, not a swatch: a reference is a
 * whole scheme, and at swatch size every one of them is an indistinct smudge of
 * the same colour — which is the one thing the member already knows.
 */
const REF_W = 168;
const REF_H = 120;

/**
 * How many references one trip through a picker may add.
 *
 * Same ceiling the gallery already enforced through `selectionLimit`, now also
 * applied to the Files and Drive batches so no source can quietly exceed what
 * the gallery refuses.
 */
const MAX_REFERENCES_PER_PICK = 10;

/**
 * What the FILE browsers (Files, Drive) are allowed to return.
 *
 * The image pickers need no filter — they only offer photos. These two browse
 * everything, so without the list a member could pick a PDF and get a failure
 * at upload time instead of a greyed-out row. HEIC is included on purpose:
 * `uploadSelectionPhoto` re-encodes every URI to JPEG before it sends anything,
 * so an iPhone original is welcome from any of the four sources.
 */
const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** How the price was quoted. Free text on the row; these are what we write. */
const UNIT_OPTIONS = [
  'each',
  'box',
  'case',
  'pallet',
  'sq ft',
  'm²',
  'linear ft',
] as const;

const COVERAGE_UNITS: AreaUnit[] = ['sqft', 'm2'];

/** Where the row came from, in words a member can read. */
const SOURCE_LABEL: Record<string, string> = {
  manual: 'Added by hand',
  link_url: 'Read from the link',
  link_og: 'Read from the page',
  link_ai: 'Read from the page by AI',
};

/**
 * The floating tab bar draws OVER this screen's scroll view, so the content has
 * to end above it. `styles.content` reserved 60px, which is less than the bar
 * itself, and the last field on the screen — Notes — sat underneath it: visible
 * to a hierarchy dump, unreachable to a finger. Taps meant for Notes landed on
 * the tab bar, so the form never went dirty and the Save action (rendered only
 * when `isDirty`) never appeared. Same allowance as the Kaizen screens and the
 * two project wizards.
 */
const TAB_BAR_CONTENT_HEIGHT = 64;

export function MaterialDetailScreen() {
  const insets = useSafeAreaInsets();
  const colors = useAppColors();
  /**
   * iPad's floating leading rail draws over x=0 — reserve its width. Carried on
   * one object because all three of this screen's roots (loading, missing,
   * loaded) tint the same way and must inset the same way.
   */
  const { sidebarInset } = useLayoutPadding();
  const screenStyle = {
    backgroundColor: colors.backgroundSecondary,
    paddingLeft: sidebarInset,
  };
  useDisplayCurrency();
  const navigation =
    useNavigation<
      NativeStackScreenProps<HomeProjectsStackParamList>['navigation']
    >();
  const { params } = useRoute<Props['route']>();
  const { projectId, selectionId } = params;
  const householdId = useHouseholdStore(s => s.currentHousehold?.id);

  const { data, isLoading } = useHomeProjectHub(householdId, projectId);
  const { invalidate } = useHomeProjectMutation(householdId, projectId);

  const selection = data?.selections.find(s => s.id === selectionId) ?? null;
  /**
   * The material's OWN picture — the product shot.
   *
   * Filtered on `kind` now that a material can carry more than one photo. It
   * used to take the first ready attachment on the row whatever its label, so
   * the first reference a member added would silently become the hero: a room
   * they liked, presented as a picture of the tile.
   */
  const attachment = data?.attachments.find(
    a =>
      a.selection_id === selectionId &&
      a.status === 'ready' &&
      (a.kind === 'photo' || a.kind === 'product_photo') &&
      (a.url || a.blob),
  );
  /**
   * The references — rooms, schemes and swatch-in-situ shots the member
   * collected for THIS material. Oldest first, which is the order they added
   * them in and the only order that stays stable as more arrive.
   */
  const references = useMemo(
    () =>
      (data?.attachments ?? []).filter(
        a =>
          a.selection_id === selectionId &&
          a.kind === 'reference' &&
          a.status === 'ready' &&
          (a.url || a.blob),
      ),
    [data?.attachments, selectionId],
  );

  /**
   * The form, seeded once from the row.
   *
   * Lazy initialisers rather than an effect: seeding in `useEffect` renders one
   * frame of empty inputs first, and on a screen the member opened *to read*
   * that frame looks like the extraction found nothing.
   */
  const [name, setName] = useState(() => selection?.name ?? '');
  const [brand, setBrand] = useState(() => selection?.brand ?? '');
  const [vendor, setVendor] = useState(() => selection?.vendor ?? '');
  const [sku, setSku] = useState(() => selection?.sku ?? '');
  const [price, setPrice] = useState(() =>
    selection?.unit_price_cents == null
      ? ''
      : (selection.unit_price_cents / 100).toFixed(2),
  );
  const [unit, setUnit] = useState(() => selection?.unit ?? '');
  const [qty, setQty] = useState(() => String(selection?.qty ?? 1));
  const [coverage, setCoverage] = useState(() =>
    selection?.coverage_per_unit == null
      ? ''
      : String(selection.coverage_per_unit),
  );
  const [coverageUnit, setCoverageUnit] = useState<AreaUnit>(() =>
    selection?.coverage_unit === 'm2' ? 'm2' : 'sqft',
  );
  const [productUrl, setProductUrl] = useState(
    () => selection?.product_url ?? '',
  );
  const [notes, setNotes] = useState(() => selection?.notes ?? '');
  const [specs, setSpecs] = useState<MaterialSpec[]>(() =>
    parseSpecs(selection?.specs_json ?? null),
  );

  /**
   * The form and the row it came from, as two comparable values.
   *
   * `useUnsavedChanges` needs both to answer "is there anything to lose", which
   * is what makes Back safe: this screen is reached by a member who tapped Edit
   * and may have retyped a price before changing their mind.
   */
  const form = useMemo(
    () => ({
      name,
      brand,
      vendor,
      sku,
      price,
      unit,
      qty,
      coverage,
      coverageUnit,
      productUrl,
      notes,
      specs,
    }),
    [
      name,
      brand,
      vendor,
      sku,
      price,
      unit,
      qty,
      coverage,
      coverageUnit,
      productUrl,
      notes,
      specs,
    ],
  );

  const baseline = useMemo(
    () => ({
      name: selection?.name ?? '',
      brand: selection?.brand ?? '',
      vendor: selection?.vendor ?? '',
      sku: selection?.sku ?? '',
      price:
        selection?.unit_price_cents == null
          ? ''
          : (selection.unit_price_cents / 100).toFixed(2),
      unit: selection?.unit ?? '',
      qty: String(selection?.qty ?? 1),
      coverage:
        selection?.coverage_per_unit == null
          ? ''
          : String(selection.coverage_per_unit),
      coverageUnit: (selection?.coverage_unit === 'm2'
        ? 'm2'
        : 'sqft') as AreaUnit,
      productUrl: selection?.product_url ?? '',
      notes: selection?.notes ?? '',
      specs: parseSpecs(selection?.specs_json ?? null),
    }),
    [selection],
  );

  const priceCents = useMemo(() => {
    const dollars = Number(price);
    return price.trim() === '' || !Number.isFinite(dollars) || dollars <= 0
      ? null
      : Math.round(dollars * 100);
  }, [price]);

  const coverageValue = useMemo(() => {
    const value = Number(coverage);
    return coverage.trim() === '' || !Number.isFinite(value) || value <= 0
      ? null
      : value;
  }, [coverage]);

  /**
   * "$48.80 per box · covers 8.16 sq ft · $5.98/sq ft".
   *
   * The last term is the whole point: it is the number two competing materials
   * are actually compared on, and seeing it is how a member catches an import
   * that read "$4.29/sq. ft." as a box price.
   */
  const priceSummary = useMemo(() => {
    if (priceCents == null) return null;
    const per = unit.trim() ? ` per ${unit.trim()}` : '';
    if (coverageValue == null) return `${formatMoney(priceCents)}${per}`;
    const label = coverageUnit === 'm2' ? 'm²' : 'sq ft';
    const perArea = Math.round(priceCents / coverageValue);
    return `${formatMoney(
      priceCents,
    )}${per} · covers ${coverageValue} ${label} · ${formatMoney(
      perArea,
    )}/${label}`;
  }, [priceCents, unit, coverageValue, coverageUnit]);

  const persist = async () => {
    if (!householdId || !name.trim()) return false;
    await homeProjectsApi.updateSelection(householdId, projectId, selectionId, {
      name: name.trim(),
      brand: brand.trim() || null,
      vendor: vendor.trim() || null,
      sku: sku.trim() || null,
      // An emptied field means "no value", which is a real state — a mistyped
      // 6499 must be removable, not replaced with a zero that reads as free.
      unitPriceCents: priceCents,
      unit: unit.trim() || null,
      qty: Math.max(1, Math.round(Number(qty)) || 1),
      coveragePerUnit: coverageValue,
      coverageUnit: coverageValue == null ? null : coverageUnit,
      productUrl: productUrl.trim() || null,
      notes: notes.trim() || null,
      specs: specs.filter(sp => sp.label.trim() && sp.value.trim()),
    });
    invalidate();
    return true;
  };

  const { isDirty, isSaving, save, confirmDiscard } = useUnsavedChanges({
    values: form,
    baseline,
    onSave: persist,
    onClose: () => navigation.goBack(),
    successMessage: 'Material updated',
    errorMessage: 'Could not save this material.',
    // Save stays live for a dirty form with a name; a nameless row is not
    // something the list can render, so it is the one hard requirement.
    saveWhen: (_values, dirty) => dirty && name.trim().length > 0,
  });

  /**
   * The one way out.
   *
   * This screen shipped without it: `ScreenHeader.showBackButton` defaults to
   * false, the stack sets `headerShown: false`, and a member who opened a
   * material had no back button, no native header and no gesture — the screen
   * was a dead end. It is guarded rather than a bare `goBack` because they may
   * have retyped a price on the way in.
   */
  const close = () => confirmDiscard();

  /**
   * This material's own conversation.
   *
   * A material chat is not a smaller project chat. The question here is always
   * about ONE thing — "is 12 boxes enough", "does this grout work with it",
   * "the sale ends Friday, do we commit" — and the answer depends on this row's
   * price, coverage and the area of the surface it is competing for. Those are
   * exactly what `buildMaterialChatContext` hands the assistant, which is why a
   * per-material room is worth having rather than folding everything into one
   * project thread where the model has to guess which of eleven tiles you mean.
   *
   * The parent project rides along so the room can be grouped under it in the
   * chat tab and so the assistant can answer "does this blow the budget".
   */
  const chatTarget = useMemo<SubjectChatTarget | null>(() => {
    if (!selection || !data?.project) return null;
    return {
      type: CHAT_SUBJECT_MATERIAL,
      id: selection.id,
      label: selection.name,
      parentId: data.project.id,
      parentLabel: data.project.title,
      buildContext: () => buildMaterialChatContext(data, selection.id),
      participantIds:
        normalizeHomeProjectVisibility(data.project.visibility) === 'draft' &&
        data.project.created_by
          ? [data.project.created_by]
          : undefined,
    };
  }, [data, selection]);

  const [busy, setBusy] = useState(false);
  /** Whether the Camera · Gallery · File · Drive row is showing. */
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [showDrive, setShowDrive] = useState(false);

  /**
   * Attach references to this material.
   *
   * A reference is not a picture of the product — it is a room the member liked
   * IN this colour, a scheme they are copying, a photo of the sample against
   * their own wall. That is why it is `kind: 'reference'` rather than another
   * `'photo'`: the hub's gallery and the project-cover picker both take
   * `'photo'` only, so a wall of paint references cannot flood the project's
   * before/after strip or end up as the card on the projects list.
   *
   * The upload is the ordinary attachment write, so it seals into the H6 blob
   * channel on a local-first household and lands in R2 otherwise, with no
   * branch here — and it normalises whatever URI it is handed, which is why all
   * four sources can share this one function.
   *
   * A file that fails is SKIPPED and counted, not thrown. The Drive and Files
   * branches hand over batches, and one unreadable download out of six must not
   * cost the member the other five — the same reasoning `SmartProjectPhotoStep`
   * records for its own ingest loop.
   */
  const ingestReferences = async (uris: readonly string[]) => {
    if (!householdId || uris.length === 0) return;
    const room = uris.slice(0, MAX_REFERENCES_PER_PICK);
    setSourcesOpen(false);
    setBusy(true);
    try {
      let failed = 0;
      let firstError: unknown = null;
      for (const uri of room) {
        try {
          await homeProjectsApi.uploadSelectionPhoto(
            householdId,
            projectId,
            uri,
            selectionId,
            undefined,
            'reference',
          );
        } catch (err) {
          failed += 1;
          if (firstError === null) firstError = err;
        }
      }
      invalidate();
      if (failed > 0) {
        const { message } = toMemberFacingError(
          firstError,
          'Could not add that reference.',
        );
        Alert.alert(
          failed === room.length ? 'Not added' : 'Some references were skipped',
          failed === room.length
            ? message
            : `${failed} of ${room.length} could not be added. ${message}`,
        );
      } else if (uris.length > room.length) {
        Alert.alert(
          'That is the limit',
          `We add up to ${MAX_REFERENCES_PER_PICK} at a time, so the last ${
            uris.length - room.length
          } were not added.`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  /**
   * The four sources, and why references need all of them.
   *
   * Where a member's reference images live is a fact about their phone, not a
   * preference: the sample held against their own wall is in the CAMERA, the
   * showroom shot saved months ago is in the GALLERY, a designer's mood board
   * arrives by email and lands in FILES, and a household that keeps its
   * renovation folder in Google DRIVE has none of them on the device at all.
   * The row is `ScanImportSources` and the Drive browse is `CloudFilePicker` —
   * the same pair `SmartProjectPhotoStep`, the receipt scanner and the savings
   * importer use, because re-forking four buttons per screen is how the fleet
   * ends up with four subtly different pickers.
   */
  const addFromCamera = async () => {
    try {
      const shot = await ImageCropPicker.openCamera({
        cropping: false,
        compressImageQuality: 0.9,
        mediaType: 'photo',
      });
      await ingestReferences([shot.path]);
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('camera');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert(
          'Could not open the camera',
          'Try adding from your gallery instead.',
        );
      }
    }
  };

  const addFromGallery = async () => {
    try {
      const picked = await ImageCropPicker.openPickerMultiple({
        compressImageQuality: 0.9,
        mediaType: 'photo',
        selectionLimit: MAX_REFERENCES_PER_PICK,
      });
      await ingestReferences(picked.map(image => image.path));
    } catch (error) {
      if (isPickerPermissionError(error)) {
        presentPickerPermissionDeniedAlert('library');
      } else if ((error as { code?: string }).code !== 'E_PICKER_CANCELLED') {
        Alert.alert(
          'Could not open your photos',
          'Try the camera or Files instead.',
        );
      }
    }
  };

  const addFromFiles = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: IMAGE_MIME_TYPES,
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (picked.canceled) return;
      await ingestReferences(picked.assets.map(asset => asset.uri));
    } catch {
      Alert.alert(
        'Could not open Files',
        'Try the camera or your gallery instead.',
      );
    }
  };

  const addFromDrive = async (files: ReadonlyArray<{ uri: string }>) => {
    setShowDrive(false);
    await ingestReferences(files.map(file => file.uri));
  };

  /**
   * Delete the material, from the header rather than the row.
   *
   * Confirmed, and the confirmation says what else goes: a material that is a
   * group's chosen option carries the project's money with it, which is the one
   * consequence a member cannot see from this screen.
   */
  const removeMaterial = () => {
    if (!householdId || !selection) return;
    Alert.alert(
      `Delete ${selection.name}?`,
      'It goes out of this project, and out of the estimate if it was the option you had chosen.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await homeProjectsApi.deleteSelection(
                  householdId,
                  projectId,
                  selectionId,
                );
                // Take this material's conversation with it. Best-effort and
                // un-awaited: the material is already gone, and a chat-cleanup
                // blip must not turn a completed delete into an error dialog.
                // (No FK to cascade from — see migration 0167.)
                void houseChatConfig.api
                  .deleteSubjectRooms(
                    householdId,
                    CHAT_SUBJECT_MATERIAL,
                    selectionId,
                  )
                  .catch(cleanupErr =>
                    console.warn(
                      '[HomeProjects] material chat cleanup failed',
                      cleanupErr,
                    ),
                  );
                invalidate();
                navigation.goBack();
              } catch (err) {
                const { message } = toMemberFacingError(
                  err,
                  'Could not delete this material.',
                );
                Alert.alert('Not deleted', message);
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  if (isLoading || !data) {
    return (
      <View style={[styles.screen, screenStyle]}>
        <ScreenHeader
          title="Material"
          showBackButton
          onBackPress={() => navigation.goBack()}
        />
        <Text style={[styles.muted, { color: colors.textSecondary }]}>
          Loading…
        </Text>
      </View>
    );
  }

  if (!selection) {
    return (
      <View style={[styles.screen, screenStyle]}>
        <ScreenHeader
          title="Material"
          showBackButton
          onBackPress={() => navigation.goBack()}
        />
        <Text
          style={[styles.muted, { color: colors.textSecondary }]}
          testID="material-detail-missing"
        >
          This material is no longer in the project.
        </Text>
      </View>
    );
  }

  const field = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    extra?: {
      placeholder?: string;
      keyboardType?: 'decimal-pad' | 'number-pad' | 'url';
      testID?: string;
      multiline?: boolean;
    },
  ) => {
    // A shop link is neither sentence-cased nor autocorrected — "https" becomes
    // "Https" and a slug becomes a dictionary word. Keyed off the keyboard type
    // rather than the label text, so a second URL field cannot miss it.
    const isUrl = extra?.keyboardType === 'url';
    return (
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {label}
        </Text>
        <TextInput
          value={value}
          // Raw RN input, so a numeric keypad is only a suggestion — a paste or
          // a Bluetooth keyboard still puts letters into the price, the
          // coverage or the quantity this screen costs the project from.
          onChangeText={
            isNumericKeyboardType(extra?.keyboardType)
              ? numericTextHandler(onChange)
              : onChange
          }
          placeholder={extra?.placeholder}
          placeholderTextColor={colors.textSecondary}
          keyboardType={extra?.keyboardType}
          multiline={extra?.multiline}
          autoCapitalize={isUrl ? 'none' : 'sentences'}
          autoCorrect={!isUrl}
          style={[
            styles.input,
            extra?.multiline ? styles.inputTall : null,
            { color: colors.textPrimary, borderColor: colors.borderColor },
          ]}
          testID={extra?.testID}
        />
      </View>
    );
  };

  /**
   * What may honestly be drawn about this material's offer, picture and shop.
   *
   * The same function the hub's card calls, deliberately: a member who taps a
   * "−59%" badge in the list must not land on a screen that never mentions a
   * sale. Two implementations of "is this on sale" are two answers to a
   * question they are about to spend money on, and they would have no way to
   * tell which one was lying.
   *
   * `Date.now()` on every render rather than a frozen value, so a sale that
   * expires while this screen is open stops being drawn as one.
   */
  const card = describeMaterialCard(selection, Date.now(), {
    hasBlob: !!attachment?.blob,
    url: attachment?.url,
  });
  const { sale, visual } = card;
  // A local const, not `card.link`, so the scheme check survives into the
  // `onPress` closure rather than being re-widened to `| null` there.
  const shopLink = card.link;
  // Two decimals for anything the member will read off a shelf: "$6" is not a
  // number they can check against "$5.98".
  const money = (cents: number) => formatMoney(cents, { decimals: 2 });

  return (
    <View style={[styles.screen, screenStyle]}>
      {/*
        The screen IS the editor — there is no read-only mode to switch out of,
        because a member taps a material to change something and the extra tap
        bought nothing. So the header carries the two actions that used to sit
        on the row and at the bottom of the form:

         - **Save appears only when there is something to save.** A permanently
           visible button that spends most of its life disabled reads as broken,
           and its absence is the clearest possible statement that the form is
           already stored.
         - **Delete is always there**, as an icon, because it is not part of the
           edit and must not be hunted for at the end of a long form.
      */}
      <ScreenHeader
        title={selection.name}
        showBackButton
        onBackPress={close}
        backButtonTestID="material-detail-back"
        rightElement={
          <View style={styles.headerActions}>
            {/*
              Ahead of Save and Delete because it is the only non-destructive,
              always-available action of the three, and because a member who
              opened this material to ask about it should not have to read past
              a delete icon to find the way to ask.
            */}
            <SubjectChatButton
              config={houseChatConfig}
              target={chatTarget}
              testID="material-detail-chat"
              accessibilityLabel={`Chat about ${selection.name}`}
              onOpened={room =>
                navigation.navigate('ChatRoom', {
                  roomId: room.id,
                  roomName: room.name,
                  aiEnabled: room.ai_enabled,
                })
              }
            />
            {isDirty && name.trim() ? (
              <Pressable
                onPress={() => void save()}
                disabled={isSaving}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={`Save ${selection.name}`}
                style={{ opacity: isSaving ? 0.5 : 1 }}
                testID="material-detail-save"
              >
                <Text style={[styles.headerSave, { color: colors.primary }]}>
                  {isSaving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={removeMaterial}
              disabled={busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Delete ${selection.name}`}
              testID="material-detail-delete"
            >
              <Icon name="trash-outline" size={22} color={colors.error} />
            </Pressable>
          </View>
        }
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        style={styles.body}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 60 + TAB_BAR_CONTENT_HEIGHT + insets.bottom },
        ]}
        testID="material-detail-screen"
      >
        {/*
          References first, above the product shot.

          The order is the decision the member is making. A paint colour is
          chosen by looking at rooms that already use it, not by looking at the
          tin — so on a material that HAS references they are the reason the
          screen was opened, and they lead. With none collected the block is a
          single quiet row that invites the first one rather than a gap.
        */}
        <View style={styles.refBlock} testID="material-detail-references">
          <View style={styles.refHeader}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>
              References
            </Text>
            <Pressable
              onPress={() => setSourcesOpen(open => !open)}
              disabled={busy}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={
                sourcesOpen ? 'Hide the photo sources' : 'Add reference photos'
              }
              style={{ opacity: busy ? 0.5 : 1 }}
              testID="material-detail-reference-add"
            >
              <Text style={[styles.headerSave, { color: colors.primary }]}>
                {busy ? 'Adding…' : sourcesOpen ? 'Close' : 'Add photos'}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.muted, { color: colors.textSecondary }]}>
            Rooms and schemes you like in this material. They stay on this
            material and never enter the project’s photo gallery.
          </Text>
          {/*
            Disclosed rather than permanent: this is a long form, and four
            72pt tiles pinned above the product shot would push the fields a
            member came here to edit off the first screen. The import screens
            that show the row permanently are screens whose whole job is the
            import — this block's job is the references it already holds.
          */}
          {sourcesOpen ? (
            <View style={styles.refSources}>
              <ScanImportSources
                testIDPrefix="material-reference"
                disabled={busy}
                onCamera={() => void addFromCamera()}
                onGallery={() => void addFromGallery()}
                onFile={() => void addFromFiles()}
                onDrive={() => setShowDrive(true)}
              />
            </View>
          ) : null}
          {references.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.refRow}
            >
              {references.map(ref => (
                <View key={ref.id} testID={`material-reference-${ref.id}`}>
                  {ref.blob && householdId ? (
                    <HouseBlobImage
                      descriptor={ref.blob}
                      householdId={householdId}
                      width={REF_W}
                      height={REF_H}
                      accessibilityLabel={
                        ref.filename || `Reference for ${selection.name}`
                      }
                    />
                  ) : ref.url ? (
                    <Image
                      source={{ uri: ref.url }}
                      style={[styles.refThumb, { backgroundColor: colors.card }]}
                      resizeMode="cover"
                      accessibilityLabel={
                        ref.filename || `Reference for ${selection.name}`
                      }
                    />
                  ) : null}
                </View>
              ))}
            </ScrollView>
          ) : null}
        </View>

        {/*
          The photo, at a size worth having — and a COLOUR when there is no
          photo worth having.

          A server-backed household's attachment carries a url; a private-mode
          one carries a sealed blob only `HouseBlobImage` can open; a link import
          leaves the vendor's own `image_url`. All three are the same picture to
          a member, so all three render here.

          The fourth branch is paint. A paint material IS a colour, shops rarely
          publish a photo of one worth showing, and "No photo yet" over a
          material whose `color_hex` we hold says nothing when the one fact that
          matters is right there in the row. Precedence lives in
          `describeMaterialVisual` so the card and this screen cannot disagree.
        */}
        {visual.kind === 'blob' && attachment?.blob && householdId ? (
          <HouseBlobImage
            descriptor={attachment.blob}
            householdId={householdId}
            width={320}
            height={220}
            accessibilityLabel={attachment.filename || selection.name}
            testID="material-detail-photo-blob"
          />
        ) : visual.kind === 'image' ? (
          <Image
            source={{ uri: visual.uri }}
            style={[styles.hero, { backgroundColor: colors.card }]}
            resizeMode="cover"
            accessibilityLabel={selection.name}
            testID="material-detail-photo"
          />
        ) : visual.kind === 'swatch' ? (
          /* The member's own `color_hex` — data, not a themed colour, and
             validated against `#rrggbb` before it reaches `backgroundColor`. */
          <View
            style={[
              styles.hero,
              styles.heroEmpty,
              {
                backgroundColor: visual.colorHex,
                borderColor: colors.borderColor,
              },
            ]}
            accessible
            accessibilityLabel={`${selection.name}, colour ${visual.colorHex}`}
            testID="material-detail-swatch"
          />
        ) : (
          <View
            style={[
              styles.hero,
              styles.heroEmpty,
              { backgroundColor: colors.card, borderColor: colors.borderColor },
            ]}
          >
            <Text style={[styles.muted, { color: colors.textSecondary }]}>
              No photo yet
            </Text>
          </View>
        )}

        <Text
          style={[styles.provenance, { color: colors.textSecondary }]}
          testID="material-detail-provenance"
        >
          {SOURCE_LABEL[selection.extraction_source] ?? 'Added by hand'}
          {selection.extraction_confidence
            ? ` · ${selection.extraction_confidence} confidence`
            : ''}
        </Text>

        {field('Name', name, setName, { testID: 'material-detail-name' })}
        {field('Brand', brand, setBrand, { placeholder: 'Manufacturer' })}
        {field('Store', vendor, setVendor, {
          placeholder: 'Where you would buy it',
        })}
        {field('Item / SKU', sku, setSku, {
          placeholder: 'As printed on the page',
        })}

        {/* ── the pair that decides the cost ──────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Price and coverage
        </Text>
        <View style={styles.row}>
          <View style={styles.rowItem}>
            {field('Price', price, setPrice, {
              placeholder: '0.00',
              keyboardType: 'decimal-pad',
              testID: 'material-detail-price',
            })}
          </View>
          <View style={styles.rowItem}>
            {field('Per', unit, setUnit, {
              placeholder: 'box',
              testID: 'material-detail-unit',
            })}
          </View>
        </View>
        <View style={styles.chipRow}>
          {UNIT_OPTIONS.map(option => (
            <Pressable
              key={option}
              onPress={() => setUnit(option)}
              style={[
                styles.chip,
                {
                  borderColor: colors.borderColor,
                  backgroundColor:
                    unit.trim() === option ? colors.primary : colors.card,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: unit.trim() === option }}
              testID={`material-detail-unit-${option}`}
            >
              <Text
                style={{
                  color: unit.trim() === option ? '#fff' : colors.textPrimary,
                  fontWeight: '600',
                }}
              >
                {option}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.row}>
          <View style={styles.rowItem}>
            {field('One unit covers', coverage, setCoverage, {
              placeholder: '0',
              keyboardType: 'decimal-pad',
              testID: 'material-detail-coverage',
            })}
          </View>
          <View style={styles.rowItem}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Coverage unit
            </Text>
            <View style={styles.chipRow}>
              {COVERAGE_UNITS.map(option => (
                <Pressable
                  key={option}
                  onPress={() => setCoverageUnit(option)}
                  style={[
                    styles.chip,
                    {
                      borderColor: colors.borderColor,
                      backgroundColor:
                        coverageUnit === option ? colors.primary : colors.card,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: coverageUnit === option }}
                  testID={`material-detail-coverage-${option}`}
                >
                  <Text
                    style={{
                      color:
                        coverageUnit === option ? '#fff' : colors.textPrimary,
                      fontWeight: '600',
                    }}
                  >
                    {option === 'm2' ? 'm²' : 'sq ft'}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {priceSummary ? (
          <Text
            style={[styles.summary, { color: colors.textPrimary }]}
            testID="material-detail-price-summary"
          >
            {priceSummary}
          </Text>
        ) : null}

        {/*
          The offer, read-only, under the price the member can edit.

          Read-only because none of it is theirs to type: the two prices and the
          end date came off the vendor's page or their photo of its shelf tag,
          and the percentage is arithmetic on the pair (see
          `describeMaterialSale`). An editable "was" price would be an invitation
          to write a discount that never existed.

          Nothing renders at all unless the sale is real and current — an
          expired offer drops the strike-through, the badge and the end date
          together, because a stale "20% off" is the one thing here that makes a
          member act and find out at the till.
        */}
        {sale.onSale &&
        sale.priceCents != null &&
        sale.listPriceCents != null ? (
          <View style={styles.saleRow}>
            <Text
              style={[styles.salePrice, { color: colors.textPrimary }]}
              testID="material-detail-sale-price"
            >
              {money(sale.priceCents)}
            </Text>
            {/* A strike-through is styling, and styling is silent. The label is
                what tells a member who cannot see it that this is the OLD
                price and not a second one they also have to pay. */}
            <Text
              style={[styles.saleWas, { color: colors.textSecondary }]}
              accessibilityLabel={`Was ${money(sale.listPriceCents)}`}
              testID="material-detail-list-price"
            >
              {money(sale.listPriceCents)}
            </Text>
            {/* The percentage is IN the text: the pill's tint is decoration,
                and a member who cannot see it still reads the offer. The whole
                claim as one sentence hangs here rather than on the row, because
                marking the row `accessible` would take the badge and both
                prices out of the tree the E2E flows walk. */}
            <Text
              style={[
                styles.saleBadge,
                {
                  color: colors.success,
                  backgroundColor: colors.pillBackground,
                },
              ]}
              accessibilityLabel={sale.accessibilityLabel ?? undefined}
              testID="material-detail-sale-badge"
            >
              {sale.badgeLabel}
              {sale.endsLabel ? ` · ${sale.endsLabel}` : ''}
            </Text>
          </View>
        ) : null}
        {/*
          A percentage the vendor stated that no pair of prices backs up. Said
          as a claim, in words, and never reversed into a "was" price — that
          would print a number the shop never published, struck through, as
          though it were a fact.
        */}
        {sale.claimedDiscountPct != null ? (
          <Text
            style={[styles.provenance, { color: colors.textSecondary }]}
            testID="material-detail-claimed-discount"
          >
            {`The shop claimed ${sale.claimedDiscountPct}% off. No “was” price was published, so there is nothing to compare it with.`}
          </Text>
        ) : null}

        {/* `number-pad`, not `decimal-pad`: the save rounds this to a whole
            number of units, so a decimal point is a key that silently loses
            what the member typed. */}
        {field('Quantity', qty, setQty, { keyboardType: 'number-pad' })}

        {/* ── specs ───────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Specifications
        </Text>
        {specs.length === 0 ? (
          <Text style={[styles.muted, { color: colors.textSecondary }]}>
            Nothing extracted from the page. Add what matters to you.
          </Text>
        ) : null}
        {specs.map((spec, index) => (
          <View key={`${spec.label}-${index}`} style={styles.row}>
            <View style={styles.rowItem}>
              <TextInput
                value={spec.label}
                onChangeText={next =>
                  setSpecs(rows =>
                    rows.map((r, i) =>
                      i === index ? { ...r, label: next } : r,
                    ),
                  )
                }
                placeholder="Label"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                  },
                ]}
                testID={`material-detail-spec-label-${index}`}
              />
            </View>
            <View style={styles.rowItem}>
              <TextInput
                value={spec.value}
                onChangeText={next =>
                  setSpecs(rows =>
                    rows.map((r, i) =>
                      i === index ? { ...r, value: next } : r,
                    ),
                  )
                }
                placeholder="Value"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                  },
                ]}
                testID={`material-detail-spec-value-${index}`}
              />
            </View>
            <Pressable
              onPress={() =>
                setSpecs(rows => rows.filter((_, i) => i !== index))
              }
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${spec.label || 'spec'}`}
              testID={`material-detail-spec-remove-${index}`}
            >
              <Text style={{ color: colors.error, fontWeight: '600' }}>✕</Text>
            </Pressable>
          </View>
        ))}
        <Pressable
          onPress={() => setSpecs(rows => [...rows, { label: '', value: '' }])}
          style={[styles.btnGhost, { borderColor: colors.borderColor }]}
          testID="material-detail-spec-add"
        >
          <Text style={{ color: colors.primary, fontWeight: '600' }}>
            + Add a spec
          </Text>
        </Pressable>

        {/* ── where it came from ──────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
          Where to buy it
        </Text>
        {field('Product link', productUrl, setProductUrl, {
          placeholder: 'https://…',
          keyboardType: 'url',
          testID: 'material-detail-url',
        })}
        {/*
          Named by the shop, not by the word "link".

          `describeMaterialShopLink` is also what decides whether this button
          exists: `Linking.openURL` hands whatever it is given to the OS, so a
          non-`http(s)` value that reached the column through an importer or a
          paste would be ACTED on — under a label carrying a shop's name. An
          unrecognised scheme gets no button rather than a button that does
          something else.
        */}
        {shopLink ? (
          <Pressable
            onPress={() => void Linking.openURL(shopLink.url)}
            style={[styles.btnGhost, { borderColor: colors.borderColor }]}
            accessibilityRole="link"
            accessibilityLabel={shopLink.accessibilityLabel}
            testID="material-detail-open-link"
          >
            <Text style={{ color: colors.primary, fontWeight: '600' }}>
              {card.vendor ? `Open ${card.vendor}` : 'Open the shop page'}
            </Text>
          </Pressable>
        ) : null}

        {field('Notes', notes, setNotes, {
          placeholder: 'Anything you want to remember',
          multiline: true,
          testID: 'material-detail-notes',
        })}

        {/*
          No Save or Close down here any more — both moved into the header.
          A save button at the foot of a long form is one the member has to
          scroll to find after every edit, and `confirmDiscard` already guards
          the back button, so "Close" was a second door onto the same landing.
        */}
      </ScrollView>

      {/*
        Multi-select, and scoped to its own remembered folder: references are
        collected in batches from wherever a household keeps its renovation
        images, which is rarely the folder the project's own photos come from.
      */}
      <CloudFilePicker
        visible={showDrive}
        provider="google-drive"
        mimeTypeFilter={IMAGE_MIME_TYPES}
        rememberScope="material-references"
        multiSelect
        onClose={() => setShowDrive(false)}
        onFileSelected={file => void addFromDrive([file])}
        onFilesSelected={files => void addFromDrive(files)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  content: { padding: 16, paddingBottom: 60, gap: 10 },
  hero: { width: '100%', height: 220, borderRadius: 12 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  headerSave: { fontSize: 15, fontWeight: '700' },
  refBlock: { gap: 6 },
  refHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refSources: { marginTop: 4 },
  refRow: { gap: 10, paddingVertical: 6 },
  refThumb: { width: REF_W, height: REF_H, borderRadius: 10 },
  heroEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  provenance: { fontSize: 12, fontStyle: 'italic' },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginTop: 14 },
  field: { gap: 4 },
  label: { fontSize: 12, fontWeight: '600' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  inputTall: { minHeight: 88, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  rowItem: { flex: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  summary: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  /* The offer. Wraps rather than truncates: the "was" price and the percentage
     are two halves of one claim, and a width that cannot hold both should take
     a second line instead of dropping either. */
  saleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  salePrice: { fontSize: 20, fontWeight: '700' },
  saleWas: { fontSize: 15, textDecorationLine: 'line-through' },
  saleBadge: {
    fontSize: 13,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  muted: { fontSize: 13, padding: 16 },
  btn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 18,
  },
  btnGhost: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
