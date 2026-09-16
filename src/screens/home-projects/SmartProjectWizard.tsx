import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  homeProjectsApi,
  materializeSmartProjectPlan,
  type SmartDraftSpaceInput,
} from '@api/home-projects';
import { ScreenFooterGlass, ScreenHeader } from '@components/common';
import { Icon } from '@components/ui/Icon';
import { useLayoutPadding } from '@hooks/useLayoutPadding';
import type { HomeProjectsStackParamList } from '@navigation/types';
import { trackEvent } from '@services/analytics';
import { setMonitoringTag } from '@services/monitoring';
import { useHouseholdStore } from '@stores/householdStore';
import { useAppColors } from '@theme';
import { keyboardDismissScrollProps } from '@utils/keyboard';
import { toVisionSafeAttachment } from '@utils/visionSafeAttachment';

import { SmartProjectPhotoEditor } from './SmartProjectPhotoEditor';
import {
  composeSmartDraftDescription,
  type DraftPhoto,
} from './smartProjectPhotos';
import { SmartProjectPhotoStep } from './SmartProjectPhotoStep';

/**
 * How far above the window bottom this screen's PINNED footer starts.
 *
 * Not the 64pt `TAB_BAR_CONTENT_HEIGHT` the Kaizen screens use
 * (`src/features/kaizen/screens/common.tsx`): 64 clears the tab bar's capsule
 * and nothing else. The floating tab bar also paints a stack of bottom-
 * anchored blur bands OVER the screen (`BACKDROP_BLUR_BANDS` in
 * `app/(tabs)/_layout.tsx`), the tallest reaching `insets.bottom + 104`.
 * Pinned at 64 this footer's button ended at `insets.bottom + 80` — straddling
 * that band's top edge, so its lower half came out frosted white while its
 * upper half stayed crisp. Step 3's "Cancel" read as a half-erased control
 * that way: laid out, hit-testable, and unreadable. Content scrolling under
 * the ramp is what the ramp is for; a pinned control parked inside it is not.
 *
 * 104 for the tallest band + 8pt of clear air, less the 16pt the footer
 * already pads below its content.
 */
const TAB_BAR_FOOTER_CLEARANCE = 96;

type Props = NativeStackScreenProps<HomeProjectsStackParamList, 'SmartProject'>;

/**
 * What the form holds while the member is typing. Converted to
 * `SmartDraftSpaceInput` — the numeric wire shape — only at submit.
 */
interface SpaceDraft {
  label: string;
  length: string;
  width: string;
  height: string;
  /** Present only when the member opened the pitched-roof field. */
  ridge?: string;
}

/**
 * Smart Project — describe a project and let AI draft it.
 *
 * See `documents/requirements/HomeProjects/HomeProjects_SmartProject_BRD.md`.
 *
 * A separate screen rather than a fourth step on `CreateHomeProjectWizard`,
 * because it is a different *shape* of flow: the template wizard collects four
 * fields and creates a project synchronously, while this one collects prose,
 * hands it to a queue, and waits. Threading an async job through the template
 * wizard's step counter would make both harder to read than either is now.
 *
 * ## Why measurements are typed and not guessed
 *
 * Step 2 asks for dimensions and lets the member skip. Skipping does not fall
 * back to a typical shed: it produces a draft with phases and tasks and NO
 * surfaces and NO quantities, and the step says so before they choose. A
 * quantity derived from a guessed area gets bought, and the member has no way
 * to see that the number underneath it was invented.
 *
 * ## Where the review is
 *
 * Not here. The generated project opens in the real hub, where every screen
 * that renders it is the screen the member will keep using. A bespoke preview
 * would drift from those the moment either changed, and what they approved
 * would stop being what they got.
 */
/**
 * Keep what a decimal-pad can legitimately produce and nothing else.
 *
 * Deliberately NOT a `Number()` round-trip — that is the bug this replaces. It
 * strips characters that could never belong in a measurement while leaving a
 * half-typed "2." alone, because "2." is what "2.5" looks like halfway through.
 */
export function sanitizeDecimal(raw: string): string {
  const kept = raw.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  const [whole, ...rest] = kept.split('.');
  return rest.length ? `${whole}.${rest.join('')}` : whole;
}

/** 1–4 are the member's; 5 is the progress screen. See `step` in the component. */
type Step = 1 | 2 | 3 | 4 | 5;

/** The last member step. Kept as a name so the "of 4" and the guards agree. */
const LAST_STEP: Step = 4;

export type SmartDraftInclude = {
  phases: boolean;
  tasks: boolean;
  materials: boolean;
};

/**
 * What step 4 offers, as data.
 *
 * A list rather than three hand-written blocks so the SET is assertable without
 * standing up the screen — the same reasoning as `MATERIAL_ADD_OPTIONS` on the
 * hub. A row that silently stops being rendered is a section that silently
 * stops being offered, and neither the type checker nor a lint rule would say
 * so.
 *
 * The copy leads with what the member GETS rather than with the noun: "Steps"
 * on its own reads as jargon for the same thing as "Tasks", and the two are the
 * pair most likely to be confused.
 */
export const SMART_DRAFT_SECTIONS: ReadonlyArray<{
  id: keyof SmartDraftInclude;
  label: string;
  detail: string;
}> = [
  {
    id: 'phases',
    label: 'Steps',
    detail:
      'The stages of work, in the order they have to happen — windows before insulation, insulation before the walls close up.',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    detail:
      'The actions inside each stage, broken down per room and per item, so a step reads as things you can tick off.',
  },
  {
    id: 'materials',
    label: 'Materials',
    detail:
      'What to buy, with the bits that get forgotten — foam and sealant with a window, clamps and ducting with a vent, adhesive and membrane with insulation. No prices: those are yours to fill in.',
  },
];

/**
 * What a description has to carry for the draft to be worth reading.
 *
 * Not general writing advice — each row is a thing the model is instructed to
 * do something specific with, so leaving it out has a consequence the member
 * can see. As-is state suppresses whole phases; an unmentioned element comes
 * back `unknown` and becomes a question; `target_use` is what turns a shed into
 * a workshop's requirements. See `SMART_PROJECT_SYSTEM_PROMPT`.
 *
 * Data rather than four hand-written blocks, for the same reason as
 * `SMART_DRAFT_SECTIONS`: the SET is then assertable without standing up the
 * screen, and a row that quietly stops being rendered is guidance that quietly
 * stops being given.
 */
export const SMART_DESCRIPTION_TIPS: ReadonlyArray<{
  lead: string;
  detail: string;
}> = [
  {
    lead: 'What it is now, and what you want it to be',
    detail:
      'a bare shed becoming a woodworking shop — that one line shapes everything else.',
  },
  {
    lead: 'What is already done',
    detail: 'finished work is work we will not plan again.',
  },
  {
    lead: 'What is missing, or in the way',
    detail:
      'no power, no window, damp in one corner. What you leave out we ask about rather than assume.',
  },
  {
    lead: 'How it has to work when it is finished',
    detail:
      'used through winter, room for a bench, dust extraction. This changes the plan more than the size does.',
  },
];

/**
 * A worked description the member can send as it stands.
 *
 * The placeholder is one sentence and disappears the moment they type, which
 * makes it a prompt and not an example — it cannot show what a description that
 * covers all four points above actually reads like. This can, and "Use this"
 * makes it a starting point to edit rather than a paragraph to copy by hand.
 *
 * Deliberately the shed: it is the case the feature was built against, it is
 * what the placeholder already names, and it hits every tip — as-is roof, walls
 * and slab; missing power, lining and insulation; a target use with real
 * requirements behind it.
 */
export const SMART_DESCRIPTION_EXAMPLE =
  'My shed is about 4 by 3 m with a pitched roof. The roof, walls and ' +
  'concrete floor are all done and sound, but inside it is bare frame — no ' +
  'insulation, no lining, and no power beyond an extension lead from the ' +
  'house. I want to turn it into a woodworking shop I can use through winter: ' +
  'a bench along the long wall, a table saw, dust extraction, and a window on ' +
  'the sunny side for daylight. It stands away from the house.';

export function SmartProjectWizard({ navigation, route }: Props) {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  /** iPad's floating leading rail draws over x=0 — reserve its width. */
  const { sidebarInset } = useLayoutPadding();
  const householdId = useHouseholdStore(s => s.currentHousehold?.id);

  /**
   * 1–4 are the member's steps; 5 is the progress screen and is not one.
   *
   * It is deliberately part of the same enum rather than a separate `phase`
   * flag: every place that asks "which step" — the header's back button, the
   * footer's buttons, the "Step n of 4" line — has to treat generating as one
   * more thing anyway, and two overlapping state machines is how a Cancel
   * button ends up rendered over a spinner.
   */
  const [step, setStep] = useState<Step>(1);
  const [description, setDescription] = useState('');
  /** Step 1's example card, closed until the member asks for it. */
  const [showExample, setShowExample] = useState(false);
  /**
   * Dimensions are held as TEXT while they are being typed, not as numbers.
   *
   * A controlled numeric input round-trips every keystroke through `Number()`,
   * and `Number('2.')` is `2` — so the decimal point is erased the instant it
   * is typed and the next digit lands against the whole part. Typing "2.5"
   * produced 25. A member could not enter a decimal dimension at all, and a
   * ten-times-too-big wall height feeds straight into the takeoff, which is the
   * exact harm the "no guessed numbers" rule exists to prevent.
   *
   * Found on a device; the contract tests never could, because they are handed
   * numbers that are already parsed.
   */
  const [spaces, setSpaces] = useState<SpaceDraft[]>([
    { label: 'Room', length: '', width: '', height: '2.4' },
  ]);
  const [footerHeight, setFooterHeight] = useState(0);
  const [keyboardInset, setKeyboardInset] = useState(0);

  /** Step 3. Empty is the expected case — the step is optional. */
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  /** Index into `photos` while the editor is open; `null` when it is closed. */
  const [editing, setEditing] = useState<number | null>(null);

  /**
   * Step 4 — what the member actually wants drafted.
   *
   * All three on, because that is what every draft produced before this step
   * existed and the step is meant to let somebody take something OFF, not to
   * make them opt in to a feature they already had.
   */
  const [include, setInclude] = useState<SmartDraftInclude>({
    phases: true,
    tasks: true,
    materials: true,
  });

  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /**
   * What the progress screen is allowed to claim is happening.
   *
   * A single spinner was honest while generation was one call. It is not any
   * more: with photos this is upload → generate → attach, the first and last of
   * which are proportional to how many photos the member added, and a member
   * watching an unchanging "Drafting your project" for ninety seconds concludes
   * it has hung. `done`/`total` are only meaningful for the two counted stages.
   */
  const [stage, setStage] = useState<{
    kind: 'uploading' | 'drafting' | 'building' | 'saving';
    done: number;
    total: number;
  }>({ kind: 'drafting', done: 0, total: 0 });

  useEffect(() => {
    setMonitoringTag('feature', 'home_projects');
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const showSub = Keyboard.addListener('keyboardWillShow', e =>
      setKeyboardInset(e.endCoordinates.height),
    );
    const hideSub = Keyboard.addListener('keyboardWillHide', () =>
      setKeyboardInset(0),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /**
   * Text → numbers, once, at the boundary. A space whose numbers do not parse
   * is dropped rather than sent as zeros: a partially-typed room must not
   * become a room of no size.
   */
  const measuredSpaces = useMemo<SmartDraftSpaceInput[]>(() => {
    const out: SmartDraftSpaceInput[] = [];
    for (const s of spaces) {
      const length_m = Number(s.length);
      const width_m = Number(s.width);
      const height_m = Number(s.height);
      if (
        !s.label.trim() ||
        !Number.isFinite(length_m) ||
        !Number.isFinite(width_m) ||
        !Number.isFinite(height_m) ||
        length_m <= 0 ||
        width_m <= 0 ||
        height_m <= 0
      ) {
        continue;
      }
      const ridge = s.ridge != null ? Number(s.ridge) : undefined;
      out.push({
        label: s.label.trim(),
        length_m,
        width_m,
        height_m,
        // Only sent when it is a real, higher-than-the-walls ridge. A peak at or
        // below the eaves is a swapped pair, and the derivation would clamp it
        // to flat anyway — better not to send it than to send a shape.
        ...(ridge != null && Number.isFinite(ridge) && ridge > height_m
          ? { ridge_height_m: ridge }
          : {}),
      });
    }
    return out;
  }, [spaces]);

  /** Step 1's gate: a paragraph is the one thing this feature cannot do without. */
  const canDescribe = description.trim().length >= 20;

  /**
   * "Tasks" USED TO BE DISABLED HERE, on a local-first household.
   *
   * `home_project_tasks` was a PK-less join the ledger could not key (hazard
   * S2), so `createTask` refused on device and an unconditional tick-box was a
   * promise the build could not keep — the member would tick it, wait a minute,
   * and get a draft with no tasks and nothing saying why. Migration 0170 moved
   * the link onto the project row as `linked_task_ids`, so all three linked-task
   * methods are ordinary local writes and the box needs no gate on either
   * backend. See `localHomeProjectsApi`'s linked-tasks block.
   */
  const wantsSomething =
    include.phases || include.tasks || include.materials;

  const canGenerate = canDescribe && wantsSomething;

  /**
   * Shrink each photo for the model and hand it to R2, returning what LANDED.
   *
   * Returns pairs rather than keys, and that is load-bearing. A member's note
   * says "Photo 3", and "photo 3" means the third image block the model
   * receives — so if the second upload fails, the third photo becomes the
   * model's second and every note after it points at the wrong picture. Pairing
   * the key back to the photo it came from lets the caller build both the key
   * list and the note list from the SAME surviving array, so the two cannot
   * disagree.
   *
   * A failed upload is skipped, not thrown: nine photos and a plan beats no
   * plan, and the member cannot do anything about an R2 miss.
   */
  const uploadPhotosForDraft = async (
    id: string,
  ): Promise<Array<{ photo: DraftPhoto; key: string }>> => {
    const landed: Array<{ photo: DraftPhoto; key: string }> = [];
    for (const photo of photos) {
      setStage({ kind: 'uploading', done: landed.length, total: photos.length });
      try {
        // 1568px / JPEG 0.8 — the size a vision model gains nothing above and
        // a BYOK request starts being refused at. The stored copy is shrunk
        // separately and less aggressively; see `smartProjectPhotos.ts`.
        const safe = await toVisionSafeAttachment({
          uri: photo.uri,
          name: `${photo.id}.jpg`,
          type: photo.mime,
        });
        const { key } = await homeProjectsApi.uploadSmartDraftPhoto(
          id,
          safe.uri,
          'image/jpeg',
        );
        landed.push({ photo, key });
      } catch (err) {
        if (__DEV__) console.warn('[smart-project] photo upload failed', err);
      }
    }
    return landed;
  };

  /**
   * Attach the member's photos to the project that was just drafted.
   *
   * These are a SECOND upload of the same pictures, and deliberately so. The
   * ones sent for generation are transient inputs the Worker deletes the moment
   * the plan comes back; these go through `uploadSelectionPhoto`, which seals
   * them into the encrypted blob channel on a local-first household and writes
   * an R2 attachment row on a server-backed one. Reusing the draft keys would
   * mean the member's kept photos lived in a bucket their own household's
   * storage model says they should never be in — and would be deleted out from
   * under the project an hour later.
   *
   * Best-effort per photo, for the same reason `materializeSmartProjectPlan`
   * settles each child: a project with nine of its ten photos is worth far more
   * than an error and a project the member cannot reach.
   */
  const attachPhotosToProject = async (id: string, projectId: string) => {
    let done = 0;
    for (const photo of photos) {
      setStage({ kind: 'saving', done, total: photos.length });
      try {
        await homeProjectsApi.uploadSelectionPhoto(id, projectId, photo.uri);
      } catch (err) {
        if (__DEV__) console.warn('[smart-project] photo attach failed', err);
      }
      done += 1;
    }
  };

  const onGenerate = async () => {
    if (!householdId || !canGenerate || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setStep(5);
      setStage({ kind: photos.length ? 'uploading' : 'drafting', done: 0, total: photos.length });
      trackEvent('home_project_smart_draft_started', {
        has_dimensions: measuredSpaces.length > 0,
        photo_count: photos.length,
        // What the member asked for, so the answer to "does anybody untick
        // these" is data rather than a guess.
        wants_phases: include.phases,
        wants_tasks: include.tasks,
        wants_materials: include.materials,
      });

      const landed = photos.length ? await uploadPhotosForDraft(householdId) : [];

      /**
       * Every photo failing is the one upload outcome worth stopping for.
       *
       * A partial loss degrades honestly — nine photos still describe the room,
       * and the note numbering is built from `landed` so nothing points at the
       * wrong picture. Losing ALL of them does not: the member deliberately
       * added photos, generation would succeed on the description alone, and
       * they would arrive at a plan that never saw a single one with nothing
       * anywhere saying so. That is a wrong answer delivered as a right one.
       *
       * Failing here is recoverable in a way a photo-blind plan is not: the
       * catch below returns to step 3 with the photos still in the grid, so
       * retrying or removing them are both one tap away.
       */
      if (photos.length && !landed.length) {
        throw new Error(
          'We could not send your photos. Check your connection and try again — or remove them to draft from your description alone.',
        );
      }

      setStage({ kind: 'drafting', done: 0, total: 0 });

      // The server thinks; this device stores. `materializeSmartProjectPlan`
      // saves through `homeProjectsApi`, which routes to the encrypted ledger
      // on a local-first household and to D1 on a server-backed one — so the
      // drafted project always lands where this household's projects actually
      // live. See BRD §12 Q4.
      const plan = await homeProjectsApi.generateSmartProjectPlan(householdId, {
        // Notes are folded into the description and numbered against the photos
        // that ACTUALLY uploaded — `landed`, never `photos` — so "Photo 3"
        // always names the third image block the model receives.
        description: composeSmartDraftDescription(
          description,
          landed.map(entry => entry.photo),
        ),
        spaces: measuredSpaces.length ? measuredSpaces : undefined,
        photo_keys: landed.length ? landed.map(entry => entry.key) : undefined,
        // The server both instructs the model and strips what was not asked
        // for, so what comes back is already only what the member ticked —
        // `materializeSmartProjectPlan` writes the plan as it stands and has no
        // second copy of this decision to fall out of step with.
        include,
      });
      /**
       * Writing the plan out is its own stage now, and a counted one.
       *
       * It used to be a quick tail-end to generation and it is not any more: a
       * draft that names the consumables an installation needs carries thirty-
       * odd materials, and on a server-backed household each is a round trip.
       * Left under "Drafting your project" the member watches an unchanging
       * spinner for a minute AFTER the model has finished — the same defect the
       * photo stages were split out to fix.
       */
      let lost = 0;
      setStage({ kind: 'building', done: 0, total: 0 });
      const project = await materializeSmartProjectPlan(
        householdId,
        plan,
        route.params?.spaceId ? [route.params.spaceId] : undefined,
        {
          onProgress: p => {
            lost = p.failed;
            setStage({ kind: 'building', done: p.done, total: p.total });
          },
        },
      );

      /**
       * Rows that did not land are said out loud, once.
       *
       * `materializeSmartProjectPlan` settles each child so one failure cannot
       * cost the member the project — which is right, and on its own it means a
       * connection that drops halfway through produces a project quietly
       * missing half its shopping list. There is nothing here that reads as
       * wrong: the member sees a plausible plan and only finds out at the
       * merchant. Naming the count is what makes re-planning an informed choice
       * rather than a coincidence.
       */
      if (lost > 0) {
        Alert.alert(
          'Some of your draft did not save',
          `${lost} item${lost === 1 ? '' : 's'} could not be added to the project — most likely a connection drop. Everything else is there, and you can add the rest by hand or draft it again.`,
        );
      }

      // After the project exists, and before navigating: the hub renders these
      // as the project's photos and its cover, so arriving to an empty gallery
      // that fills in behind the member reads as the attach having failed.
      if (photos.length) await attachPhotosToProject(householdId, project.id);

      trackEvent('home_project_smart_draft_ready', {
        project_id: project.id,
        photos_sent: landed.length,
      });
      navigation.replace('HomeProjectHub', { projectId: project.id });
    } catch (err) {
      setFailed(true);
      Alert.alert(
        'Could not draft that',
        (err as Error).message ||
          'Something went wrong. You can start from a template instead.',
      );
    } finally {
      setBusy(false);
    }
  };

  /** Nothing server-side to cancel any more — generation is one awaited call. */
  const onCancel = () => navigation.goBack();

  /**
   * Fill the box with the example — asking first if that would destroy work.
   *
   * The confirm is not politeness. A member who has typed three sentences and
   * then opens the example to check they covered everything is one tap away
   * from having those sentences replaced by a shed they do not own, with no
   * undo anywhere in this screen and nothing else holding what they wrote.
   */
  const applyExample = () => {
    setDescription(SMART_DESCRIPTION_EXAMPLE);
    setShowExample(false);
    trackEvent('home_project_smart_example_used');
  };

  const onUseExample = () => {
    if (!description.trim()) {
      applyExample();
      return;
    }
    Alert.alert(
      'Replace what you have written?',
      'The example will take the place of your description.',
      [
        { text: 'Keep mine', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: applyExample },
      ],
    );
  };

  const updateSpace = (index: number, patch: Partial<SpaceDraft>) => {
    setSpaces(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };


  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.backgroundMain,
        paddingLeft: sidebarInset,
      }}
    >
      <ScreenHeader
        title="Describe it"
        showBackButton={step < 5 || failed}
        /**
         * A failed generation returns to the LAST MEMBER STEP, not out of the
         * screen.
         *
         * Everything the member typed, every photo they framed and what they
         * asked to be drafted lives in this component's state, so leaving
         * discards all of it — and the copy on the failure tells them to try
         * describing it differently, which they cannot do from the project list.
         */
        onBackPress={() => {
          if (step === 5) {
            if (failed) setStep(LAST_STEP);
            else navigation.goBack();
            return;
          }
          if (step > 1) setStep((step - 1) as Step);
          else navigation.goBack();
        }}
        showNotificationBell={false}
        showAvatar={false}
      />

      <ScrollView
        {...keyboardDismissScrollProps}
        contentContainerStyle={[
          styles.content,
          /**
           * Reserve the footer's OFFSET as well as its height — the footer is
           * pinned `TAB_BAR_FOOTER_CLEARANCE` above the window bottom, and
           * counting only `footerHeight` leaves content underneath it. Same
           * defect that put the template grid under Continue in
           * `CreateHomeProjectWizard`; latent here only because these steps are
           * shorter. Mirrors the footer's own `bottom` so the two cannot drift.
           */
          {
            paddingBottom:
              footerHeight +
              (keyboardInset > 0 ? keyboardInset : TAB_BAR_FOOTER_CLEARANCE) +
              24,
          },
        ]}
        /**
        *
        Without
        this,
        the
        FIRST
        tap
        after
        typing
        is
        swallowed
        dismissing
        the
        *
        keyboard
        and
        never
        reaches
        the
        control
        underneath.
        *
        *
        This
        step
        is
        nothing
        but
        text
        fields
        followed
        by
        a
        control:
        a
        member
        *
        types
        the
        wall
        height,
        taps
        "Open to the roof?",
        and
        nothing
        happens
        *
        —
        they
        have
        to
        tap
        it
        twice,
        with
        no
        way
        to
        know
        that.
        Caught
        on
        a
        *
        device,
        where
        the
        toggle
        refused
        to
        open
        while
        the
        handler
        was
        *
        provably
        correct.
        */
      >
        {step < 5 && (
          <Text style={[styles.step, { color: colors.textSecondary }]}>
            Step {step} of {LAST_STEP}
            {step === 3 ? ' · optional' : ''}
          </Text>
        )}

        {step === 1 && (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>
              What have you got, and what do you want?
            </Text>
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Say what is already there as well as what you want done — if the
              roof and floor are finished, we will not plan them again.
            </Text>

            {/* What to actually put in the box, before they are staring at an
                empty one. The help line above says the single most important
                thing; these say the rest of it, and each row is a thing the
                draft measurably does better for having been told. */}
            <View style={styles.tips}>
              <Text style={[styles.tipsTitle, { color: colors.textPrimary }]}>
                Worth including
              </Text>
              {SMART_DESCRIPTION_TIPS.map(tip => (
                <View key={tip.lead} style={styles.tipRow}>
                  <Text style={[styles.tipBullet, { color: colors.primary }]}>
                    •
                  </Text>
                  <Text
                    style={[styles.tipText, { color: colors.textSecondary }]}
                  >
                    <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>
                      {tip.lead}
                    </Text>
                    {' — '}
                    {tip.detail}
                  </Text>
                </View>
              ))}
            </View>

            <TextInput
              style={[
                styles.textarea,
                {
                  backgroundColor: colors.card,
                  color: colors.textPrimary,
                  borderColor: colors.borderColor,
                },
              ]}
              value={description}
              onChangeText={setDescription}
              placeholder={
                'e.g. I have a shed with a roof, walls and a concrete floor, but ' +
                'inside it is just bare frame. I want to turn it into a woodworking shop.'
              }
              placeholderTextColor={colors.textSecondary}
              multiline
              textAlignVertical="top"
              accessibilityLabel="Describe your project"
              testID="smart-project-description"
            />
            <View style={styles.counterRow}>
              <Text style={[styles.counter, { color: colors.textSecondary }]}>
                {description.trim().length < 20
                  ? 'A sentence or two at minimum'
                  : `${description.trim().length} characters`}
              </Text>

              {/* Behind a button, not printed under the box. An example long
                  enough to be worth reading is longer than the field itself,
                  and one sitting open above the keyboard pushes the thing they
                  came here to type off the screen. */}
              <Pressable
                style={styles.exampleToggle}
                onPress={() => {
                  setShowExample(open => {
                    if (!open) trackEvent('home_project_smart_example_opened');
                    return !open;
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  showExample
                    ? 'Hide the example description'
                    : 'See an example description'
                }
                hitSlop={8}
                testID="smart-project-example-toggle"
              >
                <Icon
                  name="information-circle-outline"
                  size={16}
                  color={colors.primary}
                />
                <Text style={[styles.exampleToggleText, { color: colors.primary }]}>
                  {showExample ? 'Hide example' : 'See an example'}
                </Text>
              </Pressable>
            </View>

            {showExample && (
              <View
                style={[
                  styles.exampleCard,
                  { backgroundColor: colors.card, borderColor: colors.borderColor },
                ]}
                testID="smart-project-example"
              >
                <Text style={[styles.exampleBody, { color: colors.textPrimary }]}>
                  {SMART_DESCRIPTION_EXAMPLE}
                </Text>
                {/* The point of showing it. Retyping a paragraph off the screen
                    above the keyboard is not something a member will do, so the
                    example would be read and abandoned; filling the box makes it
                    a draft of their own to edit down. */}
                <Pressable
                  onPress={onUseExample}
                  accessibilityRole="button"
                  hitSlop={6}
                  testID="smart-project-example-use"
                >
                  <Text style={[styles.exampleUse, { color: colors.primary }]}>
                    Use this as a starting point
                  </Text>
                </Pressable>
              </View>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>
              Measure the space
            </Text>
            {/* The honest bit. A member who understands what skipping costs can
                skip; one who does not would get quantities from a guess. */}
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              We work out wall, floor and ceiling areas from these numbers, and
              material quantities from those areas. Skip this and you still get
              phases and tasks — but no surfaces and no quantities, because we
              will not guess the size of your room.
            </Text>

            {spaces.map((space, index) => (
              <View
                key={index}
                style={[
                  styles.spaceCard,
                  { backgroundColor: colors.card, borderColor: colors.borderColor },
                ]}
              >
                <TextInput
                  style={[styles.input, { color: colors.textPrimary }]}
                  value={space.label}
                  onChangeText={t => updateSpace(index, { label: t })}
                  placeholder="Room name"
                  placeholderTextColor={colors.textSecondary}
                  accessibilityLabel={`Name of space ${index + 1}`}
                  testID={`smart-project-space-label-${index}`}
                />
                <View style={styles.dimRow}>
                  {(
                    [
                      ['length', 'Length (m)'],
                      ['width', 'Width (m)'],
                      // "Wall height", not "Height". In a space open to its
                      // rafters the two are different numbers, and a member who
                      // reads plain "Height" and types the peak gets a room
                      // 0.7 m too tall on every wall.
                      ['height', 'Wall height (m)'],
                    ] as const
                  ).map(([key, label]) => (
                    <View key={key} style={styles.dimField}>
                      <Text
                        style={[styles.dimLabel, { color: colors.textSecondary }]}
                      >
                        {label}
                      </Text>
                      <TextInput
                        style={[
                          styles.dimInput,
                          {
                            color: colors.textPrimary,
                            borderColor: colors.borderColor,
                          },
                        ]}
                        // The member's own text, unmodified. Parsing here is
                        // what erased the decimal point; it now happens once,
                        // at submit, in `measuredSpaces`.
                        value={space[key]}
                        onChangeText={t =>
                          updateSpace(index, { [key]: sanitizeDecimal(t) })
                        }
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={colors.textSecondary}
                        accessibilityLabel={`${label} of ${space.label || 'space'}`}
                        testID={`smart-project-${key}_m-${index}`}
                      />
                    </View>
                  ))}
                </View>

                {/* Ridge height — the fix for the first real member request.
                    A shed open to its rafters has no flat ceiling, and
                    measuring it as one under-counts the ceiling AND the walls
                    (a gable adds a triangle at each end). Both run short, which
                    is the direction that stops a job halfway.

                    Optional and off to the side because most rooms genuinely
                    are flat; asked for as a HEIGHT because a member owns a tape
                    measure and not an inclinometer. */}
                <Pressable
                  onPress={() =>
                    updateSpace(index, {
                      ridge: space.ridge == null ? '' : undefined,
                    })
                  }
                  accessibilityRole="button"
                  hitSlop={6}
                  testID={`smart-project-pitched-toggle-${index}`}
                >
                  <Text style={[styles.pitchToggle, { color: colors.primary }]}>
                    {space.ridge == null
                      ? 'Open to the roof? Add a peak height'
                      : 'Flat ceiling — remove peak height'}
                  </Text>
                </Pressable>

                {space.ridge != null && (
                  <View style={styles.dimField}>
                    <Text
                      style={[styles.dimLabel, { color: colors.textSecondary }]}
                    >
                      Peak height (m) — floor to the ridge
                    </Text>
                    <TextInput
                      style={[
                        styles.dimInput,
                        {
                          color: colors.textPrimary,
                          borderColor: colors.borderColor,
                        },
                      ]}
                      value={space.ridge ?? ''}
                      onChangeText={t =>
                        updateSpace(index, { ridge: sanitizeDecimal(t) })
                      }
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.textSecondary}
                      accessibilityLabel={`Peak height of ${space.label || 'space'}`}
                      testID={`smart-project-ridge_height_m-${index}`}
                    />
                    {/* Said before they submit, not after: a peak below the
                        walls is a swapped pair, and the derivation clamps it to
                        flat rather than inventing a negative roof. */}
                    {Number(space.ridge) > 0 &&
                      Number(space.ridge) <= Number(space.height) && (
                        <Text
                          style={[styles.dimHint, { color: colors.textSecondary }]}
                        >
                          The peak should be higher than the walls — otherwise
                          we measure this as a flat ceiling.
                        </Text>
                      )}
                  </View>
                )}
              </View>
            ))}

            {spaces.length < 8 && (
              <Pressable
                style={styles.addSpace}
                onPress={() =>
                  setSpaces(prev => [
                    ...prev,
                    { label: '', length: '', width: '', height: '2.4' },
                  ])
                }
                accessibilityRole="button"
                accessibilityLabel="Add another space"
              >
                <Icon name="add-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.primary, marginLeft: 6 }}>
                  Add another space
                </Text>
              </Pressable>
            )}
          </>
        )}

        {step === 3 && (
          <SmartProjectPhotoStep
            photos={photos}
            disabled={busy}
            onAdd={added => setPhotos(prev => [...prev, ...added])}
            onOpen={setEditing}
            onRemove={id => setPhotos(prev => prev.filter(p => p.id !== id))}
          />
        )}

        {step === 4 && (
          <>
            <Text style={[styles.heading, { color: colors.textPrimary }]}>
              What should we draft?
            </Text>
            {/* The honest bit, again. Step 2 says what skipping measurements
                costs; this says what unticking costs — nothing is added behind
                your back, and nothing you leave off appears anywhere else. */}
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              We only add what you tick. Anything you leave off is not suggested
              at all — not as a phase, not folded into a task — and you can
              still add it yourself afterwards.
            </Text>

            {SMART_DRAFT_SECTIONS.map(section => {
              const on = include[section.id];
              return (
                <Pressable
                  key={section.id}
                  style={[
                    styles.sectionCard,
                    {
                      backgroundColor: colors.card,
                      borderColor: on ? colors.primary : colors.borderColor,
                    },
                  ]}
                  disabled={busy}
                  onPress={() =>
                    setInclude(prev => ({ ...prev, [section.id]: !prev[section.id] }))
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: busy }}
                  accessibilityLabel={`${section.label} — ${section.detail}`}
                  testID={`smart-project-include-${section.id}`}
                >
                  <Icon
                    name={on ? 'checkmark-circle' : 'ellipse-outline'}
                    size={24}
                    color={on ? colors.primary : colors.textSecondary}
                  />
                  <View style={styles.sectionBody}>
                    <Text
                      style={[styles.sectionLabel, { color: colors.textPrimary }]}
                    >
                      {section.label}
                    </Text>
                    <Text
                      style={[styles.sectionDetail, { color: colors.textSecondary }]}
                    >
                      {section.detail}
                    </Text>
                  </View>
                </Pressable>
              );
            })}

            {/* Said where the decision is made rather than on the disabled
                button, which cannot explain itself. */}
            {!wantsSomething && (
              <Text style={[styles.counter, { color: colors.error }]}>
                Pick at least one — otherwise there is nothing to draft.
              </Text>
            )}

            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Questions worth asking come with every draft, whatever you pick
              here — those are things to check, not work we are proposing.
            </Text>
          </>
        )}

        {step === 5 && (
          <View style={styles.generating} testID="smart-project-generating">
            {!failed ? (
              <>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={[styles.heading, { color: colors.textPrimary }]}>
                  {stage.kind === 'uploading'
                    ? 'Preparing your photos'
                    : stage.kind === 'saving'
                      ? 'Saving your photos'
                      : stage.kind === 'building'
                        ? 'Building your project'
                        : 'Drafting your project'}
                </Text>
                {/* Counted stages say where they are. An unchanging spinner over
                    a ten-photo upload is what makes a member force-quit a flow
                    that was working. */}
                {stage.total > 0 && stage.kind !== 'drafting' && (
                  <Text style={[styles.step, { color: colors.textSecondary }]}>
                    {Math.min(stage.done + 1, stage.total)} of {stage.total}
                  </Text>
                )}
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  {stage.kind === 'saving'
                    ? 'Your project is drafted. These are being attached to it now.'
                    : stage.kind === 'building'
                      ? // The model has already answered by this point, so the
                        // "up to a minute" line below would be measuring the
                        // wrong thing — this stage is writing rows, and its own
                        // count says how far through it is.
                        'The plan is back. Writing the steps, materials and questions onto your project.'
                      : 'This takes up to a minute. You can leave — we will let you know when it is ready, and nobody else in your household sees it until you share it.'}
                </Text>
              </>
            ) : (
              <>
                <Icon name="alert-circle-outline" size={40} color={colors.error} />
                <Text style={[styles.heading, { color: colors.textPrimary }]}>
                  Could not draft that
                </Text>
                <Text style={[styles.help, { color: colors.textSecondary }]}>
                  Try describing it again, or start from a template instead.
                </Text>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Same absolute-footer-over-`ScreenFooterGlass` recipe the template
          wizard uses — the glass is a backdrop, not a container. */}
      <View
        style={[
          styles.footer,
          {
            /**
             * Lifted clear of the bottom tab bar.
             *
             * Home Projects became a TAB (`app/(tabs)/projects.tsx`), so the
             * floating tab bar now sits over the very bottom of every screen in
             * this stack — including this pinned footer. The result was that
             * "Continue" rendered underneath it: invisible, and a tap on it hit
             * the tab bar and jumped to another tab. A member could not create a
             * project from a template at all.
             *
             * `TAB_BAR_FOOTER_CLEARANCE` clears the bar's blur backdrop too,
             * not just the capsule — see the constant. When the keyboard is up
             * the whole bar is covered anyway, so only the keyboard inset
             * applies.
             */
            bottom: keyboardInset > 0 ? keyboardInset : TAB_BAR_FOOTER_CLEARANCE,
            paddingBottom: keyboardInset > 0 ? 16 : insets.bottom + 16,
          },
        ]}
        onLayout={e => setFooterHeight(e.nativeEvent.layout.height)}
      >
        <ScreenFooterGlass />
        {step === 1 && (
          <Pressable
            style={[
              styles.primary,
              {
                backgroundColor: canDescribe ? colors.primary : colors.borderColor,
              },
            ]}
            disabled={!canDescribe}
            onPress={() => setStep(2)}
            accessibilityRole="button"
            testID="smart-project-continue"
          >
            <Text style={styles.primaryText}>Continue</Text>
          </Pressable>
        )}

        {/* Skip and Continue now do DIFFERENT things and both lead to step 3.
            Skip discards whatever is half-typed in the dimension fields, which
            is the honest reading of the copy above it; Continue keeps them.
            Before the photo step existed both generated immediately, so the two
            were interchangeable — and a member who taps Skip having filled in
            one and a half rooms should not have the one room silently counted. */}
        {step === 2 && (
          <View style={styles.footerRow}>
            <Pressable
              style={[styles.secondary, { borderColor: colors.borderColor }]}
              onPress={() => {
                // Back to one blank room rather than none: a member who taps
                // Skip and then changes their mind on step 3 must find a form
                // to come back to, not an empty step with a hidden "Add" link.
                setSpaces([{ label: 'Room', length: '', width: '', height: '2.4' }]);
                setStep(3);
              }}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Skip measurements and draft without quantities"
              testID="smart-project-skip"
            >
              <Text style={{ color: colors.textSecondary }}>Skip</Text>
            </Pressable>
            <Pressable
              style={[styles.primary, { backgroundColor: colors.primary, flex: 1 }]}
              onPress={() => setStep(3)}
              disabled={busy}
              accessibilityRole="button"
              testID="smart-project-continue"
            >
              <Text style={styles.primaryText}>Continue</Text>
            </Pressable>
          </View>
        )}

        {/* One full-width button, and no "Skip" beside it. The step is already
            labelled optional and continuing with zero photos is exactly what
            this button does — a second control that means "the same thing but
            with nothing attached" would only be there to say the step was
            skippable, which the heading has already said. */}
        {step === 3 && (
          <Pressable
            style={[styles.primary, { backgroundColor: colors.primary }]}
            onPress={() => setStep(4)}
            disabled={busy}
            accessibilityRole="button"
            testID="smart-project-continue"
          >
            <Text style={styles.primaryText}>
              {photos.length
                ? `Continue with ${photos.length} photo${photos.length === 1 ? '' : 's'}`
                : 'Continue'}
            </Text>
          </Pressable>
        )}

        {step === 4 && (
          <Pressable
            style={[
              styles.primary,
              {
                backgroundColor: canGenerate ? colors.primary : colors.borderColor,
              },
            ]}
            onPress={onGenerate}
            disabled={busy || !canGenerate}
            accessibilityRole="button"
            testID="smart-project-generate"
          >
            <Text style={styles.primaryText}>
              {busy ? 'Drafting…' : 'Draft my project'}
            </Text>
          </Pressable>
        )}

        {step === 5 && (
          <Pressable
            style={[styles.secondary, { borderColor: colors.borderColor }]}
            onPress={failed ? () => setStep(LAST_STEP) : onCancel}
            accessibilityRole="button"
            testID="smart-project-cancel"
          >
            <Text style={{ color: colors.textSecondary }}>
              {failed ? 'Back' : 'Cancel'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* Mounted at the wizard, not inside the step, so it survives the step's
          re-render on every add and remove — a modal remounted mid-gesture
          loses the crop the member is framing. */}
      <SmartProjectPhotoEditor
        photo={editing != null ? (photos[editing] ?? null) : null}
        index={editing ?? 0}
        total={photos.length}
        onCancel={() => setEditing(null)}
        onSave={edit => {
          setPhotos(prev =>
            prev.map((p, i) =>
              i === editing
                ? {
                    ...p,
                    uri: edit.uri,
                    width: edit.width,
                    height: edit.height,
                    note: edit.note,
                  }
                : p,
            ),
          );
          setEditing(null);
        }}
        onDelete={() => {
          setPhotos(prev => prev.filter((_, i) => i !== editing));
          setEditing(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  step: { fontSize: 13, marginBottom: 8 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  help: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  textarea: {
    minHeight: 160,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    fontSize: 15,
    lineHeight: 21,
  },
  // Step 1's guidance and example.
  tips: { marginBottom: 16, gap: 6 },
  tipsTitle: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  tipRow: { flexDirection: 'row', alignItems: 'flex-start' },
  tipBullet: { fontSize: 13, lineHeight: 19, width: 14 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 19 },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  counter: { fontSize: 12, marginTop: 8 },
  exampleToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  exampleToggleText: { fontSize: 13, fontWeight: '600' },
  exampleCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginTop: 10,
    gap: 10,
  },
  exampleBody: { fontSize: 14, lineHeight: 20 },
  exampleUse: { fontSize: 13, fontWeight: '600' },
  spaceCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  input: { fontSize: 16, fontWeight: '600', paddingVertical: 6 },
  dimRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pitchToggle: { fontSize: 13, fontWeight: '600', marginTop: 10 },
  dimHint: { fontSize: 12, lineHeight: 16, marginTop: 6 },
  dimField: { flex: 1 },
  dimLabel: { fontSize: 12, marginBottom: 4 },
  dimInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 15,
  },
  addSpace: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  // Step 4. The border carries the checked state as well as the icon does —
  // one tick in a column of three is easy to miss on a phone in daylight.
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  sectionBody: { flex: 1 },
  sectionLabel: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  sectionDetail: { fontSize: 13, lineHeight: 19 },
  generating: { alignItems: 'center', paddingTop: 64, gap: 12 },
  primary: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerRow: { flexDirection: 'row', gap: 12 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    // Matches the template wizard: tall enough that the glass fade starts well
    // above the button, so its top edge reads as transparent rather than a line.
    paddingTop: 32,
    overflow: 'hidden',
  },
});
