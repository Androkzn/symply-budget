import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { floorPlansApi, type FloorPlan } from '@api/floor-plans';
import {
  describeMaterialCard,
  extractMaterialFromShelfTag,
  homeProjectsApi,
  isHomeProjectConflict,
  useHomeProjectActivity,
  useHomeProjectHub,
  useHomeProjectMutation,
  type HomeProjectAttachment,
  type HomeProjectBlocker,
  type HomeProjectBlockerStatus,
  type HomeProjectBudgetLine,
  type HomeProjectPhase,
  type HomeProjectPhaseStatus,
  type HomeProjectSelection,
} from '@api/home-projects';
import { AttachmentSourceSheet, ScreenHeader } from '@components/common';
import { useAttachmentSources } from '@components/common/useAttachmentSources';
import { BlockerList } from '@components/home-projects/BlockerList';
import { BudgetBar } from '@components/home-projects/BudgetBar';
import { BudgetVisuals } from '@components/home-projects/BudgetVisuals';
import { ProjectAccessSheet } from '@components/home-projects/ProjectAccessSheet';
import { SmartDraftReviewBanner } from '@components/home-projects/SmartDraftReviewBanner';
import {
  BlockerEditSheet,
  PhaseEditSheet,
} from '@components/home-projects/StepEditSheet';
import { SurfaceSummaryCard } from '@components/home-projects/surfaces/SurfaceSummaryCard';
import { Timeline } from '@components/home-projects/Timeline';
import { HouseBlobImage } from '@components/house-v2/HouseBlobImage';
import { HousePhotoViewer } from '@components/house-v2/HousePhotoViewer';
import { ActivityIndicator } from '@components/ui/ActivityIndicator';
import { BottomSheet } from '@components/ui/BottomSheet';
import { FloatingActionButton } from '@components/ui/FloatingActionButton';
import { Icon } from '@components/ui/Icon';
import { Typography } from '@components/ui/Typography';
import {
  CHAT_SUBJECT_PROJECT,
  houseChatConfig,
  SubjectChatButton,
  type SubjectChatTarget,
} from '@features/chat';
import {
  AI_ACCESS_ROUTE,
  useMemberFacingAlert,
} from '@features/house/local/useMemberFacingAlert';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { HomeProjectsStackParamList } from '@navigation/types';
import { trackEvent } from '@services/analytics';
import { setMonitoringTag } from '@services/monitoring';
import { roomPlan } from '@services/roomplan';
import { useHouseholdStore } from '@stores/householdStore';
import { normalizeHomeProjectVisibility } from '@symply/contracts';
import { IconSize, Layout, useAppColors } from '@theme';
import { getActivityLabel } from '@utils/homeProjectActivityLabel';
import { keyboardDismissScrollProps, numericTextHandler } from '@utils/keyboard';
import { formatMoney, useDisplayCurrency } from '@utils/money';

import { buildProjectChatContext } from './projectChatContext';

type Props = NativeStackScreenProps<
  HomeProjectsStackParamList,
  'HomeProjectHub'
>;

type Section =
  | 'overview'
  | 'plans'
  | 'materials'
  | 'budget'
  | 'timeline'
  | 'tasks'
  | 'photos'
  | 'blockers'
  | 'activity';

/**
 * What the tab pills READ. The section key stays lower-case because it is the
 * `testID` (`hub-tab-overview`) every Maestro flow taps by, so the label is a
 * lookup rather than a `toUpperCase()` on the key.
 */
const SECTION_LABELS: Record<Section, string> = {
  overview: 'Overview',
  plans: 'Plans',
  materials: 'Materials',
  budget: 'Budget',
  timeline: 'Timeline',
  tasks: 'Tasks',
  photos: 'Photos',
  blockers: 'Blockers',
  activity: 'Activity',
};

/** Same again for the photo filter pills, and for the same testID reason. */
const PHOTO_FILTER_LABELS: Record<'all' | 'before' | 'after', string> = {
  all: 'All',
  before: 'Before',
  after: 'After',
};

/** Where a material can come from. The id is also its `testID` suffix. */
export type MaterialAddSource =
  | 'manual'
  | 'link'
  | 'library'
  | 'files'
  | 'camera'
  | 'drive';

/**
 * The five ways a material gets into a project, as ONE flat list.
 *
 * Flat rather than nested on purpose. The three photo sources (library, Files,
 * camera) are the obvious candidates for a "Add with photo →" submenu, but that
 * buys one shorter menu at the cost of a second tap on the three entries a
 * member reaches for most, and hides them behind a label that does not say
 * "camera". Five rows fit on one sheet on the smallest phone we ship to, so
 * there is nothing to save.
 *
 * Exported and pure so the option SET can be asserted without standing up a
 * 2,500-line screen — same reasoning as `buildProjectMenuActions`. This list is
 * now the ONLY route to adding a material (the inline form that used to sit in
 * the tab is gone), so a row that silently stops being built is a way in that
 * silently stops existing, and no type error or lint rule would say so.
 */
export const MATERIAL_ADD_OPTIONS: ReadonlyArray<{
  id: MaterialAddSource;
  label: string;
  icon: string;
}> = [
  { id: 'manual', label: 'Add manually', icon: 'create-outline' },
  { id: 'link', label: 'Add from link', icon: 'link-outline' },
  { id: 'library', label: 'Add from library', icon: 'images-outline' },
  { id: 'files', label: 'Add from Files', icon: 'folder-outline' },
  { id: 'camera', label: 'Add from camera', icon: 'camera-outline' },
  { id: 'drive', label: 'Add from Drive', icon: 'cloud-outline' },
];

/**
 * What a photographed material is called until something reads its label.
 *
 * Deliberately blank-sounding. The alternatives all pretend to know something —
 * "Camera photo" names the device rather than the thing, and a filename names a
 * timestamp — whereas this reads as an unfinished row, which is exactly what it
 * is, and invites the tap that finishes it. The shelf-tag reader replaces it
 * with the product's real name whenever it can.
 */
const MATERIAL_PHOTO_PLACEHOLDER_NAME = 'New material';

/**
 * What the Files picker will offer.
 *
 * Images only — a material's attachment is a PHOTO of the thing (the upload
 * path normalises and re-encodes it as a JPEG, see `uploadSelectionPhoto`), so
 * letting a member through to a PDF spec sheet here would hand the uploader
 * bytes it cannot render and produce an attachment that shows nothing. HEIC is
 * listed because it is what an iPhone saves by default; the uploader converts.
 */
const MATERIAL_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
];

/** Budget-line categories, as the member reads them. */
const BUDGET_CATEGORY_LABELS: Record<string, string> = {
  materials: 'Materials',
  labor: 'Labor',
  permits: 'Permits',
  other: 'Other',
  contingency: 'Contingency',
};

/** What the add-a-line form offers. Mirrors the route's `z.enum`. */
type BudgetLineCategory =
  | 'materials'
  | 'labor'
  | 'permits'
  | 'contingency'
  | 'other';

/**
 * The categories a member may FILE a new line under.
 *
 * `contingency` is missing on purpose. It is a real category and the rollup reads
 * it, but a line in it REPLACES the percentage outright (`computeRollups` prefers
 * an explicit line), so offering it in the same form as Materials would let
 * somebody silently override the rate they set two fields higher up without ever
 * being told. Contingency has its own field.
 */
const BUDGET_LINE_CATEGORIES: BudgetLineCategory[] = [
  'materials',
  'labor',
  'permits',
  'other',
];

/**
 * What the member typed, as integer cents — or `null` if it is not a number.
 *
 * Empty is 0 rather than null: clearing an estimate is "this costs nothing yet",
 * which is a figure. A negative is rejected rather than clamped, because a
 * minus sign is a typo here and silently storing its absolute value would hide
 * one.
 */
function parseMoneyToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return 0;
  const dollars = Number(trimmed);
  if (!Number.isFinite(dollars) || dollars < 0) return null;
  return Math.round(dollars * 100);
}

/** What contingency is, in the words a member asked the question in. */
const CONTINGENCY_EXPLAINER =
  'A contingency is money you set aside for the surprises — the rot behind the tiles, ' +
  'the fitting that turns out to be the wrong size, the extra day of labour.\n\n' +
  'It is a percentage of everything you have priced, added on top of it. At 0% ' +
  'this project costs exactly what you have entered and nothing more, which is ' +
  'why 0% is the default: the app will not guess a buffer for a job it has never ' +
  'seen.\n\n' +
  'Set your own rate if you want one. Trades often work to 10–20% on work that ' +
  'opens up walls, but that is your call and your number, not ours.';

function conflictAlert(refetch: () => void) {
  Alert.alert('Someone else updated this', 'Pull to refresh and try again.', [
    { text: 'Refresh', onPress: () => void refetch() },
    { text: 'OK', style: 'cancel' },
  ]);
}

/** One row of the header's "…" menu. */
export interface ProjectMenuAction {
  label: string;
  run: () => void;
  /** Renders red, and takes `destructiveButtonIndex` on iOS. */
  destructive?: boolean;
}

export interface ProjectMenuHandlers {
  manageAccess: () => void;
  publish: () => void;
  unpublish: () => void;
  archive: () => void;
  unarchive: () => void;
  remove: () => void;
}

/**
 * What the header's "…" menu offers, as data.
 *
 * Exported and pure so the action SET can be asserted without standing up a
 * 1,500-line screen. That matters more than it looks: the menu is the only way
 * to reach publish, access, archive and delete, so an item that silently stops
 * being built is a feature that silently stops existing — and nothing else in
 * the codebase would notice.
 *
 * "Edit budget" is deliberately NOT here. It never edited anything: it jumped to
 * the Budget tab and focused the target field, which is one tap away from the tab
 * pill already visible on screen. Every budget figure is now editable in place on
 * that tab, so a menu row whose only job was to scroll there is a second entry
 * point to the same editor with a name that promises a different one.
 *
 * The two toggles are rendered as ONE row each rather than two, because
 * "Publish" and "Move back to a draft" are the same affordance in two states and
 * showing both at once would ask the member to work out which one applies.
 *
 * Delete is last and destructive. It sits directly below Archive on purpose: the
 * reversible answer to almost every reason a member reaches for delete is one
 * row above it, and its own confirmation offers Archive again.
 */
export function buildProjectMenuActions(
  state: { isDraft: boolean; isArchived: boolean },
  handlers: ProjectMenuHandlers,
): ProjectMenuAction[] {
  return [
    { label: 'Manage access', run: handlers.manageAccess },
    state.isDraft
      ? { label: 'Publish to household', run: handlers.publish }
      : { label: 'Move back to a draft', run: handlers.unpublish },
    state.isArchived
      ? { label: 'Unarchive', run: handlers.unarchive }
      : { label: 'Archive', run: handlers.archive },
    { label: 'Delete project', run: handlers.remove, destructive: true },
  ];
}

/** Side of the square cover thumbnail beside the header title. */
const HEADER_COVER_SIZE = 28;

/**
 * The photo that stands in for the project beside its name in the header.
 *
 * `cover_url` is resolved by `list` alone (`home-projects-service`), so the hub
 * payload has no such field: it carries the id on `project.cover_attachment_id`
 * and the bytes in `attachments`, and pairing them up is this screen's job.
 *
 * An attachment only counts once it is `ready` AND addressable — a server-backed
 * row by `url`, a local-first one by the sealed `blob` only `HouseBlobImage`
 * opens, and a row still uploading has neither. A dangling `cover_attachment_id`
 * (the column has no foreign key) therefore falls through rather than rendering
 * a hole.
 *
 * The fallback to the first ready photo is most of the value here. A cover is
 * chosen from the list screen and most projects never get one, so keying the
 * header strictly on `cover_attachment_id` would leave it blank for exactly the
 * projects that do have photos to show.
 */
export function pickProjectCoverAttachment(
  coverAttachmentId: string | null | undefined,
  attachments: HomeProjectAttachment[],
): HomeProjectAttachment | null {
  const renderable = (a: HomeProjectAttachment) =>
    a.status === 'ready' && !!(a.url || a.blob);
  const chosen = coverAttachmentId
    ? attachments.find(a => a.id === coverAttachmentId && renderable(a))
    : undefined;
  return (
    chosen ?? attachments.find(a => a.kind === 'photo' && renderable(a)) ?? null
  );
}

/**
 * One material, as a row in a list that gets SCANNED.
 *
 * Replaces `SelectionCard`, which drew a name and the string
 * "No price · link" — where "link" was inert text rather than a way to reach
 * the shop, and where the price, the offer, the store and the photo the
 * importer had already written to the row were all unreachable.
 *
 * Three rules hold the layout together, and each one is about a list rather
 * than about a card:
 *
 *  - **Every row has a visual.** A missing picture falls back to the material's
 *    own colour, and a missing colour to a placeholder. An empty box in a
 *    scanned column does not read as "no photo", it reads as a row that failed.
 *    Paint is the case that earns the swatch outright: a paint material IS a
 *    colour, and shops rarely publish a photo of one worth showing.
 *  - **The sale is the only loud thing.** `−59%` beside a strike-through is
 *    what makes a member act, so it gets weight — and nothing else on the row
 *    competes with it. This is a shortlist, not a promotion.
 *  - **The badge does not rely on colour.** The percentage is IN the text, so a
 *    member who cannot separate the tint from the pill still reads the offer,
 *    and `accessibilityLabel` says the whole thing in a sentence.
 *
 * What may be drawn at all is decided by `describeMaterialCard` rather than
 * here — see its header, and `describeMaterialSale` for why an expired sale is
 * not a sale.
 */
function MaterialCard({
  selection,
  currency,
  householdId,
  attachment,
  onOpen,
}: {
  selection: HomeProjectSelection;
  /** The PROJECT's currency, not the display preference: a budget is in one. */
  currency: string | null | undefined;
  householdId: string | undefined;
  attachment: HomeProjectAttachment | undefined;
  onOpen: () => void;
}) {
  const colors = useAppColors();
  // Re-render amounts when Settings → Currency changes.
  useDisplayCurrency();

  const facts = describeMaterialCard(selection, Date.now(), {
    hasBlob: !!attachment?.blob,
    url: attachment?.url,
  });
  const { sale, visual, link } = facts;
  // Two decimals, always. A tile at $5.98 rendered as "$6" is a number the
  // member cannot check against the shelf, and the sale price is the whole
  // reason this row is loud.
  const money = (cents: number) =>
    formatMoney(cents, { code: currency, decimals: 2 });

  return (
    <Pressable
      onPress={onOpen}
      style={[
        styles.materialCard,
        { backgroundColor: colors.card, borderColor: colors.borderColor },
      ]}
      testID={`selection-card-${selection.id}`}
    >
      <View style={styles.materialTop}>
        {/*
          The visual, at a size that survives a scan. A local-first household's
          attachment is a sealed blob only `HouseBlobImage` can open; a
          server-backed one has a url; a link import leaves the vendor's own
          `image_url`. All three are the same picture to a member.
        */}
        {visual.kind === 'blob' && attachment?.blob && householdId ? (
          <HouseBlobImage
            descriptor={attachment.blob}
            householdId={householdId}
            width={56}
            height={56}
            style={styles.materialThumb}
            accessibilityLabel={selection.name}
            testID={`material-photo-blob-${selection.id}`}
          />
        ) : visual.kind === 'image' ? (
          <Image
            source={{ uri: visual.uri }}
            style={[styles.materialThumb, { backgroundColor: colors.card }]}
            resizeMode="cover"
            accessibilityLabel={selection.name}
            testID={`material-photo-${selection.id}`}
          />
        ) : visual.kind === 'swatch' ? (
          /*
            The one hardcoded colour in this screen, and it is DATA — the
            member's own `color_hex`, validated in `describeMaterialVisual`
            before it ever reaches `backgroundColor`.
          */
          <View
            style={[
              styles.materialThumb,
              styles.materialSwatch,
              {
                backgroundColor: visual.colorHex,
                borderColor: colors.borderColor,
              },
            ]}
            accessible
            accessibilityLabel={`Colour swatch for ${selection.name}`}
            testID={`material-swatch-${selection.id}`}
          />
        ) : (
          <View
            style={[
              styles.materialThumb,
              styles.materialSwatch,
              {
                backgroundColor: colors.mediaImagePlaceholder,
                borderColor: colors.borderColor,
              },
            ]}
            testID={`material-placeholder-${selection.id}`}
          >
            <Icon
              name="cube-outline"
              size={IconSize.md}
              color={colors.textTertiary}
            />
          </View>
        )}

        <View style={styles.materialBody}>
          <View style={styles.materialNameRow}>
            <Text
              style={[styles.materialName, { color: colors.textPrimary }]}
              numberOfLines={2}
            >
              {selection.name}
            </Text>
            {/*
              Only a status that SAYS something. `idea` is the column default —
              every template, the AI scope suggester and the add form set it —
              so it appeared on every row and distinguished nothing.
            */}
            {selection.status && selection.status !== 'idea' ? (
              <Text style={[styles.materialStatus, { color: colors.primary }]}>
                {selection.status}
              </Text>
            ) : null}
          </View>

          {/*
            Not `accessible` as a group. Collapsing the row into one element
            would read the offer as one sentence — which is nicer — at the cost
            of hiding the badge and the two prices from the accessibility tree
            the E2E flows walk. The sentence is carried by the badge instead,
            and the strike-through (which is pure styling, and therefore silent)
            by the "was" label on the price it crosses out.
          */}
          <View style={styles.materialPriceRow}>
            {sale.priceCents == null ? (
              <Text
                style={[styles.materialPrice, { color: colors.textSecondary }]}
                testID={`material-price-${selection.id}`}
              >
                No price
              </Text>
            ) : (
              <Text
                style={[styles.materialPrice, { color: colors.textPrimary }]}
                testID={
                  sale.onSale
                    ? `material-sale-price-${selection.id}`
                    : `material-price-${selection.id}`
                }
              >
                {money(sale.priceCents)}
              </Text>
            )}
            {sale.listPriceCents != null ? (
              <Text
                style={[styles.materialWas, { color: colors.textSecondary }]}
                accessibilityLabel={`Was ${money(sale.listPriceCents)}`}
                testID={`material-list-price-${selection.id}`}
              >
                {money(sale.listPriceCents)}
              </Text>
            ) : null}
            {sale.badgeLabel ? (
              <Text
                style={[
                  styles.materialBadge,
                  {
                    color: colors.success,
                    backgroundColor: colors.pillBackground,
                  },
                ]}
                accessibilityLabel={sale.accessibilityLabel ?? undefined}
                testID={`material-sale-badge-${selection.id}`}
              >
                {sale.badgeLabel}
                {sale.endsLabel ? ` · ${sale.endsLabel}` : ''}
              </Text>
            ) : null}
            {/*
              A percentage the vendor stated that no pair of prices backs up.
              Plain text, never reversed into a "was" — that would print a
              number the shop never published, struck through, as a fact.
            */}
            {sale.claimedDiscountPct != null ? (
              <Text
                style={[styles.materialMeta, { color: colors.textSecondary }]}
              >
                {`${sale.claimedDiscountPct}% off claimed`}
              </Text>
            ) : null}
          </View>

          {facts.vendor ? (
            <Text
              style={[styles.materialMeta, { color: colors.textSecondary }]}
              numberOfLines={1}
              testID={`material-vendor-${selection.id}`}
            >
              {facts.vendor}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.materialActions}>
        {/*
          A real tap target where "· link" used to be text. `hitSlop` rather
          than padding: the row is deliberately tight, and a 13pt label is
          under the 44pt minimum on its own.
        */}
        {link ? (
          <Pressable
            onPress={() => void Linking.openURL(link.url)}
            hitSlop={10}
            accessibilityRole="link"
            accessibilityLabel={link.accessibilityLabel}
            testID={`material-open-link-${selection.id}`}
          >
            <Text style={[styles.materialAction, { color: colors.primary }]}>
              Open shop
            </Text>
          </Pressable>
        ) : null}
        {/*
          No Edit and no Remove. The whole card is already the way in — tapping
          it opens the material's screen, which IS the editor — so "Edit" was a
          smaller target for the thing the row already does, and Remove put a
          destructive action under the member's thumb on a list they scroll.
          Delete now lives in that screen's header, one deliberate step away.
        */}
      </View>
    </Pressable>
  );
}

/**
 * The floating tab bar draws over this screen. `styles.contentWithFab` already
 * clears it on the Materials tab (for the FAB), which left the OTHER eight tabs
 * — Overview, Plans, Budget, Timeline, Tasks, Photos, Blockers, Activity — on
 * `styles.content`'s 48px, less than the bar's own height. Whatever ended those
 * tabs came to rest underneath it.
 */
const TAB_BAR_CONTENT_HEIGHT = 64;

export function HomeProjectHubScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { projectId } = route.params;
  const colors = useAppColors();
  /** iPad's floating leading rail draws over x=0 — reserve its width. */
  const { sidebarInset } = useLayoutPadding();
  const router = useRouter();
  const showError = useMemberFacingAlert();
  const householdId = useHouseholdStore(s => s.currentHousehold?.id);
  const unitSystem = useHouseholdStore(s => s.currentHousehold?.unit_system);
  const { data, isLoading, isRefetching, refetch } = useHomeProjectHub(
    householdId,
    projectId,
  );
  const { data: activity = [], refetch: refetchActivity } =
    useHomeProjectActivity(householdId, projectId);
  const { invalidate } = useHomeProjectMutation(householdId, projectId);
  const [section, setSection] = useState<Section>('overview');
  const [newSelection, setNewSelection] = useState('');
  const [selectionPrice, setSelectionPrice] = useState('');
  const [selectionUrl, setSelectionUrl] = useState('');
  const [newBlocker, setNewBlocker] = useState('');
  const [newPhase, setNewPhase] = useState('');
  /**
   * Which phase / blocker the edit sheet is open on, held as an ID rather than
   * the row itself.
   *
   * The row would go stale the moment the hub refetches — the sheet would keep
   * showing the title the member has just renamed away from, and a second edit
   * would compare against it and decide nothing changed. Resolving the id
   * against the current `phases` / `blockers` on every render keeps the sheet
   * looking at the row that actually exists.
   */
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingBlockerId, setEditingBlockerId] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [comment, setComment] = useState('');
  const [zoneNote, setZoneNote] = useState('');
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [linkedTasks, setLinkedTasks] = useState<
    Array<{
      task_id: string;
      title: string | null;
      next_due_date: string | null;
    }>
  >([]);
  const [photoFilter, setPhotoFilter] = useState<'all' | 'before' | 'after'>(
    'all',
  );
  /**
   * Which photo the full-screen viewer is open on, as an index into the
   * FILTERED list — `null` is closed.
   *
   * An index into the filtered list rather than an attachment id because that
   * is what the pager swipes through: opening the third "after" photo and
   * swiping should walk the after photos, not the whole roll. The filter chips
   * close the viewer for the same reason (see `setPhotoFilter` below) — the
   * list underneath an open viewer changing length is how an index starts
   * pointing at a different photo than the one on screen.
   */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  /**
   * `null` means "not being edited" — the field then MIRRORS the saved target on
   * every refetch. Holding a string here from the start would pin whatever was on
   * screen when the hub loaded and quietly overwrite a target another member
   * changed in the meantime.
   */
  const [targetDraft, setTargetDraft] = useState<string | null>(null);
  /** The contingency rate, held the same way and for the same reason. */
  const [contingencyDraft, setContingencyDraft] = useState<string | null>(null);
  /**
   * The budget line being edited, and its two figures as typed.
   *
   * One line at a time rather than a draft per row: an open row is a commitment
   * the member has to resolve, and a screen full of half-typed money is how two
   * of them get saved by accident. `null` closes the editor and hands the row
   * back to the server's values on the next refetch.
   */
  const [editingLineId, setEditingLineId] = useState<string | null>(null);
  const [lineEstimateDraft, setLineEstimateDraft] = useState('');
  const [lineActualDraft, setLineActualDraft] = useState('');
  const [lineLabelDraft, setLineLabelDraft] = useState('');
  /** The add-a-line form: closed until asked for, so the tab opens on figures. */
  const [addingLine, setAddingLine] = useState(false);
  const [newLineLabel, setNewLineLabel] = useState('');
  const [newLineCategory, setNewLineCategory] =
    useState<BudgetLineCategory>('materials');
  const [newLineEstimate, setNewLineEstimate] = useState('');
  const [floorPlans, setFloorPlans] = useState<FloorPlan[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * The tab's scroller, held so an add can take the member to what they added.
   *
   * A new material is written to the TOP of the list (`topSelectionSortOrder`
   * on the Worker, `topSortOrder` on the local facade) and the add button is a
   * FAB reachable from anywhere in a list that runs to dozens of rows — so the
   * member is routinely nowhere near the top when the write lands. Landing the
   * row somewhere off-screen answers the tap with silence, which is the same
   * complaint as burying it at the bottom was.
   */
  const scrollRef = useRef<ScrollView>(null);
  /**
   * The add-material flow, in two pieces: the source menu, and whichever sheet
   * the chosen source opens.
   *
   * They are separate because the three photo sources open no sheet at all —
   * they close the menu and go straight to a picker — so a single "which step am
   * I on" enum would need a state for each picker that nothing ever renders.
   */
  const [materialMenuOpen, setMaterialMenuOpen] = useState(false);
  const [materialSheet, setMaterialSheet] = useState<'manual' | 'link' | null>(
    null,
  );
  /** The manage-permissions sheet. Its roster read is gated on this being true. */
  const [accessOpen, setAccessOpen] = useState(false);

  useEffect(() => {
    setMonitoringTag('feature', 'home_projects');
  }, []);

  useEffect(() => {
    if (!householdId || section !== 'plans') return;
    void floorPlansApi
      .list(householdId)
      .then(res => setFloorPlans(res.floor_plans || []))
      .catch(() => setFloorPlans([]));
  }, [householdId, section]);

  useEffect(() => {
    if (!householdId || section !== 'tasks') return;
    void homeProjectsApi
      .listTasks(householdId, projectId)
      .then(res => setLinkedTasks(res.tasks || []))
      .catch(() => setLinkedTasks([]));
  }, [householdId, projectId, section, data?.project.updated_at]);

  // Re-render amounts when Settings → Currency changes, as `BudgetBar` does.
  useDisplayCurrency();

  /**
   * What the project currently costs, by where the money goes — composed from the
   * same budget lines the rollup sums, so the parts and the total cannot disagree.
   *
   * Contingency is EXCLUDED here and shown from `rollups.contingency_cents`
   * instead: it is a percentage of the rest unless a member has added an explicit
   * line, and summing that line here as well would count it twice.
   */
  const budgetByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    for (const line of data?.budget_lines ?? []) {
      if (line.category === 'contingency') continue;
      totals.set(
        line.category,
        (totals.get(line.category) ?? 0) + line.estimate_cents,
      );
    }
    return [...totals.entries()].filter(([, cents]) => cents > 0);
  }, [data?.budget_lines]);

  /**
   * The project's own conversation — one room, shared by every member who can
   * see the project, with the assistant reachable by `@ai`.
   *
   * `buildContext` is a thunk, so walking the selections, phases and blockers to
   * brief the assistant happens on the tap and not on every render of a hub that
   * re-renders on each section change.
   *
   * A DRAFT project is private to whoever created it, so its chat is opened
   * restricted to that member. Getting this the other way round would publish a
   * private plan's discussion to the whole household — the room list is the one
   * place a draft would otherwise become visible.
   */
  const chatTarget = useMemo<SubjectChatTarget | null>(() => {
    const project = data?.project;
    if (!project) return null;
    const isPrivate = normalizeHomeProjectVisibility(project.visibility) === 'draft';
    return {
      type: CHAT_SUBJECT_PROJECT,
      id: project.id,
      label: project.title,
      buildContext: () => buildProjectChatContext(data),
      participantIds:
        isPrivate && project.created_by ? [project.created_by] : undefined,
    };
  }, [data]);

  /**
   * Where a photographed material's bytes come from — all four sources.
   *
   * This screen used to reach `expo-image-picker` and `expo-document-picker`
   * directly for library / camera / Files, each with its own permission prompt
   * and its own wording, and Drive was simply absent. `useAttachmentSources`
   * owns all of that now, so the menu above only has to say WHICH source the
   * member chose; what happens to the uri afterwards is unchanged.
   */
  const { sourceHandlers: materialSources, drivePicker: materialDrivePicker } =
    useAttachmentSources({
      rememberScope: 'home-project-material',
      mimeTypes: MATERIAL_IMAGE_MIME_TYPES,
      pickerOptions: { compressImageQuality: 0.8, mediaType: 'photo' },
      onPicked: ([picked], source) => {
        // `gallery` is this hook's name for it; the analytics event has said
        // `library` since the feature shipped, and renaming a dimension mid-
        // series silently splits every chart built on it.
        if (picked) {
          void addSelectionPhoto(
            picked.uri,
            source === 'gallery' ? 'library' : source,
          );
        }
      },
    });

  /**
   * A before/after photo. The tag is chosen by the button, the SOURCE by the
   * sheet — which is the same four every other upload surface offers, rather
   * than the photo library this went straight to.
   */
  const [taggedPhotoTag, setTaggedPhotoTag] = useState<'before' | 'after' | null>(
    null,
  );

  if (isLoading || !data) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.backgroundMain,
          paddingLeft: sidebarInset,
        }}
      >
        <ScreenHeader
          title="Project"
          showBackButton={navigation.canGoBack()}
          onBackPress={() => navigation.goBack()}
          showNotificationBell={false}
          showAvatar={false}
        />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </View>
    );
  }

  const {
    project,
    rollups,
    selections,
    budget_lines,
    phases,
    blockers,
    geometry,
    plan_links,
    attachments,
  } = data;

  /**
   * What this member may do, as resolved by whichever backend answered.
   *
   * `my_role` absent is read as `owner` — a hub cached before per-project roles
   * existed, or served by an older Worker, has no such field, and every
   * household member had exactly that access before the feature shipped. The
   * server is still the gate, so a stale `undefined` costs a button that 403s;
   * failing the other way would lock a household out of its own projects on a
   * cache miss.
   */
  const canEdit = (data.my_role ?? 'owner') === 'owner';
  const isDraft =
    normalizeHomeProjectVisibility(project.visibility) === 'draft';

  const refreshAll = () => {
    invalidate();
    void refetch();
    void refetchActivity();
  };

  /**
   * Run a write, refresh on success, present the failure on failure.
   *
   * It SWALLOWS the error on purpose — nearly every caller is a button that
   * stays where it is, and an unhandled rejection from each one would be noise.
   * The two callers that need to know (an optimistic drag that must undo, a
   * sheet that must stay open holding a half-typed edit) read the returned
   * flag; adding it changed nothing for everyone else, who ignore it.
   */
  const withConflict = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      refreshAll();
      return true;
    } catch (e) {
      if (isHomeProjectConflict(e)) {
        conflictAlert(() => void refetch());
      } else {
        // `useMemberFacingAlert` is the one presenter every House screen is
        // meant to use (see its header). It keeps the written title and body a
        // HouseLocalUnsupportedError carries — hardcoding 'Error' threw the
        // title away and showed a deliberate explanation as a failure — and it
        // adds the "Add AI provider" route when a key is what is missing,
        // instead of leaving the member on a dead end with one OK button.
        showError(e, 'Failed');
      }
      return false;
    } finally {
      setBusy(false);
    }
  };

  /**
   * Run a material add, then show the member the row it produced.
   *
   * Every add lands at the top of the list, so "reveal it" is one scroll and
   * not a lookup: no id to find, nothing to measure, and it is correct whether
   * the write came back with one material or — as the shelf-tag reader can —
   * with a row the member never named.
   *
   * Only on success. A failed add has nothing at the top to show, and moving
   * the list under an alert the member is still reading is its own small mess.
   */
  const withMaterialAdded = async (fn: () => Promise<void>) => {
    const added = await withConflict(fn);
    if (added) scrollRef.current?.scrollTo({ y: 0, animated: true });
    return added;
  };

  const addSelection = () =>
    withMaterialAdded(async () => {
      if (!householdId || !newSelection.trim()) return;
      const dollars = Number(selectionPrice);
      const { selection } = await homeProjectsApi.createSelection(
        householdId,
        projectId,
        {
          name: newSelection.trim(),
          unitPriceCents:
            Number.isFinite(dollars) && dollars > 0
              ? Math.round(dollars * 100)
              : undefined,
          productUrl: selectionUrl.trim() || undefined,
        },
      );
      trackEvent('home_project_selection_added', {
        project_id: projectId,
      });
      if (
        rollups.budget_health === 'over' ||
        (dollars > 0 && rollups.target_budget_cents)
      ) {
        // Refresh will update health; fire when already over for analytics.
        if (rollups.budget_health === 'over') {
          trackEvent('home_project_budget_over', { project_id: projectId });
        }
      }
      void selection;
      setNewSelection('');
      setSelectionPrice('');
      setSelectionUrl('');
      // Only on the way OUT of a successful write. A throw leaves the sheet up
      // with what was typed still in it, so the member retries rather than
      // re-enters.
      setMaterialSheet(null);
    });

  /**
   * One image for a material, from wherever the member said.
   *
   * `null` means "nothing to upload" and covers BOTH a refused permission and a
   * cancelled picker, because the caller does the same thing either way: stop,
   * and write nothing. Permission denial alerts here (the member asked for the
   * camera and has to be told why nothing opened); a cancel is silent, because
   * the member already knows.
   */
  /**
   * The photo as raw base64, which is what `from-shelf-tag` takes.
   *
   * No `data:` prefix — the Worker sniffs the real bytes and rejects anything
   * that is not an image, so a prefix would only be a second thing to get
   * wrong. `expo-file-system/legacy` because SDK 54 turned the top-level
   * `readAsStringAsync` into a throw-on-call deprecation.
   */
  const readImageAsBase64 = (uri: string): Promise<string> =>
    FileSystem.readAsStringAsync(uri, { encoding: 'base64' });

  /**
   * The declared type is a hint the Worker overrides by sniffing, so this only
   * has to be close. HEIC is deliberately reported as JPEG: the pickers above
   * already convert to a vision-safe format, and the endpoint's enum has no
   * HEIC member — sending one would be rejected before the sniff ever ran.
   */
  const mimeTypeForUri = (uri: string): 'image/jpeg' | 'image/png' | 'image/webp' => {
    const ext = uri.split('.').pop()?.toLowerCase().split('?')[0];
    if (ext === 'png') return 'image/png';
    if (ext === 'webp') return 'image/webp';
    return 'image/jpeg';
  };

  /**
   * A photographed material: the picture is saved first, the label read second.
   *
   * ## The order is the whole design
   *
   * The member is standing in a shop with a shelf tag in front of them. What has
   * to survive is their photo, attached to a material they can find again — so
   * the row and the attachment are written first, through the path that already
   * works, and the reader runs on top of a material that already exists. Every
   * way the reader can fail (a route the Worker has not shipped yet, a model
   * that could not read a blurry label, a provider key this device does not
   * have) then costs the extra fields and nothing else.
   *
   * This is the bargain `addFromLink` already makes — degrade rather than fail,
   * and SAY so — with the two halves in the opposite order, because a link can
   * be pasted again from the sofa and a shop floor cannot be re-visited.
   *
   * ## It also stops attaching material photos to the PROJECT
   *
   * The old code created a selection only when something had been typed into
   * the manual sheet, and otherwise attached the photo to the project. Since
   * `MATERIAL_ADD_OPTIONS` became the only way in, "otherwise" is EVERY use of
   * these three sources: the member picked "Add from camera" underneath "Add
   * material" and got a project photo and no material.
   */
  const addSelectionPhoto = (
    uri: string,
    source: 'library' | 'file' | 'camera' | 'drive',
  ) =>
    withMaterialAdded(async () => {
      if (!householdId) return;

      /*
        Read the tag BEFORE creating the row, not after.

        The endpoint that shipped (`selections/from-shelf-tag`) creates the
        material out of the extraction, so the row is born with the vendor's
        name and price on it. The earlier order — create a placeholder, attach,
        then patch — leaves a row called "New material" behind whenever the
        model cannot read the label, and that is the common case in a shop:
        glare on the tag holder, an angle, a neighbouring product in frame.

        `read` is null for a local-first household, a Worker without the route,
        or an unreadable label. All three fall through to the plain create
        below, so the member still leaves the aisle with their photo attached.
      */
      const read = await extractMaterialFromShelfTag(
        householdId,
        projectId,
        await readImageAsBase64(uri),
        { mimeType: mimeTypeForUri(uri) },
      );

      const dollars = Number(selectionPrice);
      const { selection } = read
        ? { selection: read.selection }
        : await homeProjectsApi.createSelection(householdId, projectId, {
            name: newSelection.trim() || MATERIAL_PHOTO_PLACEHOLDER_NAME,
            unitPriceCents:
              Number.isFinite(dollars) && dollars > 0
                ? Math.round(dollars * 100)
                : undefined,
            productUrl: selectionUrl.trim() || undefined,
          });

      let attachmentId: string;
      try {
        const attachment = await homeProjectsApi.uploadSelectionPhoto(
          householdId,
          projectId,
          uri,
          selection.id,
        );
        attachmentId = attachment.id;
      } catch (e) {
        // The photo is the entire reason this row exists. A household that
        // cannot move bytes at all — local-first has no H6 upload path — would
        // otherwise be left with an empty "New material" it never asked for, on
        // a list it has to clean up by hand. Put the row back and report the
        // failure as itself.
        await homeProjectsApi
          .deleteSelection(householdId, projectId, selection.id)
          .catch(() => undefined);
        throw e;
      }

      // Only once a row and its photo both exist. A throw above leaves what was
      // typed in the sheet, so the member retries rather than re-enters.
      setNewSelection('');
      setSelectionPrice('');
      setSelectionUrl('');
      void attachmentId;

      trackEvent('home_project_selection_added', {
        project_id: projectId,
        source,
        extraction_source: read?.extraction.source ?? 'manual',
        extraction_confidence: read?.extraction.confidence ?? 'none',
      });

      if (!read) {
        // Not an error: the member has the material and the picture they came
        // for. Said out loud anyway, because a row called "New material" with
        // no price is otherwise indistinguishable from one that failed.
        Alert.alert(
          'Photo saved — the details are yours to fill in',
          'We could not read a label out of that photo, so the material is your picture and a name. Open it to add the price and the store.',
        );
        return;
      }
      if (read.extraction.needsAiProvider) {
        // The photo is stored; nothing looked at it. The one case the member
        // can fix themselves, so it gets the route rather than a shrug — the
        // same offer `addFromLink` makes.
        Alert.alert(
          'Saved your photo — reading the label needs an AI provider',
          'Pulling the name, the price and the size off a shelf tag takes a model looking at the picture, and this device has no provider connected. Connect your own and it fills the rest in.',
          [
            { text: 'Maybe later', style: 'cancel' },
            {
              text: 'Add AI provider',
              onPress: () => router.push(AI_ACCESS_ROUTE),
            },
          ],
        );
      } else if (read.extraction.confidence === 'low') {
        Alert.alert(
          'Added, but check it',
          'That label was hard to read. Check the price and the size before you order.',
        );
      }
    });

  const addFromLink = () =>
    withMaterialAdded(async () => {
      if (!householdId || !linkUrl.trim()) return;
      const { extraction } = await homeProjectsApi.createFromLink(
        householdId,
        projectId,
        linkUrl.trim(),
        undefined,
      );
      trackEvent('home_project_selection_added', {
        project_id: projectId,
        source: 'link',
        extraction_source: extraction.source,
        extraction_confidence: extraction.confidence ?? 'none',
      });
      setLinkUrl('');
      // Same as the manual sheet: the sheet only goes away once a row exists,
      // so a failed read leaves the pasted URL on screen to try again.
      setMaterialSheet(null);
      /*
        The import degrades rather than fails, so the member always has a row —
        and every rung short of the top has to SAY so. It used to check for
        'manual', which the local importer never emits, so every partial result
        was silent: a photo, a name, no price, and nothing explaining why.
      */
      if (extraction.needsAiProvider) {
        // The page was read; nothing looked at it. This is the one case the
        // member can fix themselves, so it gets the route rather than a shrug.
        Alert.alert(
          'Added the basics — the price needs an AI provider',
          'We read the page for the name and the photo. Pulling the price, what one box covers and the specs takes a model reading the page, and this device has no provider connected. Connect your own and it fills the rest in.',
          [
            { text: 'Maybe later', style: 'cancel' },
            {
              text: 'Add AI provider',
              onPress: () => router.push(AI_ACCESS_ROUTE),
            },
          ],
        );
      } else if (
        extraction.source === 'link_url' ||
        extraction.source === 'manual'
      ) {
        Alert.alert(
          'Saved the link',
          'We could not open that page, so the material is just the link — add the price and details by hand.',
        );
      } else if (extraction.confidence === 'low') {
        Alert.alert(
          'Added, but check it',
          'That page was hard to read. Check the price and specs before you order.',
        );
      }
    });

  /**
   * Act on the row the member tapped in the add-material menu.
   *
   * The menu closes FIRST in every branch, including the three that go straight
   * to a picker: the menu is a `Modal`, and leaving it up while the system
   * camera or Files sheet comes over the top stacks two presentations that both
   * want the screen — and leaves the menu still sitting there behind whatever
   * the member picks.
   */
  const openMaterialSource = (source: MaterialAddSource) => {
    setMaterialMenuOpen(false);
    if (source === 'manual' || source === 'link') {
      setMaterialSheet(source);
      return;
    }
    if (source === 'library') materialSources.onGallery();
    else if (source === 'files') materialSources.onFile();
    else if (source === 'camera') materialSources.onCamera();
    else materialSources.onDrive();
  };

  /**
   * Start a shortlist for one surface.
   *
   * One tap: the name and the area both come from the layout, so there is
   * nothing to type and nothing to get wrong. The area goes over in SQUARE
   * METRES because that is what the model stores; the Worker's `areaUnit`
   * carries the unit rather than the value being pre-converted.
   */
  /*
   * Removing a material lives on `MaterialDetailScreen` now, in its header.
   * It was here because the row carried a Remove button; the row does not any
   * more, and a confirm dialog with no caller is the kind of thing that gets
   * re-wired to a new button months later without anyone re-reading what it
   * warns about.
   */

  const addBlocker = () =>
    withConflict(async () => {
      if (!householdId || !newBlocker.trim()) return;
      await homeProjectsApi.createBlocker(householdId, projectId, {
        title: newBlocker.trim(),
        severity: 'medium',
      });
      setNewBlocker('');
    });

  const addPhase = () =>
    withConflict(async () => {
      if (!householdId || !newPhase.trim()) return;
      await homeProjectsApi.createPhase(householdId, projectId, {
        title: newPhase.trim(),
      });
      setNewPhase('');
    });

  /**
   * The row the edit sheet is showing, resolved fresh from the hub every render.
   *
   * `null` closes the sheet, and that is also what happens when the row it was
   * open on is deleted or disappears in a refetch — which is the behaviour you
   * want: an editor over a row that no longer exists can only save into
   * nothing.
   */
  const editingPhase = editingPhaseId
    ? (phases.find(p => p.id === editingPhaseId) ?? null)
    : null;
  const editingBlocker = editingBlockerId
    ? (blockers.find(b => b.id === editingBlockerId) ?? null)
    : null;

  /**
   * Persist a drag, and tell the list whether it landed.
   *
   * `withConflict` reports the failure and swallows it, which is right for a
   * button that stays where it is and wrong for a list that has ALREADY moved:
   * the rows would sit in an order the backend refused. So these two return a
   * boolean and `ReorderableList` puts itself back on `false`.
   */
  const reorderPhases = async (phaseIds: string[]) => {
    if (!householdId) return false;
    let ok = false;
    await withConflict(async () => {
      await homeProjectsApi.reorderPhases(householdId, projectId, phaseIds);
      ok = true;
    });
    return ok;
  };

  const reorderBlockers = async (blockerIds: string[]) => {
    if (!householdId) return false;
    let ok = false;
    await withConflict(async () => {
      await homeProjectsApi.reorderBlockers(householdId, projectId, blockerIds);
      ok = true;
    });
    return ok;
  };

  /**
   * Save an edit, and RETHROW so the sheet knows to stay open.
   *
   * `withConflict` has already told the member what went wrong; what it cannot
   * do is keep the half-typed title on screen, because it does not know a sheet
   * is involved. The throw is caught by the sheet and goes no further.
   */
  const savePhaseEdit = async (patch: {
    title?: string;
    status?: HomeProjectPhaseStatus;
  }) => {
    if (!householdId || !editingPhaseId) return;
    let ok = false;
    await withConflict(async () => {
      await homeProjectsApi.updatePhase(
        householdId,
        projectId,
        editingPhaseId,
        patch,
      );
      ok = true;
    });
    if (!ok) throw new Error('Phase edit was not saved');
  };

  const saveBlockerEdit = async (patch: {
    title?: string;
    severity?: string;
    status?: HomeProjectBlockerStatus;
    notes?: string | null;
  }) => {
    if (!householdId || !editingBlockerId) return;
    let ok = false;
    await withConflict(async () => {
      await homeProjectsApi.updateBlocker(
        householdId,
        projectId,
        editingBlockerId,
        patch,
      );
      ok = true;
    });
    if (!ok) throw new Error('Blocker edit was not saved');
  };

  /**
   * Deleting is confirmed, and the confirm names the row.
   *
   * A phase can be one of seven a Smart Project draft built the whole plan
   * around, and the list it is in has just become draggable — a mis-grab that
   * silently removed a line would be very easy and impossible to undo, since
   * neither backend keeps a tombstone a screen could restore from.
   */
  const confirmDeletePhase = (phase: HomeProjectPhase) => {
    Alert.alert(
      'Delete this phase?',
      `"${phase.title}" will be removed from the timeline. This cannot be undone.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setEditingPhaseId(null);
            void withConflict(async () => {
              if (!householdId) return;
              await homeProjectsApi.deletePhase(
                householdId,
                projectId,
                phase.id,
              );
            });
          },
        },
      ],
    );
  };

  const confirmDeleteBlocker = (blocker: HomeProjectBlocker) => {
    Alert.alert(
      'Delete this blocker?',
      `"${blocker.title}" will be removed. This cannot be undone — mark it resolved instead if you want to keep the answer.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            setEditingBlockerId(null);
            void withConflict(async () => {
              if (!householdId) return;
              await homeProjectsApi.deleteBlocker(
                householdId,
                projectId,
                blocker.id,
              );
            });
          },
        },
      ],
    );
  };

  /**
   * The target is the one budget figure a member OWNS — everything else on this
   * screen is derived from what they have priced. An empty field clears it back
   * to "no target", which is a real state: `budget_health` is always `ok` without
   * one, because there is nothing to be over.
   */
  const saveTargetBudget = () =>
    withConflict(async () => {
      if (!householdId || targetDraft === null) return;
      const trimmed = targetDraft.trim();
      const dollars = Number(trimmed);
      if (trimmed && (!Number.isFinite(dollars) || dollars < 0)) {
        Alert.alert(
          'Enter a number',
          'A target budget is a dollar amount, or blank for none.',
        );
        return;
      }
      await homeProjectsApi.update(householdId, projectId, {
        targetBudgetCents: trimmed ? Math.round(dollars * 100) : null,
      });
      setTargetDraft(null);
    });

  /**
   * The contingency RATE — the second figure a member owns outright.
   *
   * It had no editor at all until now: templates set it, nothing else could, and
   * the tab printed the buffer it produced as though it were a fact about the
   * job. Templates seed 0 now, so this field is how a buffer gets switched on.
   *
   * The 0–50 bound is the Worker's own (`z.number().int().min(0).max(50)`), and
   * it is enforced here rather than left to a 400 because a member typing 200 in
   * a percent field has made a typo, not a request.
   */
  const saveContingency = () =>
    withConflict(async () => {
      if (!householdId || contingencyDraft === null) return;
      const trimmed = contingencyDraft.trim();
      const pct = trimmed ? Number(trimmed) : 0;
      if (
        !Number.isFinite(pct) ||
        pct < 0 ||
        pct > 50 ||
        !Number.isInteger(pct)
      ) {
        Alert.alert(
          'Enter a percentage',
          'A contingency is a whole number from 0 to 50 — or blank for none.',
        );
        return;
      }
      await homeProjectsApi.update(householdId, projectId, {
        contingencyPct: pct,
      });
      setContingencyDraft(null);
    });

  /** Open one budget line for editing, seeded from what is stored. */
  const startEditingLine = (line: HomeProjectBudgetLine) => {
    setEditingLineId(line.id);
    setLineLabelDraft(line.label);
    setLineEstimateDraft(
      line.estimate_cents ? String(line.estimate_cents / 100) : '',
    );
    setLineActualDraft(
      line.actual_cents ? String(line.actual_cents / 100) : '',
    );
  };

  const cancelEditingLine = () => {
    setEditingLineId(null);
    setLineLabelDraft('');
    setLineEstimateDraft('');
    setLineActualDraft('');
  };

  /**
   * `version` rides along, so two members pricing the same job offline get a
   * conflict alert rather than one of them silently winning. Money is the field
   * where last-write-wins is most expensive and least visible.
   */
  const saveBudgetLine = (line: HomeProjectBudgetLine) =>
    withConflict(async () => {
      if (!householdId) return;
      const estimateCents = parseMoneyToCents(lineEstimateDraft);
      const actualCents = parseMoneyToCents(lineActualDraft);
      if (estimateCents === null || actualCents === null) {
        Alert.alert(
          'Enter a number',
          'Estimate and spent are dollar amounts, or blank for none.',
        );
        return;
      }
      const label = lineLabelDraft.trim();
      if (!label) {
        Alert.alert(
          'Name this line',
          'A budget line needs a name — “Tiler”, “Permit”, “Vanity”.',
        );
        return;
      }
      await homeProjectsApi.updateBudgetLine(householdId, projectId, line.id, {
        label,
        estimateCents,
        actualCents,
        version: line.version,
      });
      cancelEditingLine();
    });

  /**
   * Deleting confirms, because a line derived from a material takes its price out
   * of the project without touching the material — so the row disappears from
   * here and the vanity it was priced from stays on the Materials tab, looking
   * exactly as it did.
   */
  const removeBudgetLine = (line: HomeProjectBudgetLine) => {
    Alert.alert(
      'Remove this line?',
      `"${line.label}" comes out of the budget. The material it was priced from, if any, stays.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () =>
            void withConflict(async () => {
              if (!householdId) return;
              await homeProjectsApi.deleteBudgetLine(
                householdId,
                projectId,
                line.id,
              );
              if (editingLineId === line.id) cancelEditingLine();
            }),
        },
      ],
    );
  };

  const addBudgetLine = () =>
    withConflict(async () => {
      if (!householdId) return;
      const label = newLineLabel.trim();
      if (!label) {
        Alert.alert(
          'Name this line',
          'A budget line needs a name — “Tiler”, “Permit”, “Vanity”.',
        );
        return;
      }
      const estimateCents = parseMoneyToCents(newLineEstimate);
      if (estimateCents === null) {
        Alert.alert(
          'Enter a number',
          'An estimate is a dollar amount, or blank to fill in later.',
        );
        return;
      }
      await homeProjectsApi.createBudgetLine(householdId, projectId, {
        category: newLineCategory,
        label,
        estimateCents,
      });
      setNewLineLabel('');
      setNewLineEstimate('');
      setAddingLine(false);
    });

  const linkFloorPlan = (floorPlanId: string) =>
    withConflict(async () => {
      if (!householdId) return;
      await homeProjectsApi.createPlanLink(householdId, projectId, {
        floorPlanId,
        zonePayload: zoneNote.trim()
          ? { note: zoneNote.trim(), kind: 'zone' }
          : { kind: 'full_plan' },
      });
      setZoneNote('');
      Alert.alert('Linked', 'Floor plan zone attached to this project');
    });

  const postComment = () =>
    withConflict(async () => {
      if (!householdId || !comment.trim()) return;
      await homeProjectsApi.addComment(householdId, projectId, {
        body: comment.trim(),
      });
      setComment('');
    });

  const archiveProject = () => {
    Alert.alert('Archive project?', 'It will hide from the default list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Archive',
        style: 'destructive',
        onPress: () =>
          void withConflict(async () => {
            if (!householdId) return;
            await homeProjectsApi.archive(householdId, projectId);
            navigation.navigate('HomeProjectsList');
          }),
      },
    ]);
  };

  const unarchiveProject = () =>
    withConflict(async () => {
      if (!householdId) return;
      await homeProjectsApi.update(householdId, projectId, {
        status: 'planning',
      });
    });

  /**
   * Delete asks TWICE, and the second prompt names what goes with it.
   *
   * Archive is one tap away in the same menu and is the reversible answer to
   * almost every reason a member reaches for delete. This one takes the budget,
   * the materials, the photos and the whole activity feed with it on both
   * backends, and on a local-first household it does so on every peer's device —
   * so the confirmation says so rather than asking "are you sure?".
   */
  const deleteProject = () => {
    Alert.alert(
      'Delete this project?',
      `"${project.title}" and everything in it — budget, materials, photos, timeline and activity — will be gone for everyone in the household. This cannot be undone.\n\nArchiving hides it instead and keeps all of it.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Archive instead', onPress: archiveProject },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () =>
            void withConflict(async () => {
              if (!householdId) return;
              await homeProjectsApi.remove(householdId, projectId);
              /*
                Take the project's conversations with it — its general chat and
                every material chat under it. There is no FK to cascade from
                (chat is server-side, the project may only ever have existed
                on-device — see migration 0167), so the cleanup is an explicit
                call from the delete path.

                Best-effort, and after the delete rather than before: the project
                is already gone, and failing here should leave a stale room in
                the chat list, not block a delete the member has confirmed.
              */
              void houseChatConfig.api
                .deleteSubjectRooms(householdId, CHAT_SUBJECT_PROJECT, projectId)
                .catch(err =>
                  console.warn('[HomeProjects] chat cleanup failed', err),
                );
              trackEvent('home_project_deleted', { project_id: projectId });
              navigation.navigate('HomeProjectsList');
            }),
        },
      ],
    );
  };

  const setVisibility = (next: 'draft' | 'published') =>
    withConflict(async () => {
      if (!householdId) return;
      await homeProjectsApi.update(householdId, projectId, {
        visibility: next,
      });
      trackEvent(
        next === 'published'
          ? 'home_project_published'
          : 'home_project_unpublished',
        { project_id: projectId },
      );
    });

  /**
   * Pulling a shared project back to a draft hides it from members who may have
   * been working in it, so it warns; publishing does not, because sharing is the
   * direction that surprises nobody.
   */
  const confirmUnpublish = () => {
    Alert.alert(
      'Move back to a draft?',
      'Only you will see this project. Other household members lose access to it — including anything they added — until you publish it again.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Make it a draft', onPress: () => void setVisibility('draft') },
      ],
    );
  };

  const runAiSchematic = () =>
    withConflict(async () => {
      if (!householdId) return;
      await homeProjectsApi.enqueueAiSchematic(householdId, projectId);
      trackEvent('home_project_ai_schematic_started', {
        project_id: projectId,
      });
      Alert.alert(
        'Generating',
        'Approximate schematic queued. Pull to refresh when ready.',
      );
    });

  const cancelSchematic = () =>
    withConflict(async () => {
      if (!householdId || !geometry?.id) return;
      await homeProjectsApi.cancelGeometry(householdId, projectId, geometry.id);
    });

  const exportShare = () =>
    withConflict(async () => {
      if (!householdId) return;
      const { shareText, pdfUrl } = await homeProjectsApi.exportSummary(
        householdId,
        projectId,
      );
      if (pdfUrl && (await Sharing.isAvailableAsync())) {
        try {
          const pdfPath = await homeProjectsApi.downloadExportPdf(
            projectId,
            pdfUrl,
          );
          await Sharing.shareAsync(pdfPath, {
            mimeType: 'application/pdf',
            dialogTitle: project.title,
          });
          return;
        } catch {
          // fall through to text share
        }
      }
      const path = `${FileSystem.cacheDirectory}home-project-${projectId}.txt`;
      await FileSystem.writeAsStringAsync(path, shareText);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, {
          mimeType: 'text/plain',
          dialogTitle: project.title,
        });
      } else {
        Alert.alert('Export ready', shareText.slice(0, 500));
      }
    });

  /**
   * Clear the whole materials list, after a confirm that says how many.
   *
   * The counterpart to deleting one from its detail screen, and it exists
   * because of how a Smart Project draft arrives: with a list the member did
   * not write. "I already own all of this" is a judgement about the list rather
   * than about any row in it, and answering it one card at a time is twenty
   * taps through twenty screens.
   *
   * Sequential rather than `Promise.all`. Each delete is one ledger op on a
   * local-first household, and firing thirty at once has them race for the same
   * write lock; in order, a failure part-way through also leaves a coherent
   * list (the ones after it) rather than an arbitrary half. `withConflict`
   * refreshes once at the end, so the list does not flicker per row.
   *
   * No undo, so the confirm carries the weight — hence the count and the
   * destructive style rather than a bare "Are you sure?".
   */
  const deleteAllMaterials = () => {
    const count = selections.length;
    if (!count) return;
    Alert.alert(
      `Delete all ${count} material${count === 1 ? '' : 's'}?`,
      'This removes every material on this project, including any you added yourself. It cannot be undone.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: 'Delete all',
          style: 'destructive',
          onPress: () =>
            void withConflict(async () => {
              if (!householdId) return;
              for (const sel of selections) {
                await homeProjectsApi.deleteSelection(
                  householdId,
                  projectId,
                  sel.id,
                );
              }
            }),
        },
      ],
    );
  };

  const createProjectTask = () =>
    withConflict(async () => {
      if (!householdId || !newTaskTitle.trim()) return;
      await homeProjectsApi.createTask(householdId, projectId, {
        title: newTaskTitle.trim(),
      });
      setNewTaskTitle('');
      const res = await homeProjectsApi.listTasks(householdId, projectId);
      setLinkedTasks(res.tasks || []);
    });

  const addTaggedPhoto = (tag: 'before' | 'after', uri: string) =>
    withConflict(async () => {
      if (!householdId) return;
      await homeProjectsApi.uploadSelectionPhoto(
        householdId,
        projectId,
        uri,
        undefined,
        [tag],
      );
    });

  const scanRoom = () =>
    withConflict(async () => {
      if (!householdId) return;
      if (!roomPlan.isSupported()) {
        Alert.alert(
          'Scan unavailable',
          'RoomPlan needs a LiDAR iPhone/iPad. Use manual dimensions.',
        );
        return;
      }
      try {
        const payload = await roomPlan.scanRoom();
        await homeProjectsApi.putRoomPlanGeometry(
          householdId,
          projectId,
          payload,
        );
        trackEvent('home_project_scan_completed', { project_id: projectId });
      } catch (e) {
        Alert.alert(
          'Scan not ready',
          e instanceof Error
            ? e.message
            : 'Use manual room dimensions for now.',
        );
      }
    });

  /**
   * The header overflow menu.
   *
   * Presented through the platform's own menu rather than a custom popover, the
   * way `WishDetailScreen` already does it, and split for the same reason: iOS
   * `ActionSheetIOS` takes any number of options while Android's `Alert` has
   * only three button slots — a six-item menu rendered through `Alert` on
   * Android silently drops half of it, and the half that goes is the half at the
   * bottom, which here is Delete.
   *
   * Every item is owner-only, which is why the whole button is hidden for a
   * viewer rather than shown with disabled rows: a viewer has nothing in here to
   * do, and a menu of greyed-out actions reads as a bug.
   */
  const openProjectMenu = () => {
    const actions = buildProjectMenuActions(
      { isDraft, isArchived: project.status === 'archived' },
      {
        manageAccess: () => setAccessOpen(true),
        publish: () => void setVisibility('published'),
        unpublish: confirmUnpublish,
        archive: archiveProject,
        unarchive: () => void unarchiveProject(),
        remove: deleteProject,
      },
    );

    const options = [...actions.map(a => a.label), 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const destructiveButtonIndex = actions.findIndex(a => a.destructive);

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: project.title,
          options,
          cancelButtonIndex,
          ...(destructiveButtonIndex >= 0 ? { destructiveButtonIndex } : {}),
        },
        index => {
          if (index >= 0 && index < actions.length) actions[index].run();
        },
      );
    } else {
      Alert.alert(project.title, undefined, [
        ...actions.map(a => ({
          text: a.label,
          onPress: a.run,
          style: a.destructive ? ('destructive' as const) : undefined,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    }
  };

  const sections: Section[] = [
    'overview',
    'plans',
    'materials',
    'budget',
    'timeline',
    'tasks',
    'photos',
    'blockers',
    'activity',
  ];

  const parseTags = (raw: string | null | undefined): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  };

  const projectPhotos = attachments.filter(
    a => a.kind === 'photo' && a.status === 'ready',
  );
  const filteredPhotos = projectPhotos.filter(a => {
    if (photoFilter === 'all') return true;
    return parseTags(a.tags).includes(photoFilter);
  });

  const photoCount = attachments.filter(
    a => a.kind === 'photo' && a.status === 'ready',
  ).length;

  /*
    The title alone made every project hub look identical — the same header over
    a bathroom, a deck and a kitchen. The list card already recognises a project
    by its cover at a glance; this carries that recognition into the screen the
    card opens. The two backends address the bytes differently and NEITHER can
    render the other's, the same split the photo rows below handle.
  */
  const headerCover = pickProjectCoverAttachment(
    project.cover_attachment_id,
    attachments,
  );
  const headerCoverImage = headerCover?.blob ? (
    <HouseBlobImage
      descriptor={headerCover.blob}
      householdId={householdId}
      width={HEADER_COVER_SIZE}
      height={HEADER_COVER_SIZE}
      style={styles.headerCover}
      accessibilityLabel={`Cover photo for ${project.title}`}
      testID="home-project-header-cover-blob"
    />
  ) : headerCover?.url ? (
    <Image
      source={{ uri: headerCover.url }}
      style={styles.headerCover}
      accessibilityLabel={`Cover photo for ${project.title}`}
      testID="home-project-header-cover-remote"
    />
  ) : null;

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.backgroundMain,
        paddingLeft: sidebarInset,
      }}
    >
      <ScreenHeader
        title={project.title}
        /*
          Replaces the centered title text rather than sitting in the leading
          column, so the thumbnail travels WITH the name instead of parking
          itself beside the back button. Falls back to the plain `title` above
          whenever there is no photo to show.
        */
        titleElement={
          headerCoverImage ? (
            <View
              style={styles.headerTitleRow}
              testID="home-project-header-cover"
            >
              {headerCoverImage}
              <Typography
                variant="headline"
                weight="semibold"
                numberOfLines={1}
                style={styles.headerTitleText}
              >
                {project.title}
              </Typography>
            </View>
          ) : undefined
        }
        showBackButton={navigation.canGoBack()}
        onBackPress={() => navigation.goBack()}
        showNotificationBell={false}
        showAvatar={false}
        /*
          Archive used to be a bare text link in the body, beside the status
          line — the one destructive-ish action on the screen, sitting in the
          content where a member scrolls past it. It lives here now with the
          rest of the project-level actions, which is where a member looks for
          them. Hidden entirely for a viewer: every item behind it is owner-only.
        */
        rightElement={
          <View style={styles.headerActions}>
            {/*
              Chat sits in the header rather than as a tenth section pill: a
              conversation owns a keyboard and a scroll view, and nesting one in
              a hub that already scrolls nine sections is the fight Surface
              Studio was given its own screen to avoid. Here it is reachable
              from every section, and its badge says where the talking is.
              Visible to viewers too — reading a project you cannot edit is
              exactly when you want to ask about it.
            */}
            <SubjectChatButton
              config={houseChatConfig}
              target={chatTarget}
              testID="home-project-chat"
              accessibilityLabel="Project chat"
              onOpened={room =>
                navigation.navigate('ChatRoom', {
                  roomId: room.id,
                  roomName: room.name,
                  aiEnabled: room.ai_enabled,
                })
              }
            />
            {canEdit ? (
              <TouchableOpacity
                onPress={openProjectMenu}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Project actions"
                testID="home-project-menu"
              >
                <Icon
                  name="ellipsis-horizontal"
                  size={IconSize.lg}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />
      <ScrollView
        {...keyboardDismissScrollProps}
        ref={scrollRef}
        style={{ flex: 1 }}
        /*
        The
        Materials
        tab
        buys
        extra
        floor.
        The
        floating
        button
        is
        absolutely
        positioned
        over
        the
        scroller,
        so
        on
        the
        default
        48pt
        tail
        it
        sits
        on
        top
        of
        the
        last
        material
        card
        and
        the
        member
        cannot
        reach
        the
        card's
          own controls — the same reason `HouseholdManagementScreen` pads for
          its FAB. Only that tab pays for it; the others have no button to clear.
        */
        contentContainerStyle={[
          styles.content,
          // Every tab clears the tab bar; Materials additionally clears its FAB.
          { paddingBottom: 48 + TAB_BAR_CONTENT_HEIGHT + insets.bottom },
          section === 'materials' && styles.contentWithFab,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => {
              void refetch();
              void refetchActivity();
            }}
          />
        }
      >
        {/* Smart Project review frame. Renders nothing at all unless this
          project came from a description, so a template project is untouched.
          It sits above the meta line because "nobody else can see this yet" and
          "here is what we skipped" are the first things a member needs when
          they open a draft a model wrote. */}
        {isDraft && (
          <SmartDraftReviewBanner
            householdId={householdId}
            projectId={projectId}
            canEdit={canEdit}
            onPublished={refreshAll}
          />
        )}

        {/* The status meta line. Archive moved into the header's
        "…"
        menu
        with
        the
        rest
        of
        the
        project-level
        actions;
        what
        stays
        here
        are
        the
        two
        badges
        that
        say
        something
        a
        member
        cannot
        otherwise
        see
        —
        that
        this
        project
        is
        private
        to
        them,
        and
        that
        they
        cannot
        change
        it.
        */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text
              style={[styles.meta,
        { color: colors.textSecondary }]}
              testID="home-project-hub-title"
            >
              {project.status.replace('_',
        ' ')} · {project.type}
              {photoCount
      > 0
                ? ` · ${photoCount} photo${photoCount === 1 ? '' : 's'}`
                : ''}
            </Text>
          </View>
          {isDraft ? (
            <View
              style={[styles.badge, { backgroundColor: colors.cardSubtle }]}
              testID="home-project-draft-badge"
            >
              <Icon
                name="lock-closed-outline"
                size={12}
                color={colors.textSecondary}
              />
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                Draft
              </Text>
            </View>
          ) : null}
          {!canEdit ? (
            <View
              style={[styles.badge, { backgroundColor: colors.cardSubtle }]}
              testID="home-project-viewonly-badge"
            >
              <Icon name="eye-outline" size={12} color={colors.textSecondary} />
              <Text style={[styles.badgeText, { color: colors.textSecondary }]}>
                View only
              </Text>
            </View>
          ) : null}
        </View>
        {isDraft ? (
          <Text style={[styles.draftNote, { color: colors.textTertiary }]}>
            Only you can see this project. Publish it from the ⋯ menu when you
            are ready to share it with the household.
          </Text>
        ) : null}
        <BudgetBar rollups={rollups} currency={project.currency} />

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.tabs}
        >
          {sections.map(s => (
            <Pressable
              key={s}
              onPress={() => setSection(s)}
              style={[
                styles.tab,
                {
                  backgroundColor: section === s ? colors.primary : colors.card,
                  borderColor: colors.borderColor,
                },
              ]}
              testID={`hub-tab-${s}`}
            >
              <Text
                style={{
                  color: section === s ? '#fff' : colors.textPrimary,
                  fontWeight: '600',
                }}
              >
                {SECTION_LABELS[s]}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {section === 'overview' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Next steps
            </Text>
            <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>
              Add materials with price, link, and photo; attach a floor-plan
              zone; set room dimensions; clear blockers. Everything works with
              AI off.
            </Text>
            {project.summary ? (
              <Text style={{ color: colors.textPrimary, marginTop: 12 }}>
                {project.summary}
              </Text>
            ) : null}
          </View>
        )}

        {section === 'materials' && (
          <View style={styles.block}>
            <View style={styles.sectionHeaderRow}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.textPrimary, flex: 1, marginBottom: 0 },
                ]}
              >
                Materials
              </Text>
              {/*
                "Delete all", beside the list rather than inside the "…" menu.

                A drafted project arrives with a list somebody else wrote, and
                the member's first judgement is often about the WHOLE list — "I
                already have all of this" — which one-by-one deletion answers
                twenty taps at a time. Each card still deletes on its own from
                its detail screen; this is the other half of that pair, not a
                replacement for it.

                Shown only when there is something to delete and only to an
                owner, and it names the count in the confirm because "Delete
                all" on a mature project can mean forty rows the member added by
                hand over a month.
              */}
              {canEdit && selections.length > 0 && (
                <Pressable
                  onPress={deleteAllMaterials}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Delete all ${selections.length} materials`}
                  hitSlop={8}
                  testID="materials-delete-all"
                >
                  <Text style={{ color: colors.error, fontWeight: '600' }}>
                    Delete all
                  </Text>
                </Pressable>
              )}
            </View>
            {selections.length === 0 ? (
              <Text
                style={[styles.help, { color: colors.textSecondary }]}
                testID="materials-empty"
              >
                No materials added yet.
              </Text>
            ) : (
              selections.map(sel => (
                <MaterialCard
                  key={sel.id}
                  selection={sel}
                  currency={project.currency}
                  householdId={householdId}
                  attachment={attachments.find(
                    a =>
                      a.selection_id === sel.id &&
                      a.status === 'ready' &&
                      !!(a.url || a.blob),
                  )}
                  onOpen={() =>
                    navigation.navigate('MaterialDetail', {
                      projectId,
                      selectionId: sel.id,
                    })
                  }
                />
              ))
            )}
            {/*
              Nothing else lives here any more. The four fields, three buttons
              and Cancel that used to sit under this list are gone: adding a
              material is now the floating button below and the sheets it opens,
              so this tab is the list and nothing else.
            */}
          </View>
        )}

        {section === 'budget' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Target budget
            </Text>
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              What you want to spend. Everything below is what the project costs
              so far, from the materials and labour you have priced.
            </Text>
            <View style={styles.targetRow}>
              <TextInput
                value={
                  targetDraft ??
                  (project.target_budget_cents != null
                    ? String(project.target_budget_cents / 100)
                    : '')
                }
                // Raw RN input: the keypad is a suggestion, not a constraint —
                // a paste or a Bluetooth keyboard still reaches this figure.
                onChangeText={numericTextHandler(setTargetDraft)}
                keyboardType="decimal-pad"
                placeholder="No target set"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                    flex: 1,
                    marginTop: 0,
                  },
                ]}
                testID="home-project-target-budget"
              />
              <Pressable
                style={[
                  styles.btn,
                  {
                    backgroundColor:
                      targetDraft === null ? colors.card : colors.primary,
                    borderColor: colors.borderColor,
                    borderWidth: targetDraft === null ? 1 : 0,
                    marginTop: 0,
                    paddingHorizontal: 20,
                  },
                ]}
                onPress={() => void saveTargetBudget()}
                disabled={busy || targetDraft === null}
                testID="home-project-target-budget-save"
              >
                <Text
                  style={
                    targetDraft === null
                      ? { color: colors.textSecondary, fontWeight: '600' }
                      : styles.btnText
                  }
                >
                  Save
                </Text>
              </Pressable>
            </View>

            {/*
            Contingency, with the "what IS this" answer attached to it.
            The field exists at all because templates no longer set a rate: the
            buffer is the member's decision, and a figure nobody can change and
            nobody explained is indistinguishable from an invented one.
          */}
            <View style={styles.labelRow}>
              <Text
                style={[
                  styles.sectionTitle,
                  { color: colors.textPrimary, marginBottom: 0 },
                ]}
              >
                Contingency
              </Text>
              <Pressable
                onPress={() =>
                  Alert.alert('What a contingency is', CONTINGENCY_EXPLAINER)
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="What a contingency is"
                testID="home-project-contingency-info"
              >
                <Icon
                  name="information-circle-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </Pressable>
            </View>
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Money set aside for surprises, as a percentage of what you have
              priced. 0% means this project costs exactly what you enter.
            </Text>
            <View style={styles.targetRow}>
              <TextInput
                value={contingencyDraft ?? String(project.contingency_pct)}
                onChangeText={numericTextHandler(setContingencyDraft)}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={colors.textSecondary}
                style={[
                  styles.input,
                  {
                    color: colors.textPrimary,
                    borderColor: colors.borderColor,
                    flex: 1,
                    marginTop: 0,
                  },
                ]}
                testID="home-project-contingency-pct"
              />
              <Pressable
                style={[
                  styles.btn,
                  {
                    backgroundColor:
                      contingencyDraft === null ? colors.card : colors.primary,
                    borderColor: colors.borderColor,
                    borderWidth: contingencyDraft === null ? 1 : 0,
                    marginTop: 0,
                    paddingHorizontal: 20,
                  },
                ]}
                onPress={() => void saveContingency()}
                disabled={busy || contingencyDraft === null}
                testID="home-project-contingency-save"
              >
                <Text
                  style={
                    contingencyDraft === null
                      ? { color: colors.textSecondary, fontWeight: '600' }
                      : styles.btnText
                  }
                >
                  Save
                </Text>
              </Pressable>
            </View>

            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textPrimary, marginTop: 20 },
              ]}
            >
              Current budget
            </Text>
            {budgetByCategory.length === 0 ? (
              <Text style={{ color: colors.textSecondary, marginBottom: 8 }}>
                Nothing priced yet. Add a price to a material, or add a line
                below.
              </Text>
            ) : (
              budgetByCategory.map(([category, cents]) => (
                <View
                  key={category}
                  style={[styles.moneyRow, { borderColor: colors.borderColor }]}
                >
                  <Text
                    style={{ color: colors.textPrimary, fontWeight: '500' }}
                  >
                    {BUDGET_CATEGORY_LABELS[category] ?? category}
                  </Text>
                  <Text style={{ color: colors.textSecondary }}>
                    {formatMoney(cents, { code: project.currency })}
                  </Text>
                </View>
              ))
            )}
            {/* Shown only when there IS one — at 0% this row said "$0" forever. */}
            {rollups.contingency_cents > 0 && (
              <View
                style={[styles.moneyRow, { borderColor: colors.borderColor }]}
              >
                <Text style={{ color: colors.textSecondary }}>
                  Contingency ({project.contingency_pct}%)
                </Text>
                <Text style={{ color: colors.textSecondary }}>
                  {formatMoney(rollups.contingency_cents, {
                    code: project.currency,
                  })}
                </Text>
              </View>
            )}
            <View
              style={[styles.moneyRow, { borderColor: colors.borderColor }]}
            >
              {/*
              "Total", not "Estimate". Every figure it sums is one the member
              typed or priced, so calling it an estimate framed their own
              arithmetic as the app's guess about what the job will cost.
            */}
              <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>
                Total
              </Text>
              <Text style={{ color: colors.textPrimary, fontWeight: '700' }}>
                {formatMoney(rollups.estimate_total, {
                  code: project.currency,
                })}
              </Text>
            </View>
            <View
              style={[styles.moneyRow, { borderColor: colors.borderColor }]}
            >
              <Text style={{ color: colors.textSecondary }}>Spent so far</Text>
              <Text style={{ color: colors.textSecondary }}>
                {formatMoney(rollups.actual_total, { code: project.currency })}
              </Text>
            </View>

            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textPrimary, marginTop: 20 },
              ]}
            >
              Budget lines
            </Text>
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Your own figures — a quote from a trade, a permit fee, a price you
              have been given. Tap a line to change it.
            </Text>
            {budget_lines.length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>
                No lines yet — add one below, or price a material.
              </Text>
            ) : (
              budget_lines.map(line =>
                editingLineId === line.id ? (
                  <View
                    key={line.id}
                    style={[
                      styles.lineEditor,
                      { borderColor: colors.borderColor },
                    ]}
                    testID={`budget-line-editor-${line.id}`}
                  >
                    <TextInput
                      value={lineLabelDraft}
                      onChangeText={setLineLabelDraft}
                      placeholder="What this is for"
                      placeholderTextColor={colors.textSecondary}
                      style={[
                        styles.input,
                        {
                          color: colors.textPrimary,
                          borderColor: colors.borderColor,
                          marginTop: 0,
                        },
                      ]}
                      testID={`budget-line-label-${line.id}`}
                    />
                    <View style={styles.targetRow}>
                      <View style={styles.field}>
                        <Text
                          style={[
                            styles.fieldLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Estimate
                        </Text>
                        <TextInput
                          value={lineEstimateDraft}
                          onChangeText={numericTextHandler(
                            setLineEstimateDraft,
                          )}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={colors.textSecondary}
                          style={[
                            styles.input,
                            {
                              color: colors.textPrimary,
                              borderColor: colors.borderColor,
                              marginTop: 0,
                            },
                          ]}
                          testID={`budget-line-estimate-${line.id}`}
                        />
                      </View>
                      <View style={styles.field}>
                        <Text
                          style={[
                            styles.fieldLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          Spent
                        </Text>
                        <TextInput
                          value={lineActualDraft}
                          onChangeText={numericTextHandler(setLineActualDraft)}
                          keyboardType="decimal-pad"
                          placeholder="0"
                          placeholderTextColor={colors.textSecondary}
                          style={[
                            styles.input,
                            {
                              color: colors.textPrimary,
                              borderColor: colors.borderColor,
                              marginTop: 0,
                            },
                          ]}
                          testID={`budget-line-actual-${line.id}`}
                        />
                      </View>
                    </View>
                    <View style={styles.targetRow}>
                      <Pressable
                        style={[
                          styles.btn,
                          {
                            backgroundColor: colors.primary,
                            flex: 1,
                            marginTop: 10,
                          },
                        ]}
                        onPress={() => void saveBudgetLine(line)}
                        disabled={busy}
                        testID={`budget-line-save-${line.id}`}
                      >
                        <Text style={styles.btnText}>Save</Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.btn,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.borderColor,
                            borderWidth: 1,
                            flex: 1,
                            marginTop: 10,
                          },
                        ]}
                        onPress={cancelEditingLine}
                        disabled={busy}
                      >
                        <Text
                          style={{
                            color: colors.textPrimary,
                            fontWeight: '600',
                          }}
                        >
                          Cancel
                        </Text>
                      </Pressable>
                    </View>
                    <Pressable
                      onPress={() => removeBudgetLine(line)}
                      disabled={busy}
                      hitSlop={8}
                      testID={`budget-line-remove-${line.id}`}
                    >
                      <Text
                        style={[styles.removeLink, { color: colors.error }]}
                      >
                        Remove this line
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    key={line.id}
                    onPress={() => startEditingLine(line)}
                    disabled={busy}
                    style={[styles.line, { borderColor: colors.borderColor }]}
                    testID={`budget-line-${line.id}`}
                  >
                    <Text
                      style={{ color: colors.textPrimary, fontWeight: '500' }}
                    >
                      {line.label}
                    </Text>
                    <Text style={{ color: colors.textSecondary }}>
                      est{' '}
                      {formatMoney(line.estimate_cents, {
                        code: project.currency,
                      })}{' '}
                      · act{' '}
                      {formatMoney(line.actual_cents, {
                        code: project.currency,
                      })}
                    </Text>
                  </Pressable>
                ),
              )
            )}

            {addingLine ? (
              <View
                style={[styles.lineEditor, { borderColor: colors.borderColor }]}
              >
                <View style={styles.groupPicker}>
                  {BUDGET_LINE_CATEGORIES.map(category => (
                    <Pressable
                      key={category}
                      onPress={() => setNewLineCategory(category)}
                      style={[
                        styles.tab,
                        {
                          backgroundColor:
                            newLineCategory === category
                              ? colors.primary
                              : colors.card,
                          borderColor: colors.borderColor,
                          marginRight: 0,
                        },
                      ]}
                      testID={`budget-line-category-${category}`}
                    >
                      <Text
                        style={{
                          color:
                            newLineCategory === category
                              ? '#fff'
                              : colors.textPrimary,
                          fontWeight: '600',
                        }}
                      >
                        {BUDGET_CATEGORY_LABELS[category]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={newLineLabel}
                  onChangeText={setNewLineLabel}
                  placeholder="What this is for — “Tiler”, “Building permit”"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  testID="budget-line-new-label"
                />
                <TextInput
                  value={newLineEstimate}
                  onChangeText={numericTextHandler(setNewLineEstimate)}
                  keyboardType="decimal-pad"
                  placeholder="Estimate — leave blank to fill in later"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  testID="budget-line-new-estimate"
                />
                <View style={styles.targetRow}>
                  <Pressable
                    style={[
                      styles.btn,
                      { backgroundColor: colors.primary, flex: 1 },
                    ]}
                    onPress={() => void addBudgetLine()}
                    disabled={busy}
                    testID="budget-line-new-save"
                  >
                    <Text style={styles.btnText}>Add line</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.btn,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.borderColor,
                        borderWidth: 1,
                        flex: 1,
                      },
                    ]}
                    onPress={() => setAddingLine(false)}
                    disabled={busy}
                  >
                    <Text
                      style={{ color: colors.textPrimary, fontWeight: '600' }}
                    >
                      Cancel
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <Pressable
                style={[
                  styles.btn,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.borderColor,
                    borderWidth: 1,
                  },
                ]}
                onPress={() => setAddingLine(true)}
                disabled={busy}
                testID="budget-line-add"
              >
                <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                  Add a budget line
                </Text>
              </Pressable>
            )}

            <BudgetVisuals
              rollups={rollups}
              budgetLines={budget_lines}
              currency={project.currency}
            />
          </View>
        )}

        {section === 'timeline' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Phases
            </Text>
            {/* Said once, above the list, rather than left to be discovered.
                A grip is a small target and tap-to-edit is invisible; a member
                who has just been handed a seven-phase AI draft is exactly the
                one who needs to know both are there. Hidden when there is
                nothing to reorder or nobody who may. */}
            {canEdit && phases.length > 1 ? (
              <Text
                style={[styles.reorderHint, { color: colors.textSecondary }]}
              >
                Tap a phase to edit it, or drag the grip to reorder.
              </Text>
            ) : null}
            <Timeline
              phases={phases}
              canEdit={canEdit}
              onEditPhase={phase => setEditingPhaseId(phase.id)}
              onReorder={reorderPhases}
            />
            <TextInput
              value={newPhase}
              onChangeText={setNewPhase}
              placeholder="Add phase"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { color: colors.textPrimary, borderColor: colors.borderColor },
              ]}
            />
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => void addPhase()}
              disabled={busy}
            >
              <Text style={styles.btnText}>Add phase</Text>
            </Pressable>
          </View>
        )}

        {section === 'tasks' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Tasks
            </Text>
            {linkedTasks.length === 0 ? (
              <Text style={{ color: colors.textSecondary, marginBottom: 8 }}>
                No linked tasks yet.
              </Text>
            ) : (
              linkedTasks.map(t => (
                <View
                  key={t.task_id}
                  style={[styles.line, { borderColor: colors.borderColor }]}
                >
                  <Text
                    style={{ color: colors.textPrimary, fontWeight: '500' }}
                  >
                    {t.title || 'Task'}
                  </Text>
                  {t.next_due_date ? (
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                      Due {t.next_due_date}
                    </Text>
                  ) : null}
                </View>
              ))
            )}
            <TextInput
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
              placeholder="Create task from this project"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { color: colors.textPrimary, borderColor: colors.borderColor },
              ]}
              testID="home-project-task-input"
            />
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => void createProjectTask()}
              disabled={busy}
              testID="home-project-create-task"
            >
              <Text style={styles.btnText}>Add task</Text>
            </Pressable>
          </View>
        )}

        {section === 'photos' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Before / after
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
              {(['all', 'before', 'after'] as const).map(f => (
                <Pressable
                  key={f}
                  onPress={() => {
                    // Closing first: the viewer indexes into the filtered list,
                    // and re-filtering under an open viewer would leave that
                    // index pointing at a different photo (or off the end).
                    setViewerIndex(null);
                    setPhotoFilter(f);
                  }}
                  // The chip's own label is the bare word "before"/"after", which
                  // also appears on the add buttons and on every row's tag line —
                  // so text is not a safe handle for a test or for VoiceOver.
                  accessibilityLabel={`Show ${f} photos`}
                  testID={`home-project-photo-filter-${f}`}
                  style={[
                    styles.tab,
                    {
                      backgroundColor:
                        photoFilter === f ? colors.primary : colors.card,
                      borderColor: colors.borderColor,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: photoFilter === f ? '#fff' : colors.textPrimary,
                    }}
                  >
                    {PHOTO_FILTER_LABELS[f]}
                  </Text>
                </Pressable>
              ))}
            </View>
            {filteredPhotos.length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>
                No photos yet.
              </Text>
            ) : (
              filteredPhotos.map((a, index) => (
                /*
                  The whole row opens the viewer, but it is deliberately NOT an
                  accessibility element: a `Pressable` that groups its children
                  collapses the thumbnail and the tag line into one label, and
                  the flows below it assert on both individually (`before` as a
                  bare string, `home-project-photo-blob-<i>-view` as the proof
                  the bytes decrypted). The explicit button at the end of the
                  row is what VoiceOver focuses and activates instead.
                */
                <Pressable
                  key={a.id}
                  accessible={false}
                  onPress={() => setViewerIndex(index)}
                  style={[styles.photoRow, { borderColor: colors.borderColor }]}
                  testID={`home-project-photo-item-${index}`}
                >
                  {/*
                  Until now this list showed a FILENAME and nothing else, so a
                  renovation photo could be added and never looked at — which is
                  most of the point of attaching one. The two backends address
                  the bytes differently and neither can render the other's: a
                  local-first row carries a sealed-blob descriptor that only
                  `resolveHouseBlobUri` can open, a server-backed row has a URL.
                */}
                  {a.blob ? (
                    <HouseBlobImage
                      descriptor={a.blob}
                      householdId={householdId}
                      width={64}
                      height={64}
                      accessibilityLabel={a.filename || 'Project photo'}
                      testID={`home-project-photo-blob-${index}`}
                    />
                  ) : a.url ? (
                    <Image
                      source={{ uri: a.url }}
                      style={styles.photoThumb}
                      accessibilityLabel={a.filename || 'Project photo'}
                      testID={`home-project-photo-remote-${index}`}
                    />
                  ) : null}
                  <View style={styles.photoMeta}>
                    <Text style={{ color: colors.textPrimary }}>
                      {a.filename || a.id.slice(0, 8)}
                    </Text>
                    <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                      {parseTags(a.tags).join(', ') || 'untagged'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setViewerIndex(index)}
                    hitSlop={8}
                    accessibilityRole="button"
                    // Position, not filename: the filename is a UUID here, and
                    // hearing one read out letter by letter tells nobody which
                    // photo this is.
                    accessibilityLabel={`View photo ${index + 1} of ${
                      filteredPhotos.length
                    }`}
                    testID={`home-project-photo-open-${index}`}
                  >
                    <Icon
                      name="expand-outline"
                      size={IconSize.md}
                      color={colors.textSecondary}
                    />
                  </Pressable>
                </Pressable>
              ))
            )}
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => setTaggedPhotoTag('before')}
              disabled={busy}
              testID="home-project-photo-before"
            >
              <Text style={styles.btnText}>Add before photo</Text>
            </Pressable>
            <Pressable
              style={[
                styles.btn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.borderColor,
                  borderWidth: 1,
                },
              ]}
              onPress={() => setTaggedPhotoTag('after')}
              disabled={busy}
              testID="home-project-photo-after"
            >
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                Add after photo
              </Text>
            </Pressable>

            <HousePhotoViewer
              photos={filteredPhotos.map(a => ({
                id: a.id,
                blob: a.blob,
                url: a.url,
                title: a.filename || a.id.slice(0, 8),
                subtitle: parseTags(a.tags).join(', ') || 'untagged',
              }))}
              index={viewerIndex}
              onClose={() => setViewerIndex(null)}
              onIndexChange={setViewerIndex}
              householdId={householdId}
              testID="home-project-photo-viewer"
            />
          </View>
        )}

        {section === 'blockers' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Blockers
            </Text>
            {canEdit && blockers.length > 1 ? (
              <Text
                style={[styles.reorderHint, { color: colors.textSecondary }]}
              >
                Tap a blocker to edit or resolve it, or drag the grip to
                reorder.
              </Text>
            ) : null}
            <BlockerList
              blockers={blockers}
              canEdit={canEdit}
              onEditBlocker={blocker => setEditingBlockerId(blocker.id)}
              onReorder={reorderBlockers}
            />
            <TextInput
              value={newBlocker}
              onChangeText={setNewBlocker}
              placeholder="Add blocker"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { color: colors.textPrimary, borderColor: colors.borderColor },
              ]}
            />
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => void addBlocker()}
              disabled={busy}
              testID="add-blocker"
            >
              <Text style={styles.btnText}>Add blocker</Text>
            </Pressable>
          </View>
        )}

        {section === 'activity' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Activity
            </Text>
            {activity.length === 0 ? (
              <Text style={{ color: colors.textSecondary }}>
                No activity yet
              </Text>
            ) : (
              activity.map(item => (
                <View
                  key={item.id}
                  style={[styles.line, { borderColor: colors.borderColor }]}
                >
                  <Text
                    style={{ color: colors.textPrimary, fontWeight: '500' }}
                  >
                    {getActivityLabel(item.action)}
                  </Text>
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                    {new Date(item.created_at).toLocaleString()}
                  </Text>
                </View>
              ))
            )}
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textPrimary, marginTop: 16 },
              ]}
            >
              Comment
            </Text>
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Write a comment (use @userId to mention)"
              placeholderTextColor={colors.textSecondary}
              style={[
                styles.input,
                { color: colors.textPrimary, borderColor: colors.borderColor },
              ]}
              testID="home-project-comment"
            />
            <Pressable
              style={[styles.btn, { backgroundColor: colors.primary }]}
              onPress={() => void postComment()}
              disabled={busy}
            >
              <Text style={styles.btnText}>Post comment</Text>
            </Pressable>
          </View>
        )}

        {/*
        Ordered by what a member came here to do.

        "Room & surfaces" is the one thing on this tab that produces the
        quantities and costs the rest of the project runs on, so it leads.
        "Floor plan zones" only means anything once a floor plan exists — with
        none uploaded it was three lines of instructions for a feature the
        member has not opted into, sitting between them and the thing they
        wanted — so it hides itself entirely until there is one. The AI and
        scan shortcuts are aids, not the task, and go last.
      */}
        {section === 'plans' && (
          <View style={styles.block}>
            <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
              Room &amp; surfaces
            </Text>
            <SurfaceSummaryCard
              payloadJson={geometry?.payload_json}
              source={geometry?.source}
              unitSystem={unitSystem}
              onOpen={() => navigation.navigate('SurfaceStudio', { projectId })}
            />

            {/* Only once there is a plan to zone, or a zone already linked. */}
            {floorPlans.length > 0 || plan_links.length > 0 ? (
              <>
                <Text
                  style={[
                    styles.sectionTitle,
                    { color: colors.textPrimary, marginTop: 20 },
                  ]}
                >
                  Floor plan zones
                </Text>
                {plan_links.length === 0 ? (
                  <Text
                    style={{ color: colors.textSecondary, marginBottom: 8 }}
                  >
                    No floor plans linked yet.
                  </Text>
                ) : (
                  plan_links.map(link => (
                    <Text
                      key={link.id}
                      style={{ color: colors.textPrimary, marginBottom: 6 }}
                    >
                      Plan {link.floor_plan_id.slice(0, 8)}…
                      {link.zone_payload ? ' · zone' : ''}
                    </Text>
                  ))
                )}
                <TextInput
                  value={zoneNote}
                  onChangeText={setZoneNote}
                  placeholder="Zone note (e.g. Master bath outline)"
                  placeholderTextColor={colors.textSecondary}
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.borderColor,
                    },
                  ]}
                  testID="plan-zone-note"
                />
                {floorPlans.map(fp => (
                  <Pressable
                    key={fp.id}
                    style={[
                      styles.btn,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.borderColor,
                        borderWidth: 1,
                      },
                    ]}
                    onPress={() => void linkFloorPlan(fp.id)}
                    disabled={busy}
                    testID={`link-floor-plan-${fp.id}`}
                  >
                    <Text
                      style={{ color: colors.textPrimary, fontWeight: '600' }}
                    >
                      Link {fp.building_name || fp.filename}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}

            <Text
              style={[
                styles.sectionTitle,
                { color: colors.textPrimary, marginTop: 20 },
              ]}
            >
              AI &amp; scan
            </Text>
            {roomPlan.isSupported() ? (
              <Pressable
                style={[styles.btn, { backgroundColor: colors.primary }]}
                onPress={() => void scanRoom()}
                disabled={busy}
                testID="scan-room-cta"
              >
                <Text style={styles.btnText}>Scan room (LiDAR)</Text>
              </Pressable>
            ) : null}
            <Pressable
              style={[
                styles.btn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.borderColor,
                  borderWidth: 1,
                },
              ]}
              onPress={() => void runAiSchematic()}
              disabled={busy || geometry?.status === 'generating'}
              testID="ai-schematic-cta"
            >
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                {geometry?.status === 'generating'
                  ? 'Schematic generating…'
                  : 'AI approximate schematic'}
              </Text>
            </Pressable>
            {geometry?.status === 'generating' ? (
              <Pressable
                style={[
                  styles.btn,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.borderColor,
                    borderWidth: 1,
                  },
                ]}
                onPress={() => void cancelSchematic()}
                disabled={busy}
              >
                <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                  Cancel generation
                </Text>
              </Pressable>
            ) : null}
            {geometry?.disclaimer ? (
              <Text
                style={{
                  color: colors.textSecondary,
                  marginTop: 8,
                  fontSize: 12,
                }}
              >
                {geometry.disclaimer}
              </Text>
            ) : null}
            <Pressable
              style={[
                styles.btn,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.borderColor,
                  borderWidth: 1,
                },
              ]}
              onPress={() => void exportShare()}
              disabled={busy}
              testID="export-project"
            >
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                Share project summary
              </Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/*
        Adding a material is a floating button, not a row in the list.

        It used to be a `Pressable` at the bottom of the Materials tab, which
        meant a member with a dozen materials had to scroll past all of them to
        reach the one thing they opened the tab to do. Pinned, it is in the same
        place whatever the list is doing. `FloatingActionButton` owns its own
        placement — safe-area inset, screen content padding, and a 600pt cap so
        it does not stretch across an iPad Air — which is exactly why it is used
        here rather than an absolute `View` positioned by hand.
      */}
      {section === 'materials' ? (
        <FloatingActionButton
          title="Add material"
          icon="+"
          // A write is already in flight: a second tap would open the menu over
          // a picker that is about to present, or start a second upload.
          disabled={busy}
          onPress={() => setMaterialMenuOpen(true)}
          testID="materials-add-fab"
        />
      ) : null}

      {/*
        The five sources, flat. See `MATERIAL_ADD_OPTIONS` for why there is no
        "Add with photo →" submenu over the last three.
      */}
      <BottomSheet
        visible={materialMenuOpen}
        onClose={() => setMaterialMenuOpen(false)}
        title="Add material"
        height="short"
        showCloseButton
      >
        <View testID="materials-add-menu">
          {MATERIAL_ADD_OPTIONS.map(option => (
            <Pressable
              key={option.id}
              onPress={() => openMaterialSource(option.id)}
              style={[styles.sourceRow, { borderColor: colors.borderColor }]}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              testID={`materials-add-${option.id}`}
            >
              <Icon
                name={option.icon}
                size={IconSize.md}
                color={colors.textPrimary}
              />
              <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
      </BottomSheet>

      {/*
        Manual entry — the same three fields the inline form had, in a sheet
        shaped like the edit-material one so adding and editing a material read
        as the same job.
      */}
      <BottomSheet
        visible={materialSheet === 'manual'}
        onClose={() => setMaterialSheet(null)}
        title="Add material"
        height="standard"
        showCloseButton
      >
        <View testID="materials-manual-sheet">
          <TextInput
            value={newSelection}
            onChangeText={setNewSelection}
            placeholder="Material name"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { color: colors.textPrimary, borderColor: colors.borderColor },
            ]}
            testID="add-selection-input"
          />
          <TextInput
            value={selectionPrice}
            onChangeText={numericTextHandler(setSelectionPrice)}
            placeholder="Price (dollars)"
            keyboardType="decimal-pad"
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { color: colors.textPrimary, borderColor: colors.borderColor },
            ]}
            testID="add-selection-price"
          />
          <TextInput
            value={selectionUrl}
            onChangeText={setSelectionUrl}
            placeholder="Product URL (optional)"
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { color: colors.textPrimary, borderColor: colors.borderColor },
            ]}
            testID="add-selection-url"
          />
          {/*
            Disabled on an empty name rather than accepting the tap and doing
            nothing. `addSelection` returns early without a name — correct, but
            from the outside a Save button that answers a press with silence is
            indistinguishable from a broken one.
          */}
          <Pressable
            style={[
              styles.btn,
              {
                backgroundColor: newSelection.trim()
                  ? colors.primary
                  : colors.actionDisabled,
              },
            ]}
            onPress={() => void addSelection()}
            disabled={busy || !newSelection.trim()}
            testID="materials-manual-save"
          >
            <Text style={styles.btnText}>Save</Text>
          </Pressable>
        </View>
      </BottomSheet>

      {/* One field: the shop link. Everything else is read off the page. */}
      <BottomSheet
        visible={materialSheet === 'link'}
        onClose={() => setMaterialSheet(null)}
        title="Add from link"
        height="short"
        showCloseButton
      >
        <View testID="materials-link-sheet">
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Paste a shop link and we will read the page for the photo, price,
            what one box covers and the specs that matter. Check them before you
            order.
          </Text>
          <TextInput
            value={linkUrl}
            onChangeText={setLinkUrl}
            placeholder="Paste product URL"
            placeholderTextColor={colors.textSecondary}
            keyboardType="url"
            autoCapitalize="none"
            autoCorrect={false}
            style={[
              styles.input,
              { color: colors.textPrimary, borderColor: colors.borderColor },
            ]}
            testID="add-from-link-input"
          />
          <Pressable
            style={[
              styles.btn,
              {
                backgroundColor: linkUrl.trim()
                  ? colors.primary
                  : colors.actionDisabled,
              },
            ]}
            onPress={() => void addFromLink()}
            disabled={busy || !linkUrl.trim()}
            testID="materials-link-save"
          >
            <Text style={styles.btnText}>
              {busy ? 'Reading the page…' : 'Add from link'}
            </Text>
          </Pressable>
        </View>
      </BottomSheet>

      <ProjectAccessSheet
        visible={accessOpen}
        onClose={() => setAccessOpen(false)}
        householdId={householdId}
        projectId={projectId}
        projectTitle={project.title}
        // Publishing and role changes both alter what THIS member sees on the
        // hub (the draft badge, the menu's publish item), so the hub refetches
        // rather than waiting for the next focus.
        onSaved={refreshAll}
      />

      {/* `visible` gates on the RESOLVED row, not on the id: a row deleted or
          gone in a refetch closes its own sheet rather than leaving an editor
          open over nothing. */}
      <PhaseEditSheet
        visible={!!editingPhase}
        phase={editingPhase}
        onClose={() => setEditingPhaseId(null)}
        onSave={savePhaseEdit}
        onDelete={() => editingPhase && confirmDeletePhase(editingPhase)}
      />

      <BlockerEditSheet
        visible={!!editingBlocker}
        blocker={editingBlocker}
        onClose={() => setEditingBlockerId(null)}
        onSave={saveBlockerEdit}
        onDelete={() => editingBlocker && confirmDeleteBlocker(editingBlocker)}
      />

      {/* The material menu's own Drive browse. Mounted at screen level so it
          outlives the menu sheet, which closes before any picker opens. */}
      {materialDrivePicker}

      <AttachmentSourceSheet
        visible={!!taggedPhotoTag}
        onClose={() => setTaggedPhotoTag(null)}
        title={taggedPhotoTag === 'after' ? 'After photo' : 'Before photo'}
        testIDPrefix="home-project-tagged-photo"
        rememberScope="home-project-photos"
        pickerOptions={{ compressImageQuality: 0.85, mediaType: 'photo' }}
        onPicked={([picked]) => {
          const tag = taggedPhotoTag;
          if (!tag || !picked) return;
          void addTaggedPhoto(tag, picked.uri);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  /* ── the material row ─────────────────────────────────────────────────
     Deliberately quiet at iPad Air 13-inch width: one thumbnail column, one
     text column that keeps growing, and a single actions line. Nothing is
     centred and nothing is boxed, so a list of twenty reads as twenty rows
     rather than twenty promotions. */
  materialCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  materialTop: { flexDirection: 'row', gap: 12 },
  materialThumb: { width: 56, height: 56, borderRadius: 8 },
  materialSwatch: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  materialBody: { flex: 1, minWidth: 0, gap: 4 },
  materialNameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  materialName: { flex: 1, fontSize: 15, fontWeight: '600' },
  materialStatus: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  /* Wraps rather than truncates: the "was" price and the percentage are the
     two halves of one claim, and a row narrow enough to drop either should
     drop to a second line instead. */
  materialPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  materialPrice: { fontSize: 15, fontWeight: '700' },
  materialWas: { fontSize: 13, textDecorationLine: 'line-through' },
  materialBadge: {
    fontSize: 12,
    fontWeight: '700',
    overflow: 'hidden',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  materialMeta: { fontSize: 12 },
  materialActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
  },
  materialAction: { fontSize: 13, fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  /**
   * Room for the floating "Add material" button on the Materials tab: its own
   * clearance from the bottom edge plus its height, so the last card in the
   * list scrolls clear of it rather than under it.
   */
  contentWithFab: {
    paddingBottom: Layout.floatingButtonClearance + 72,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  /* The header's title slot: thumbnail and name centered as one pair, with the
     name (not the photo) giving up the width when it is too long to fit. */
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 0,
  },
  headerTitleText: { flexShrink: 1 },
  /** Chat + the "…" menu, as one trailing cluster. */
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerCover: {
    width: HEADER_COVER_SIZE,
    height: HEADER_COVER_SIZE,
    borderRadius: 6,
  },
  meta: {
    fontSize: 13,
    textTransform: 'capitalize',
    marginBottom: 4,
    marginTop: 4,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  draftNote: { fontSize: 12, lineHeight: 17, marginTop: -4 },
  tabs: { marginVertical: 4, maxHeight: 44 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    marginRight: 8,
  },
  block: { marginTop: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginBottom: 10 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  btn: {
    marginTop: 10,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontWeight: '600' },
  line: {
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  /* Colour is applied at the call site from `colors.textSecondary` — this is
     only the metrics, so the hint sits with the heading rather than the list. */
  reorderHint: { fontSize: 12, marginTop: -4, marginBottom: 10 },
  editCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  help: { fontSize: 13, lineHeight: 18, marginBottom: 10 },
  /** One row of the add-material source menu: icon, then what it does. */
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  emptyCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  unitPill: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginBottom: 10,
  },
  groupPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  groupEditor: { marginTop: -12, marginBottom: 20 },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  /** A section heading with an affordance (the contingency "i") beside it. */
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 20,
    marginBottom: 10,
  },
  /** One budget line, open for editing. */
  lineEditor: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
    gap: 10,
  },
  field: { flex: 1 },
  fieldLabel: { fontSize: 12, marginBottom: 4 },
  removeLink: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 4,
  },
  /** Label left, amount right — `line` stacks, which is wrong for a total. */
  moneyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  photoThumb: { width: 64, height: 64, borderRadius: 8 },
  photoMeta: { flex: 1 },
});
