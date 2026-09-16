/**
 * The surface editor's state: one document, an undo stack, and a save that
 * cannot lose an edit.
 *
 * ## Why the draft is local and the save is explicit-plus-debounced
 *
 * The document is written to `home_project_geometry` as **one value** under
 * last-writer-wins (see the contract header) — so a save is not a patch, it is
 * a replacement of the whole layout. Two consequences follow and both are
 * designed for here:
 *
 *  - **Saving on every drag frame would be indefensible.** Sixty writes a
 *    second through the ledger, each one a full document, each one a chance for
 *    a peer's concurrent edit to be clobbered by a frame of a gesture nobody
 *    finished. So edits accumulate in a draft and are committed on a gesture
 *    boundary, debounced.
 *  - **A draft that is silently dropped is a member's work gone.** `dirty` is
 *    exposed so the screen can block a back-press, and `save()` is idempotent
 *    so the blocking path can call it without worrying about the timer.
 *
 * ## Refetch does not clobber a draft
 *
 * The hub refetches on window focus. Without a guard, backgrounding the app
 * mid-edit and returning would replace the member's unsaved room with the
 * stored one. `serverModelRef` therefore tracks the payload the draft was
 * seeded from, and an incoming payload only reseeds the draft when the draft is
 * clean — otherwise it is held, and `remoteChanged` tells the screen that a
 * peer has edited the same room so it can offer the choice rather than take it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { HomeProjectAttachment } from '@api/home-projects';
import { homeProjectsApi } from '@api/home-projects';
import {
  createDefaultRoomSurfaceModel,
  loadRoomSurfaceModel,
  reconcileSurfaces,
  sameSurfaceModel,
  serializeRoomSurfaceModel,
  type SurfaceModelOrigin,
} from '@features/house/surfaces';
import type { Material, RoomSurfaceModel } from '@symply/contracts';

/**
 * The H6 blob store, typed but not imported.
 *
 * `useTextureUris` requires it lazily (see the call site) so that a static
 * import does not pull the crypto polyfill and the ledger into every screen
 * that renders a swatch. The alias exists so the `require` fits on one line and
 * its `eslint-disable-next-line` therefore lands on the right line — prettier
 * wraps a longer assignment and silently detaches the two.
 */
type HouseBlobs = typeof import('@features/house/local/blobs');

/** How long after the last edit a save fires, ms. */
const AUTOSAVE_MS = 1200;
/** Deepest undo history. Enough to walk back a bad idea, bounded for memory. */
const UNDO_LIMIT = 40;

export interface UseRoomSurfaceModelResult {
  model: RoomSurfaceModel | null;
  origin: SurfaceModelOrigin;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /** A peer changed the stored layout while this draft was unsaved. */
  remoteChanged: boolean;
  canUndo: boolean;
  canRedo: boolean;

  /** Replace the document. `reconcile` re-derives walls after a plan edit. */
  update: (
    next: RoomSurfaceModel | ((current: RoomSurfaceModel) => RoomSurfaceModel),
    options?: { reconcile?: boolean; history?: boolean },
  ) => void;
  /** Start a room where there was none. */
  start: (model?: RoomSurfaceModel) => void;
  save: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** Throw the draft away and take what the server/ledger holds. */
  discard: () => void;
  /** Delete the stored layout entirely, back to "no room yet". */
  clear: () => Promise<void>;
  staleWallIds: string[];
  orphanedWallIds: string[];
}

export function useRoomSurfaceModel(input: {
  householdId: string | undefined;
  projectId: string;
  payloadJson: string | null | undefined;
  /** `home_project_geometry.id`, needed to delete the layout. */
  geometryId?: string | null;
  onSaved?: () => void;
}): UseRoomSurfaceModelResult {
  const { householdId, projectId, payloadJson, geometryId, onSaved } = input;

  const loaded = useMemo(
    () => loadRoomSurfaceModel(payloadJson),
    [payloadJson],
  );
  const [model, setModel] = useState<RoomSurfaceModel | null>(loaded.model);
  const [origin, setOrigin] = useState<SurfaceModelOrigin>(loaded.origin);
  const [dirty, setDirty] = useState(loaded.needsSave);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [staleWallIds, setStaleWallIds] = useState<string[]>([]);
  const [orphanedWallIds, setOrphanedWallIds] = useState<string[]>([]);

  // The stacks are refs — they are written from inside a `setModel` updater and
  // from gesture callbacks, where a state write would either batch away or
  // re-run the updater. `historyDepth` is the render-visible projection of
  // them, and is the only thing `canUndo`/`canRedo` read.
  const undoStack = useRef<RoomSurfaceModel[]>([]);
  const redoStack = useRef<RoomSurfaceModel[]>([]);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const syncHistoryDepth = useCallback(() => {
    setHistoryDepth({
      undo: undoStack.current.length,
      redo: redoStack.current.length,
    });
  }, []);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const modelRef = useRef(model);
  modelRef.current = model;
  const lastLoadedRef = useRef<string | null | undefined>(payloadJson);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Counts EDITS, not renders — the debounce's restart signal. See the effect
   * at the bottom of this hook.
   */
  const [editVersion, setEditVersion] = useState(0);
  /** `onSaved` is a caller's closure; holding it in a ref keeps `saveModel` stable. */
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  /** Adopt a stored payload wholesale, dropping any history it invalidates. */
  const applyLoaded = useCallback(
    (incoming: ReturnType<typeof loadRoomSurfaceModel>) => {
      undoStack.current = [];
      redoStack.current = [];
      modelRef.current = incoming.model;
      syncHistoryDepth();
      setModel(incoming.model);
      setOrigin(incoming.origin);
      setDirty(incoming.needsSave);
      setRemoteChanged(false);
    },
    [syncHistoryDepth],
  );

  // ---- incoming payload ---------------------------------------------------
  useEffect(() => {
    if (payloadJson === lastLoadedRef.current) return;
    lastLoadedRef.current = payloadJson;
    const incoming = loadRoomSurfaceModel(payloadJson);
    if (dirtyRef.current) {
      // Held rather than applied. Reseeding here is how an editor eats an edit
      // the member is still making, and a focus refetch is the commonest way to
      // get here.
      if (
        incoming.model &&
        modelRef.current &&
        !sameSurfaceModel(incoming.model, modelRef.current)
      ) {
        setRemoteChanged(true);
      }
      return;
    }
    applyLoaded(incoming);
  }, [payloadJson, applyLoaded]);

  // ---- saving -------------------------------------------------------------
  /**
   * Write one document, now.
   *
   * Takes the model rather than reading state so that `start` can persist a
   * room in the same tick it creates it — there is no render between the two,
   * so anything reading `model` would still see the old value.
   */
  const saveModel = useCallback(
    async (candidate: RoomSurfaceModel) => {
      if (!householdId) return;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setSaving(true);
      setError(null);
      try {
        await homeProjectsApi.putManualGeometry(
          householdId,
          projectId,
          serializeRoomSurfaceModel(candidate),
        );
        // Only the draft that was actually written is marked clean. An edit
        // that landed while the request was in flight must stay dirty, or the
        // autosave that fired mid-gesture would silently drop the rest of it.
        if (modelRef.current && sameSurfaceModel(modelRef.current, candidate)) {
          setDirty(false);
          setRemoteChanged(false);
          setOrigin('v2');
        }
        onSavedRef.current?.();
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : 'Could not save the room layout.',
        );
      } finally {
        setSaving(false);
      }
    },
    [householdId, projectId],
  );

  const save = useCallback(async () => {
    const current = modelRef.current;
    if (!current) return;
    await saveModel(current);
  }, [saveModel]);

  const saveRef = useRef(save);
  saveRef.current = save;

  // ---- editing ------------------------------------------------------------
  /**
   * Every mutation goes through here, and none of it happens inside a
   * `setModel` updater.
   *
   * An updater must be pure — React may call it twice in development, and it
   * runs at render time rather than at call time. Pushing an undo frame in
   * there would double the history under StrictMode, and `syncHistoryDepth()`
   * called beside it would read the stacks before the updater had touched them.
   * So the next document is computed from `modelRef` (which is assigned on
   * every render *and* here), the refs are updated, and `setModel` is handed a
   * finished value.
   *
   * Writing `modelRef.current` eagerly is what makes a drag work: a pan emits
   * several updates inside one frame, and each has to see the previous one.
   */
  const update = useCallback<UseRoomSurfaceModelResult['update']>(
    (next, options) => {
      const current = modelRef.current;
      if (!current) return;
      const resolved = typeof next === 'function' ? next(current) : next;
      if (sameSurfaceModel(resolved, current)) return;

      if (options?.history !== false) {
        undoStack.current = [...undoStack.current, current].slice(-UNDO_LIMIT);
        redoStack.current = [];
      }

      let final = resolved;
      if (options?.reconcile) {
        const reconciled = reconcileSurfaces(resolved);
        setStaleWallIds(reconciled.staleWallIds);
        setOrphanedWallIds(reconciled.orphanedWallIds);
        final = reconciled.model;
      }

      modelRef.current = final;
      syncHistoryDepth();
      setModel(final);
      setDirty(true);
      setEditVersion(version => version + 1);
      setError(null);
    },
    [syncHistoryDepth],
  );

  /**
   * Create the room, and write it immediately.
   *
   * Deliberately NOT debounced. The debounce exists so a drag does not put
   * sixty documents through the ledger; creating a room is a single explicit
   * tap on "Create the room", and leaving it to a timer means a member who
   * backgrounds the app or loses the screen in the next second has nothing.
   * `saveModel` takes the document rather than reading state because there is
   * no render between these two lines.
   */
  const start = useCallback(
    (seed?: RoomSurfaceModel) => {
      const next = seed ?? createDefaultRoomSurfaceModel();
      undoStack.current = [];
      redoStack.current = [];
      modelRef.current = next;
      syncHistoryDepth();
      setModel(next);
      setOrigin('v2');
      setDirty(true);
      setEditVersion(version => version + 1);
      void saveModel(next);
    },
    [syncHistoryDepth, saveModel],
  );

  /**
   * Throw the room away.
   *
   * Removes the stored geometry rather than writing an empty document: an
   * empty `RoomSurfaceModel` is not a thing the schema can express (a room has
   * an outline), and a project with no layout is exactly the state a project
   * starts in. `cancelGeometry` is the existing delete on both backends.
   */
  const clear = useCallback(async () => {
    if (!householdId || !geometryId) {
      applyLoaded({ model: null, origin: 'empty', needsSave: false });
      return;
    }
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setSaving(true);
    setError(null);
    try {
      await homeProjectsApi.cancelGeometry(householdId, projectId, geometryId);
      applyLoaded({ model: null, origin: 'empty', needsSave: false });
      onSavedRef.current?.();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not delete the room layout.',
      );
    } finally {
      setSaving(false);
    }
  }, [householdId, projectId, geometryId, applyLoaded]);

  const undo = useCallback(() => {
    const previous = undoStack.current[undoStack.current.length - 1];
    if (!previous) return;
    const current = modelRef.current;
    undoStack.current = undoStack.current.slice(0, -1);
    if (current)
      redoStack.current = [...redoStack.current, current].slice(-UNDO_LIMIT);
    modelRef.current = previous;
    syncHistoryDepth();
    setModel(previous);
    setDirty(true);
    setEditVersion(version => version + 1);
  }, [syncHistoryDepth]);

  const redo = useCallback(() => {
    const next = redoStack.current[redoStack.current.length - 1];
    if (!next) return;
    const current = modelRef.current;
    redoStack.current = redoStack.current.slice(0, -1);
    if (current)
      undoStack.current = [...undoStack.current, current].slice(-UNDO_LIMIT);
    modelRef.current = next;
    syncHistoryDepth();
    setModel(next);
    setDirty(true);
    setEditVersion(version => version + 1);
  }, [syncHistoryDepth]);

  const discard = useCallback(() => {
    applyLoaded(loadRoomSurfaceModel(payloadJson));
  }, [payloadJson, applyLoaded]);

  /**
   * The debounce, armed once per edit rather than once per render.
   *
   * `model` and `save` are deliberately NOT dependencies. Including them meant
   * the effect tore down and re-armed its timer on every render, so a screen
   * that re-rendered faster than the debounce — a focus refetch is enough —
   * never reached the end of it and never wrote. `editVersion` ticks once per
   * actual edit, which is exactly when the timer should restart, and `save` is
   * read through a ref so its identity cannot matter.
   */
  useEffect(() => {
    if (!dirty || !householdId) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void saveRef.current();
    }, AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [dirty, editVersion, householdId]);

  return {
    model,
    origin,
    dirty,
    saving,
    error,
    remoteChanged,
    canUndo: historyDepth.undo > 0,
    canRedo: historyDepth.redo > 0,
    update,
    start,
    save,
    undo,
    redo,
    discard,
    clear,
    staleWallIds,
    orphanedWallIds,
  };
}

// ---------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------

/**
 * Attachment id → a URI an `<Image>` can render.
 *
 * The two backends address bytes in ways that have nothing in common: a
 * server-backed household has an R2 `url` on the row, a local-first one has a
 * sealed `HouseBlobDescriptor` whose plaintext has to be fetched, decrypted,
 * hash-checked and written to the cache directory before anything can draw it.
 * Resolving here rather than inside the renderer is what keeps `SurfaceCanvas`
 * a pure drawing component that works in a unit test with no ledger at all.
 *
 * **Cached blobs only, and never a fetch.** `HouseBlobImage` exists for the
 * full policy — the cellular prompt, the four named failure states — and a
 * surface canvas can be showing a dozen materials at once. Silently pulling a
 * dozen encrypted files down a member's mobile data to draw thumbnails is the
 * behaviour that policy was written to forbid, so an unresolved texture simply
 * falls back to the material's colour, which is why the contract makes
 * `colorHex` required.
 */
export function useTextureUris(
  attachments: HomeProjectAttachment[] | undefined,
  householdId: string | undefined,
): Record<string, string | undefined> {
  const [uris, setUris] = useState<Record<string, string | undefined>>({});

  const textures = useMemo(
    () =>
      (attachments ?? []).filter(
        row => row.kind === 'texture' && row.status === 'ready',
      ),
    [attachments],
  );
  // The id/url pairs, as a stable string — so the effect re-runs when a texture
  // is added and not when an unrelated part of the hub changes identity.
  const signature = useMemo(
    () =>
      textures
        .map(row => `${row.id}:${row.url ?? row.blob?.blobId ?? ''}`)
        .join('|'),
    [textures],
  );

  useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      const next: Record<string, string | undefined> = {};
      for (const row of textures) {
        if (row.url) {
          next[row.id] = row.url;
          continue;
        }
        if (!row.blob) continue;
        try {
          // Required lazily, exactly as `src/api/home-projects.ts` requires its
          // local facade: a static import would pull the H6 blob store — and
          // through it the crypto polyfill and the ledger — into every screen
          // that renders a swatch, including on a household that has no
          // local-first session at all.
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const blobs = require('@features/house/local/blobs') as HouseBlobs;
          if (!(await blobs.isHouseBlobCached(row.blob.blobId))) continue;
          next[row.id] = await blobs.resolveHouseBlobUri(row.blob, {
            householdId,
          });
        } catch {
          // A texture that will not open is a colour swatch, not an error
          // banner: the surface still draws and the member still gets their
          // quantities. `HouseBlobImage` is where a member is told why.
        }
      }
      if (!cancelled) setUris(next);
    };
    void resolve();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, householdId]);

  return uris;
}

/** How many regions across the whole room use a given material. */
export function countMaterialUsage(
  model: RoomSurfaceModel | null,
  materialId: string,
): number {
  if (!model) return 0;
  let count = 0;
  for (const surface of model.surfaces) {
    if (surface.materialId === materialId) count += 1;
    for (const area of surface.subAreas) {
      if (area.materialId === materialId) count += 1;
    }
  }
  return count;
}

/** Remove a material from the palette and from every region that used it. */
export function withMaterialRemoved(
  model: RoomSurfaceModel,
  materialId: string,
): RoomSurfaceModel {
  return {
    ...model,
    materials: model.materials.filter(material => material.id !== materialId),
    surfaces: model.surfaces.map(surface => ({
      ...surface,
      materialId: surface.materialId === materialId ? null : surface.materialId,
      subAreas: surface.subAreas.map(area => ({
        ...area,
        materialId: area.materialId === materialId ? null : area.materialId,
      })),
    })),
  };
}

/** Insert or replace a material in the palette, preserving order. */
export function withMaterialUpserted(
  model: RoomSurfaceModel,
  material: Material,
): RoomSurfaceModel {
  const exists = model.materials.some(entry => entry.id === material.id);
  return {
    ...model,
    materials: exists
      ? model.materials.map(entry =>
          entry.id === material.id ? material : entry,
        )
      : [...model.materials, material],
  };
}
