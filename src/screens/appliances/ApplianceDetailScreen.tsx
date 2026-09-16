/**
 * One appliance, its service history and — for the first time anywhere in the
 * app — its DOCUMENTS.
 *
 * ## Why this screen exists at all
 *
 * `AppliancesScreen` has shipped as a list with two empty stubs
 * (`onPress={() => {/* Navigate to detail *\/}}`) since it was written, and
 * `HouseAttachmentField` — the component that reaches the H6 encrypted blob
 * channel — had **no caller anywhere in `src/`**. Those two facts were the same
 * fact: there was nowhere to put an attachment, because `appliance_documents`
 * was in no registry (`features/house/local/schema.ts`), so
 * `localAppliancesApi.getDocuments` / `addDocument` could only throw. The
 * registry correction of 2026-08-15 closed that, and this screen is what makes
 * it reachable by a member rather than by a test.
 *
 * ## The attachment contract, which is the part worth reading
 *
 * `HouseAttachmentField` is **single-valued**: it holds one
 * `HouseBlobDescriptor` or null, and it never touches the ledger — the host
 * persists. An appliance has MANY documents, so the field is used here as a
 * COMPOSER rather than as the record:
 *
 *   pick → seal + upload (the field) → `onChange(descriptor)` → `addDocument`
 *   (this screen) → the row lands in the list below → the field resets to null
 *   and is ready for the next one.
 *
 * That reset is deliberate and is the only sane reading of a single-valued
 * field on a many-valued entity. Leaving the descriptor sitting in the field
 * after the row is written would show the same document twice — once as
 * "attached, not yet filed" and once as a real row — and the member would have
 * no way to tell which of the two the appliance actually has.
 *
 * **If the persist fails, the bytes are deleted.** An upload that succeeded and
 * a row that did not is the worst of the possible outcomes: the member is
 * charged against the household's attachment quota for a file nothing can ever
 * open again, forever, on every device. `deleteHouseBlob` is best-effort — a
 * failure there costs storage, while blocking the error message on it would cost
 * the explanation.
 *
 * ## Why the attachment UI is gated on `isHouseLocalFirst()`
 *
 * On a server-backed build the blob channel is not the storage path at all:
 * `addDocument` goes to the Worker, which files an `r2_key` naming an object
 * that only the legacy direct-to-R2 upload flow writes — and House has no such
 * flow for appliances (there is no `getUploadUrl` on `appliancesApi`). Sealing
 * a file to a household key and handing the Worker a `lf-blob/…` key would
 * produce a row pointing at bytes its own R2 bucket has never seen. So the
 * field is shown only where it works, and the existing documents are still
 * LISTED on both paths, because reading them is not the part that differs.
 *
 * ## Errors
 *
 * Every failure the blob channel can produce is one of the five named H6 states
 * and is rendered through `houseBlobErrorCopy` — quota, too large, corrupt, key
 * unavailable, still uploading. `HouseAttachmentField` renders most of them
 * itself; this screen owns the ones that can only happen on ITS side of the
 * contract (the ledger write after a successful upload) and renders them the
 * same way, because "we could not save that" and "your home is out of
 * attachment storage" need different answers from the member.
 */
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation, useRoute, type RouteProp } from 'expo-router/react-navigation';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  appliancesApi,
  APPLIANCE_CATEGORIES,
  type Appliance,
  type ApplianceDocument,
} from '@api/appliances';
import { AppBackground, SafeAreaView, ScreenHeader } from '@components/common';
import { HouseAttachmentField } from '@components/house-v2/HouseAttachmentField';
import {
  formatBlobBytes,
  houseBlobErrorCopy,
  type HouseBlobErrorCopy,
} from '@components/house-v2/houseBlobErrorCopy';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { Button, Card, Chip, TextInput, Typography } from '@components/ui';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { Icon } from '@components/ui/Icon';
import {
  BLOB_MAX_PLAINTEXT_BYTES,
  deleteHouseBlob,
  type HouseBlobDescriptor,
} from '@features/house/local/blobs';
import { isHouseLocalFirst } from '@features/house/local/flag';
import type { SettingsStackParamList } from '@navigation/types';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import type { IoniconName } from '@utils/categoryIcons';
import { keyboardDismissScrollProps } from '@utils/keyboard';

type NavigationProp = NativeStackNavigationProp<SettingsStackParamList, 'ApplianceDetail'>;
type RouteProps = RouteProp<SettingsStackParamList, 'ApplianceDetail'>;

type ApplianceDocumentType = ApplianceDocument['type'];

/**
 * The member chooses what they are filing, rather than the screen guessing from
 * a mime type. A photograph of a serial plate is a `photo`; a photograph of a
 * paper receipt is a `receipt`; the bytes are identical and only the member
 * knows which. Guessing would file half the household's paperwork under the
 * wrong heading and give them no way to correct it — there is no edit route for
 * a document on either backend.
 */
const DOCUMENT_TYPES: { id: ApplianceDocumentType; label: string }[] = [
  { id: 'receipt', label: 'Receipt' },
  { id: 'warranty', label: 'Warranty' },
  { id: 'manual', label: 'Manual' },
  { id: 'service_record', label: 'Service record' },
  { id: 'photo', label: 'Photo' },
];

const DOCUMENT_LABELS: Record<ApplianceDocumentType, string> = {
  receipt: 'Receipt',
  warranty: 'Warranty',
  manual: 'Manual',
  service_record: 'Service record',
  photo: 'Photo',
};

const LOAD_FAILED =
  'We could not open this appliance just now. Nothing was changed — try again in a moment.';
const SAVE_FAILED =
  'We could not save that appliance just now. Nothing was changed — try again in a moment.';
const FILE_FAILED =
  'Your file finished uploading, but we could not file it against this appliance. Nothing else was changed — try adding it again.';

function categoryIcon(category: string): IoniconName {
  return APPLIANCE_CATEGORIES.find((c) => c.id === category)?.icon ?? 'cube';
}

/** Images render as images; everything else is a file row carrying its type. */
function isImageDocument(document: ApplianceDocument): boolean {
  return (document.blob?.mime ?? '').startsWith('image/');
}

export function ApplianceDetailScreen() {
  const colors = useAppColors();
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const currentHousehold = useHouseholdStore((state) => state.currentHousehold);

  const applianceId = route.params?.applianceId;
  // The route may carry the property explicitly (a caller that already knows
  // it), and falls back to the active one. A multi-property device that switched
  // mid-navigation would otherwise read one home's appliance out of another's.
  const householdId = route.params?.householdId ?? currentHousehold?.id;
  const isNew = !applianceId;

  const [appliance, setAppliance] = useState<Appliance | null>(null);
  const [documents, setDocuments] = useState<ApplianceDocument[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [blobError, setBlobError] = useState<HouseBlobErrorCopy | null>(null);

  // Add mode. Deliberately the four fields the list screen renders — name,
  // category, type, brand — rather than all fourteen columns: the detail view
  // below is where the rest is filled in, and a fourteen-field wall is how an
  // "add appliance" flow gets abandoned halfway.
  const [draftName, setDraftName] = useState('');
  const [draftCategory, setDraftCategory] = useState(APPLIANCE_CATEGORIES[0]!.id);
  const [draftType, setDraftType] = useState('');
  const [draftBrand, setDraftBrand] = useState('');
  const [saving, setSaving] = useState(false);

  const [documentType, setDocumentType] = useState<ApplianceDocumentType>('receipt');

  const attachmentsAvailable = isHouseLocalFirst();

  const load = useCallback(async () => {
    if (!householdId || !applianceId) return;
    setLoading(true);
    setError(null);
    try {
      const { appliance: found } = await appliancesApi.get(householdId, applianceId);
      setAppliance(found);
      // Documents are loaded separately and their failure is NOT fatal: an
      // appliance the member can read with a document list they cannot is a
      // strictly better screen than no screen, and on a server-backed build
      // this call can legitimately answer with nothing.
      try {
        const { documents: found_documents } = await appliancesApi.getDocuments(
          householdId,
          applianceId,
        );
        setDocuments(found_documents);
      } catch {
        setDocuments([]);
      }
    } catch {
      setError(LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, [householdId, applianceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = useCallback(async () => {
    if (!householdId || !draftName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { appliance: created } = await appliancesApi.create(householdId, {
        name: draftName.trim(),
        category: draftCategory,
        // `type` is required by the API and is free text; falling back to the
        // category label keeps the row honest rather than storing an empty
        // string the list screen would render as a blank chip.
        type: draftType.trim() || draftCategory,
        brand: draftBrand.trim() || undefined,
      });
      setAppliance(created);
      // Straight into detail mode on the same screen: the member has just named
      // the appliance and the next thing they want is to photograph its serial
      // plate or file the receipt, which needs the row to exist first.
      navigation.setParams({ applianceId: created.id, householdId });
    } catch {
      setError(SAVE_FAILED);
    } finally {
      setSaving(false);
    }
  }, [householdId, draftName, draftCategory, draftType, draftBrand, navigation]);

  /**
   * The host half of the attachment contract. `HouseAttachmentField` has already
   * sealed and uploaded the bytes by the time this runs; all that is left is the
   * ledger row, and the descriptor is what makes it openable by a peer.
   */
  const fileDocument = useCallback(
    async (descriptor: HouseBlobDescriptor | null) => {
      if (!descriptor || !householdId || !appliance) return;
      setBlobError(null);
      try {
        const { document } = await appliancesApi.addDocument(householdId, appliance.id, {
          type: documentType,
          // The facade replaces this with the synthetic `lf-blob/<blobId>` key
          // when a descriptor is present. It is sent anyway because the remote
          // signature requires it and the same call has to compile on both paths.
          r2_key: descriptor.blobId,
          blob: descriptor,
        });
        setDocuments((current) => [document, ...current]);
      } catch (err) {
        setBlobError(houseBlobErrorCopy(err, FILE_FAILED, BLOB_MAX_PLAINTEXT_BYTES));
        // Uploaded bytes with no row are quota the member pays for and can never
        // reach. Best-effort: a failed delete costs storage, blocking the error
        // message on it would cost the explanation.
        void deleteHouseBlob(descriptor.blobId, householdId).catch(() => {});
      }
    },
    [householdId, appliance, documentType],
  );

  const warrantyLabel = useMemo(() => {
    const expiry = appliance?.warranty?.manufacturer?.expiration;
    if (!expiry) return null;
    const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
    if (Number.isNaN(days)) return null;
    return days < 0 ? 'Warranty expired' : `Warranty: ${days} days left`;
  }, [appliance]);

  const title = isNew ? 'Add appliance' : (appliance?.name ?? 'Appliance');

  const header = (
    <ScreenHeader
      title={title}
      showBackButton
      onBackPress={() => navigation.goBack()}
      showNotificationBell={false}
      showAvatar={false}
      showPropertySwitcher={false}
    />
  );

  if (!householdId) {
    return (
      <AppBackground opacity={0.5}>
        <SafeAreaView edges={['top']}>
          <View style={styles.container}>
            {header}
            <View style={styles.centered}>
              <Typography variant="title3" weight="semibold" align="center">
                No Home Selected
              </Typography>
            </View>
          </View>
        </SafeAreaView>
      </AppBackground>
    );
  }

  return (
    <AppBackground opacity={0.5}>
      <SafeAreaView edges={['top']}>
        <View style={styles.container}>
          {header}

          <ScrollView
            {...keyboardDismissScrollProps}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            testID="appliance-detail-scroll"
          >
            {loading ? (
              <View style={styles.centered} testID="appliance-detail-loading">
                <ActivityIndicator size="large" color={colors.primary} />
              </View>
            ) : null}

            {error ? (
              <Card
                variant="filled"
                style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              >
                <Typography variant="body" color={colors.error} testID="appliance-detail-error">
                  {error}
                </Typography>
              </Card>
            ) : null}

            {/* ---- add mode ------------------------------------------------ */}
            {isNew && !appliance ? (
              <Card
                variant="filled"
                style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              >
                <TextInput
                  label="Name"
                  value={draftName}
                  onChangeText={setDraftName}
                  placeholder="Furnace"
                  testID="appliance-name-input"
                />
                <View style={styles.chipRow}>
                  {APPLIANCE_CATEGORIES.map((category) => (
                    <Chip
                      key={category.id}
                      label={category.label}
                      variant={draftCategory === category.id ? 'primary' : 'secondary'}
                      onPress={() => setDraftCategory(category.id)}
                    />
                  ))}
                </View>
                <TextInput
                  label="Type"
                  value={draftType}
                  onChangeText={setDraftType}
                  placeholder="Heat pump"
                  testID="appliance-type-input"
                />
                <TextInput
                  label="Brand"
                  value={draftBrand}
                  onChangeText={setDraftBrand}
                  placeholder="Lennox"
                  testID="appliance-brand-input"
                />
                <Button
                  title="Save appliance"
                  onPress={() => void create()}
                  loading={saving}
                  disabled={saving || !draftName.trim()}
                  testID="appliance-save"
                />
                <Typography variant="caption1" color={colors.textTertiary}>
                  Receipts, manuals and warranty scans can be attached once the appliance is saved.
                </Typography>
              </Card>
            ) : null}

            {/* ---- the appliance ------------------------------------------- */}
            {appliance ? (
              <Card
                variant="filled"
                style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              >
                <View style={styles.heroRow}>
                  <View style={[styles.iconBox, { backgroundColor: colors.backgroundMain }]}>
                    <Icon
                      name={categoryIcon(appliance.category)}
                      size={24}
                      color={colors.textPrimary}
                    />
                  </View>
                  <View style={styles.grow}>
                    <Typography variant="headline" weight="semibold" testID="appliance-detail-name">
                      {appliance.name}
                    </Typography>
                    <Typography variant="footnote" color={colors.textSecondary}>
                      {[appliance.brand, appliance.model].filter(Boolean).join(' ') ||
                        appliance.type}
                    </Typography>
                  </View>
                </View>

                <View style={styles.chipRow}>
                  <View style={[styles.badge, { backgroundColor: colors.backgroundMain }]}>
                    <Typography variant="caption2" color={colors.textSecondary}>
                      {appliance.type}
                    </Typography>
                  </View>
                  {appliance.location ? (
                    <View style={[styles.badge, { backgroundColor: colors.backgroundMain }]}>
                      <Typography variant="caption2" color={colors.textSecondary}>
                        {appliance.location}
                      </Typography>
                    </View>
                  ) : null}
                  {warrantyLabel ? (
                    <View style={[styles.badge, { backgroundColor: colors.backgroundMain }]}>
                      <Typography
                        variant="caption2"
                        color={colors.textSecondary}
                        testID="appliance-detail-warranty"
                      >
                        {warrantyLabel}
                      </Typography>
                    </View>
                  ) : null}
                </View>

                {appliance.serial_number ? (
                  <Typography variant="caption1" color={colors.textTertiary}>
                    {`Serial ${appliance.serial_number}`}
                  </Typography>
                ) : null}
              </Card>
            ) : null}

            {/* ---- documents ------------------------------------------------ */}
            {appliance ? (
              <Card
                variant="filled"
                style={[styles.card, { backgroundColor: colors.backgroundSecondary }]}
              >
                <Typography variant="headline" weight="semibold">
                  Documents
                </Typography>

                {documents.length === 0 ? (
                  <Typography
                    variant="body"
                    color={colors.textSecondary}
                    testID="appliance-documents-empty"
                  >
                    No receipts, manuals or warranty scans yet.
                  </Typography>
                ) : (
                  documents.map((document) => (
                    <View
                      key={document.id}
                      style={[styles.documentRow, { borderColor: colors.borderColor }]}
                      testID={`appliance-document-${document.id}`}
                    >
                      {document.blob && isImageDocument(document) ? (
                        // A descriptor is not a URL — the bytes are AES-GCM
                        // sealed in R2 and have to be fetched, opened and
                        // hash-checked before anything can render them.
                        <HouseBlobImage
                          descriptor={document.blob}
                          householdId={householdId}
                          width={56}
                          height={56}
                          accessibilityLabel={`${DOCUMENT_LABELS[document.type]} for ${appliance.name}`}
                          testID={`appliance-document-image-${document.id}`}
                        />
                      ) : (
                        <View style={[styles.iconBox, { backgroundColor: colors.backgroundMain }]}>
                          <Icon
                            name="document-outline"
                            size={20}
                            color={colors.textSecondary}
                          />
                        </View>
                      )}
                      <View style={styles.grow}>
                        <Typography variant="body" numberOfLines={1}>
                          {DOCUMENT_LABELS[document.type] ?? 'Document'}
                        </Typography>
                        <Typography variant="captionSmall" color={colors.textTertiary}>
                          {document.blob
                            ? formatBlobBytes(document.blob.bytes)
                            : 'Stored on this home’s server'}
                        </Typography>
                      </View>
                    </View>
                  ))
                )}

                {attachmentsAvailable ? (
                  <>
                    <View style={styles.chipRow}>
                      {DOCUMENT_TYPES.map((option) => (
                        <Chip
                          key={option.id}
                          label={option.label}
                          variant={documentType === option.id ? 'primary' : 'secondary'}
                          onPress={() => setDocumentType(option.id)}
                        />
                      ))}
                    </View>
                    <HouseAttachmentField
                      label={`Add a ${DOCUMENT_LABELS[documentType].toLowerCase()}`}
                      // Always null: the field is a COMPOSER here, not the
                      // record. Once `fileDocument` writes the row it appears in
                      // the list above, and showing it in both places would leave
                      // the member unable to tell which one the appliance has.
                      value={null}
                      onChange={(next) => void fileDocument(next)}
                      householdId={householdId}
                      accept="any"
                      style={styles.attachment}
                    />
                  </>
                ) : (
                  <Typography
                    variant="caption1"
                    color={colors.textTertiary}
                    testID="appliance-attachments-unavailable"
                  >
                    Attaching files needs this home’s private storage, which is not switched on for
                    this build. Everything else about the appliance works, and any documents already
                    filed are listed above.
                  </Typography>
                )}

                {blobError ? (
                  <View
                    style={[
                      styles.errorPanel,
                      { backgroundColor: colors.backgroundMain, borderColor: colors.warning },
                    ]}
                    testID="appliance-document-error"
                  >
                    <Typography
                      variant="bodySmallSemibold"
                      color={colors.warning}
                      testID="appliance-document-error-title"
                    >
                      {blobError.title}
                    </Typography>
                    <Typography
                      variant="caption1"
                      color={colors.textSecondary}
                      testID="appliance-document-error-message"
                    >
                      {blobError.message}
                    </Typography>
                  </View>
                ) : null}
              </Card>
            ) : null}
          </ScrollView>
        </View>
      </SafeAreaView>
    </AppBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 12,
  },
  centered: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    padding: 16,
    borderRadius: 16,
    gap: 12,
  },
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconBox: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grow: {
    flex: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  documentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  attachment: {
    marginTop: 4,
  },
  errorPanel: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 2,
  },
});

export default ApplianceDetailScreen;
