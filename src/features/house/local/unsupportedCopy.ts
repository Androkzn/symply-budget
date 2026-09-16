/**
 * Member-facing copy for the P4-disabled features (plan §9, DoD H7).
 *
 * The DoD line is *"Every P4 feature shows explicit member-facing copy in the
 * House brand voice (no raw error strings)."* Until this file, every disabled
 * method threw the same developer sentence with its own identifier embedded —
 * `House local-first: "garbage-collection.aiDetect" is not available offline
 * yet.` A screen rendering `error.message` put that identifier in front of a
 * member, which is precisely the raw error string the DoD rules out.
 *
 * **Why these features are off rather than degraded.** They are P4 in the locked
 * assignment because each one needs a server that can read the household's
 * data — AI vision over a photo, an LLM comparing quotes, a model drafting
 * tasks. Under E2EE the Worker holds ciphertext, so there is nothing for it to
 * read. The honest resolution is to say so, not to show an empty state that
 * looks like a bug or a spinner that never resolves.
 *
 * Each entry answers the two questions a member actually has — *what can't I do*
 * and *what do I do instead* — and neither mentions encryption mechanics, method
 * names or the word "unsupported". Voice matches
 * `getHouseLocalRemindersCopy()`: plain, second person, no apology, no jargon.
 */

export type HouseUnsupportedCopy = {
  title: string;
  message: string;
  /**
   * True when connecting an AI provider genuinely turns this back on.
   *
   * It drives a second button — "Add AI provider" beside "Maybe later" — so a
   * member who wants the feature has somewhere to go instead of a dead end.
   * Set it ONLY where a key really is the missing piece: the encrypted file
   * channel, the contractor marketplace, the retired satellite flows and the
   * join table that has no row key on any backend are all unaffected by one,
   * and a button promising otherwise is a lie the member disproves in thirty
   * seconds.
   */
  needsAiProvider?: true;
};

/**
 * Keyed by the exact string passed to `HouseLocalUnsupportedError`, so the map
 * and the throw sites cannot drift apart — `unsupportedCopy.test.ts` walks the
 * source and fails if a throw site has no entry.
 */
export const HOUSE_UNSUPPORTED_COPY: Record<string, HouseUnsupportedCopy> = {
  'garbage-collection.aiDetect': {
    title: 'Reading a photo of your bins needs an AI provider',
    message:
      'Symply will not send the picture to our servers — your home data stays on your devices — but it can hand it to an AI provider you connect yourself and read the schedule off it here. You can also set your collection days by hand once and Symply keeps them, including holiday shifts, from then on.',
    needsAiProvider: true,
  },
  'task-drafts.generate': {
    title: 'Drafting tasks for you needs an AI provider',
    message:
      'Turning a description into a task list takes a model. Connect your own provider and Symply will do it on this device, paying the provider directly. You can still add tasks yourself in the meantime, and every template Symply ships works offline.',
    needsAiProvider: true,
  },
  'tasks.requestTaskQuotes': {
    title: 'Quote requests are off in private mode',
    message:
      'Sending a job to contractors means sharing your home details with them through our servers, which private mode deliberately prevents. Contact details for saved contractors still work, so you can reach out directly.',
  },
  'tasks.getTaskQuotes': {
    title: 'Quotes are off in private mode',
    message:
      'Quotes arrive through our servers, and private mode keeps your home data off them. Anything a contractor sends you directly can be saved to the task as a note or a document.',
  },
  'tasks.compareTaskQuotesWithAI': {
    title: 'Comparing quotes for you needs an AI provider',
    message:
      'Weighing quotes against each other takes a model that can read them. Connect your own provider and Symply will do the comparison here, on this device. Every quote stays on the task either way, side by side, for you to judge yourself.',
    needsAiProvider: true,
  },
  'tasks.createBudgetItemFromTask': {
    title: 'Sending costs to Budget is off in private mode',
    message:
      'Symply Budget keeps its own private ledger, so a task cannot post a cost into it automatically. Add the amount in Budget and it will stay in step.',
  },
  //
  // `appliancesApi.addDocument` and `appliancesApi.getDocuments` had entries
  // here until 2026-08-15, both saying appliance manuals were "not on this
  // build yet" because the encrypted file channel was "on its way". Both facts
  // had stopped being true: H6 shipped, and what was actually missing was a
  // registry entry for `appliance_documents` (`schema.ts`). The two methods are
  // now real ledger operations, so the copy is DEAD — and dead copy is drift
  // between the map and the code, which is why `unsupportedCopy.test.ts` fails
  // on an entry whose method no longer throws rather than tolerating it.
  //
  /**
   * B1's two throw sites are the direct-to-storage transfer, not the paperwork
   * itself: the document ROW is ledgered and lists offline, so the honest thing
   * to name is the file, not the record.
   */
  'contractorsApi.getUploadUrl': {
    title: 'Contractor paperwork is not on this build yet',
    message:
      'Keeping receipts and invoices privately needs the encrypted file channel, which is on its way. Everything else about a contractor works now — their details, every visit, what it cost and the notes you took.',
  },
  'contractorsApi.uploadDocument': {
    title: 'Contractor paperwork is not on this build yet',
    message:
      'Keeping receipts and invoices privately needs the encrypted file channel, which is on its way. Everything else about a contractor works now — their details, every visit, what it cost and the notes you took.',
  },
  'contractorsApi.aiLookup': {
    title: 'Filling in a company for you needs an AI provider',
    message:
      'Looking a business up and filling in its phone, address and hours takes a model. Connect your own provider and Symply will do it from this device. Adding the details by hand works too, and the rest of the contractor record is fully local.',
    needsAiProvider: true,
  },
  /**
   * B2's two throw sites. Neither names the thing the member came for — a quote
   * is fully local now, so the honest thing to name is the ONE part that is not:
   * the ranking, and the file behind it.
   */
  'quotesApi.compareWithAI': {
    title: 'Ranking quotes for you needs an AI provider',
    message:
      'Weighing prices, warranties and your own notes against each other takes a model. Connect your own provider and Symply will rank them here. Without one it still lines every quote up side by side and marks the cheapest, the quickest and the longest warranty.',
    needsAiProvider: true,
  },
  'quotesApi.getDocumentUrl': {
    title: 'Quote documents are not on this build yet',
    message:
      'Opening an estimate a contractor sent you needs the encrypted file channel, which is on its way. Everything else about a quote works now — the amount, what it covers, when it runs out, and whether you accepted or turned it down.',
  },
  /**
   * B4's four throw sites, and the first sub-wave where one of them is NOT about
   * files or models. The visit checklist itself is entirely local — every
   * question, tick, comment, photo and voice note — so each entry has to name
   * the narrow thing that is off and get out of the way.
   */
  'visitChecklistsApi.createFromTemplate': {
    title: 'Starter checklists come from our servers',
    message:
      'The ready-made question sets live on our servers rather than on your phone, so Symply cannot build one for you here. Start a checklist and add your own questions instead — they save straight to your devices and work with no signal at all.',
  },
  'visitChecklistsApi.generateAISuggestions': {
    title: 'Suggesting questions for you needs an AI provider',
    message:
      'Working out what to ask a contractor about your job takes a model that can read the job. Connect your own provider and Symply will draft the questions on this device. Questions you write yourself work on site with no signal at all.',
    needsAiProvider: true,
  },
  'visitChecklistsApi.startAIConversation': {
    title: 'Explaining the jargon needs an AI provider',
    message:
      'Looking up what a term means in the context of your home takes a model. Connect your own provider and Symply will answer here, using your key. Every question you saved still works on site, and you can note the answer against any of them.',
    needsAiProvider: true,
  },
  'visitChecklistsApi.sendAIMessage': {
    title: 'Explaining the jargon needs an AI provider',
    message:
      'Looking up what a term means in the context of your home takes a model. Connect your own provider and Symply will answer here, using your key. Every question you saved still works on site, and you can note the answer against any of them.',
    needsAiProvider: true,
  },
  /**
   * C1's four throw sites, and all four are the same thing said about four
   * documents: reading a PDF needs the bytes on a server and a model over them.
   * Each entry names the document rather than the mechanism, and each is careful
   * to say that the RECORD is fully local — every figure a scan would have
   * filled in can be typed, and a bill entered by hand is indistinguishable from
   * an extracted one once it is saved.
   */
  'utilitiesApi.uploadAndExtractBill': {
    title: 'Scanning a bill for you needs an AI provider',
    message:
      'Pulling the amount, the dates and the usage off a bill takes a model that can read the document. Symply will not send it to our servers, but it will hand it to a provider you connect yourself. Typing the few figures from the front page works too — everything after that is identical.',
    needsAiProvider: true,
  },
  'utilitiesApi.extractBillFromDocument': {
    title: 'Scanning a bill for you needs an AI provider',
    message:
      'Pulling the amount, the dates and the usage off a bill takes a model that can read the document. Symply will not send it to our servers, but it will hand it to a provider you connect yourself. Typing the few figures from the front page works too — everything after that is identical.',
    needsAiProvider: true,
  },
  'utilitiesApi.uploadAndExtractPropertyTax': {
    title: 'Scanning a tax notice needs an AI provider',
    message:
      'Reading your property tax notice takes a model that can see the document, and Symply will only hand it to a provider you connect yourself. Entering the year, the amount and the due date by hand works just as well — Symply still tracks what you owe, warns you before the deadline and reminds you to claim the grant.',
    needsAiProvider: true,
  },
  'utilitiesApi.uploadAndExtractAssessment': {
    title: 'Scanning an assessment needs an AI provider',
    message:
      'Reading your assessment notice takes a model that can see the document, and Symply will only hand it to a provider you connect yourself. Entering the year and the assessed value by hand works too — the value history, the land and building split, the change from last year and the appeal deadline all still work.',
    needsAiProvider: true,
  },
  /**
   * C2's eight throw sites, in three groups, and the sub-wave with the most
   * throws of any so far.
   *
   * The hard part here is that a floor plan IS a picture, so unlike B1's
   * documents and B3's photos there is no "the record still works" half to
   * point at — until the encrypted file channel carries images, the feature
   * genuinely cannot start. The three upload entries say so plainly and name
   * what the app still does with the home instead, rather than implying a
   * workaround that does not exist.
   */
  'floorPlansApi.getUploadUrl': {
    title: 'Adding a floor plan is not on this build yet',
    message:
      'A plan is a picture of your home, so keeping one privately needs the encrypted file channel, which is on its way. Until then you can still map the house room by room in Spaces, and every task, appliance and note you file against a room keeps working.',
  },
  'floorPlansApi.uploadFile': {
    title: 'Adding a floor plan is not on this build yet',
    message:
      'A plan is a picture of your home, so keeping one privately needs the encrypted file channel, which is on its way. Until then you can still map the house room by room in Spaces, and every task, appliance and note you file against a room keeps working.',
  },
  'floorPlansApi.confirmUpload': {
    title: 'Adding a floor plan is not on this build yet',
    message:
      'A plan is a picture of your home, so keeping one privately needs the encrypted file channel, which is on its way. Until then you can still map the house room by room in Spaces, and every task, appliance and note you file against a room keeps working.',
  },
  /**
   * The two model runs. Each names what the model would have done rather than
   * the model, and each is careful that everything a member can do BY HAND on a
   * plan they already have — pins, labels, lines, measurements, renaming the
   * floors — is fully local.
   */
  'floorPlansApi.triggerAnalysis': {
    title: 'Reading your floor plan needs an AI provider',
    message:
      'Working out the rooms, their sizes and the total area takes a model that can look at the drawing. Connect your own provider and Symply will run it from this device. Naming floors and areas, dropping pins, drawing and measuring are all local and work with no signal.',
    needsAiProvider: true,
  },
  'floorPlansApi.triggerVectorization': {
    title: 'Redrawing your plan as a diagram needs an AI provider',
    message:
      'Turning a scanned drawing into a clean diagram takes a model that can see the picture. Connect your own provider and Symply will do it here. The plan you already have still opens, zooms and prints, and everything you add on top of it keeps working.',
    needsAiProvider: true,
  },
  /**
   * The two region methods that still throw. "Region" is our word, not a
   * member's, so the copy names what a member sees instead: the plan being split
   * into separate floors and outbuildings.
   *
   * `listRegions` used to be here and is not any more — `floor_plan_regions` is
   * ledgered since the H13 D-wave, so READING the split works offline. Only
   * producing it needs a server that can look at the picture.
   */
  'floorPlansApi.processPendingRegions': {
    title: 'Splitting a plan into floors needs an AI provider',
    message:
      'Finding each floor and outbuilding on a drawing and cutting them out takes a model that can look at the picture. Connect your own provider and Symply will do it from this device. Marking the areas yourself in the area editor works everywhere the automatic version would have.',
    needsAiProvider: true,
  },
  'floorPlansApi.retryRegion': {
    title: 'Splitting a plan into floors needs an AI provider',
    message:
      'Finding each floor and outbuilding on a drawing and cutting them out takes a model that can look at the picture. Connect your own provider and Symply will do it from this device. Marking the areas yourself in the area editor works everywhere the automatic version would have.',
    needsAiProvider: true,
  },
  /**
   * C3's eight throw sites, in three groups — and the third group is a shape no
   * previous sub-wave has had.
   *
   * The first two groups are the familiar ones and are written the way C2's are:
   * a yard plan is a picture, so the upload entries cannot promise "the record
   * still works", and the generation entries name what the drawing would have
   * been rather than the model that would have drawn it.
   *
   * The third group is different and the copy has to be honest about it. The
   * satellite lot tracing is not off in private mode — it was retired for
   * EVERYONE, and the server answers every household the same way. Copy that
   * blamed private mode would be a lie a member could disprove by turning it
   * off, so those two entries say the feature is gone and point at the two paths
   * that remain.
   */
  'gardenPlansApi.getUploadUrl': {
    title: 'Adding a yard plan is not on this build yet',
    message:
      'A yard plan is a photo of your garden, so keeping one privately needs the encrypted file channel, which is on its way. Until then you can still map the outdoors space by space, and every task, plant note and reminder you file against one keeps working.',
  },
  'gardenPlansApi.uploadFile': {
    title: 'Adding a yard plan is not on this build yet',
    message:
      'A yard plan is a photo of your garden, so keeping one privately needs the encrypted file channel, which is on its way. Until then you can still map the outdoors space by space, and every task, plant note and reminder you file against one keeps working.',
  },
  'gardenPlansApi.confirmUpload': {
    title: 'Adding a yard plan is not on this build yet',
    message:
      'A yard plan is a photo of your garden, so keeping one privately needs the encrypted file channel, which is on its way. Until then you can still map the outdoors space by space, and every task, plant note and reminder you file against one keeps working.',
  },
  /**
   * The model run and the two controls that drive the job behind it. All three
   * name the drawing rather than the model, and all three are careful that
   * everything a member does BY HAND on a plan they already have — moving trees
   * and beds, tracing the lot, dropping pins, labelling — is fully local.
   */
  'gardenPlansApi.generateFromBoundaryDraft': {
    title: 'Drawing a garden design needs an AI provider',
    message:
      'Turning your lot and a few preferences into a designed layout takes a model that can draw it. Connect your own provider and Symply will ask it from this device. Laying a yard out by hand is fully local — trees, beds, paths and patios all place, resize and rotate, and every change saves to your devices.',
    needsAiProvider: true,
  },
  'gardenPlansApi.cancelGeneration': {
    title: 'There is no design being drawn to stop',
    message:
      'Designs are drawn on our servers, and private mode keeps your garden on your devices instead, so nothing is ever queued here to cancel. Any yard plan you added yourself is already saved, and you can edit or remove it whenever you like.',
  },
  'gardenPlansApi.retryGeneration': {
    title: 'Asking again for a design needs an AI provider',
    message:
      'Drawing a garden layout takes a model. Connect your own provider and Symply will ask it again from this device, using your key. Laying the garden out by hand works with no signal at all, and everything you place is kept.',
    needsAiProvider: true,
  },
  /**
   * The retired satellite flow. Not a private-mode limitation — the map preview
   * was removed for every household — so the copy says so, and points at the two
   * routes that still exist: your own photo, or asking Mira for a concept.
   */
  'gardenPlansApi.createBoundaryDraft': {
    title: 'Tracing your lot from the map was retired',
    message:
      'Symply used to trace your property line from a satellite view, and that has been switched off for everyone rather than just in private mode. You can still start a yard plan from a photo of your garden and draw the boundary on it yourself, or ask Mira for a concept design.',
  },
  'gardenPlansApi.confirmBoundaryDraft': {
    title: 'Confirming a lot from the map was retired',
    message:
      'The satellite view Symply used to confirm a property line against has been switched off for everyone, so there is nothing here to confirm. Starting from a photo of your garden still works, and you can draw and adjust the boundary on the plan itself whenever you like.',
  },
  /**
   * C4's thirteen throw sites, in five groups — the most of any sub-wave, and
   * the sub-wave where the copy had the easiest job it has ever had.
   *
   * Every other block in this file has to explain a hole in a feature that is
   * otherwise whole. Here the project itself is completely local — the plan, the
   * budget, every selection, the schedule, the blockers, the comments, the
   * history and the shareable summary all work with no signal — so each entry
   * can name one narrow thing and get out of the way. Where an entry has a real
   * one-tap workaround it says so in plain words rather than gesturing at "you
   * can still…".
   */

  /*
   * The three photo methods USED to sit here, on copy that said the encrypted
   * file channel was "on its way". It had already shipped — H6 is live, and
   * `localTasksApi` and `localAppliancesApi` were both sealing bytes through it
   * — and `home_project_attachments` was already a registered ledger table, so
   * unlike the appliance-document case there was not even a missing registry
   * entry left to explain the gap. `createAttachmentUpload`,
   * `uploadAttachmentBytes` and `uploadSelectionPhoto` are now ordinary ledger
   * operations that seal through `uploadHouseBlob`, so their entries are gone:
   * `unsupportedCopy.test.ts` treats copy for a method that no longer throws as
   * drift between this map and the code.
   */

  /**
   * The four geometry methods. "Geometry" is our word, so the copy names what a
   * member sees: room measurements, a scan of the room, and a drawn layout.
   * Symply re-derives this kind of thing on the device or leaves it off, so
   * these say the measurements live on our servers rather than blaming a model.
   */
  'homeProjectsApi.enqueueAiSchematic': {
    title: 'Drawing a schematic for you needs an AI provider',
    message:
      'Turning your measurements into a drawing takes a model. Connect your own provider and Symply will run it here, on this device. Every figure the schematic would have been built from still works without one — the room, its surfaces and the takeoff are all computed on this device.',
    needsAiProvider: true,
  },

  /**
   * Smart Project — the seven describe-to-draft methods.
   *
   * These are the one group in this file that is NOT "connect a provider and it
   * runs here", and the copy must not imply otherwise: drafting a project
   * writes a whole project — its stages, its surfaces, its materials — and on
   * this device those live in your own ledger, while the drafting itself
   * happens on our servers. There is no version of it that runs locally, so
   * `needsAiProvider` is deliberately absent. Offering an "Add AI provider"
   * button here would send a member to buy something that would not help.
   *
   * The copy points at the template path every time, because that path is
   * complete on device and gets them the same project a few taps later. Nothing
   * about the feature is degraded for them — only the drafting is unavailable.
   */
  'homeProjectsApi.startSmartDraft': {
    title: 'Drafting a project from a description happens on our servers',
    message:
      'Describing a project and having it drafted for you needs to run on our servers, and your projects live on this device. Pick a template instead — it fills in the same stages, decisions and budget lines, and everything after that works exactly the same.',
  },
  'homeProjectsApi.getSmartDraft': {
    title: 'Drafting a project from a description happens on our servers',
    message:
      'There is no draft to check on, because drafting runs on our servers and your projects are kept on this device. Any project you started from a template is still here and works exactly as it always did.',
  },
  'homeProjectsApi.cancelSmartDraft': {
    title: 'Drafting a project from a description happens on our servers',
    message:
      'There is nothing to stop — drafting runs on our servers and never started here. Your project is still here, untouched, and you can keep working on it.',
  },
  'homeProjectsApi.publishProject': {
    title: 'Sharing a drafted project happens on our servers',
    message:
      'Publishing is how a drafted project reaches the rest of your household, and drafting runs on our servers. Start one from a template instead — those are shared with your household the moment you create them.',
  },
  'homeProjectsApi.listAsIs': {
    title: 'What is already built is recorded while drafting',
    message:
      'The list of what your space already has is filled in when a project is drafted for you, which happens on our servers. Note what is already done in the project’s scope or a blocker instead — both are kept on this device.',
  },
  'homeProjectsApi.upsertAsIs': {
    title: 'What is already built is recorded while drafting',
    message:
      'Recording that something is already finished is part of the drafting flow, which runs on our servers. Add it as a note on the project instead and it stays here with everything else.',
  },
  'homeProjectsApi.deleteAsIs': {
    title: 'What is already built is recorded while drafting',
    message:
      'There is nothing to remove — this list is only filled in when a project is drafted for you, and that happens on our servers. You can still note what is already done in the project’s scope.',
  },

  /**
   * The photoreal surface preview.
   *
   * The copy has to do something none of the others do: refuse the picture
   * while making clear that **the thing the member actually plans and orders
   * with still works completely**. The scale drawing, the sub-areas, the tile
   * counts and the costs are all computed on the device from the room they laid
   * out — only the photorealistic render needs a model on our servers. Copy
   * that said "surface previews are unavailable" would read as the whole
   * feature being off, which is the opposite of true.
   */
  'homeProjectsApi.generateSurfacePreview': {
    title: 'Previewing a finish needs an AI provider',
    message:
      'Showing your tile on your actual wall takes a model that can render the picture. Connect your own provider and Symply will do it from this device. The scale drawing, the quantities and the waste allowance are all worked out locally and do not need one.',
    needsAiProvider: true,
  },

  /*
   * `homeProjectsApi.listTasks` / `.linkTask` / `.createTask` USED TO BE HERE,
   * with copy saying projects and jobs were not linked up yet on any build.
   *
   * They are retired rather than reworded because the sentence they carried has
   * stopped being true: migration 0170 moved the link onto the project row as
   * `linked_task_ids`, and all three are ordinary local writes now. That is the
   * same rule the retired satellite entries follow — copy a member can disprove
   * is worse than no copy, and here they would disprove it by tapping the thing.
   */

  /**
   * The PDF download. Unreachable rather than blocked — the summary is fully
   * local and shares as text — so the copy leads with what already happened
   * instead of with a refusal.
   */
  'homeProjectsApi.downloadExportPdf': {
    title: 'Your summary shares as text, not as a document',
    message:
      'Building a document to send needs our servers to put it together, so Symply shares the same summary as plain text instead. It carries the title, the status, the budget, every item you have chosen and every stage, and it pastes straight into a message or an email.',
  },
};

/**
 * Fallback for a method with no entry.
 *
 * Deliberately says nothing specific and — importantly — **does not include the
 * method name**. A generic honest sentence is better member-facing copy than an
 * identifier, and the test suite is what stops this fallback from quietly
 * becoming the common case.
 */
export const HOUSE_UNSUPPORTED_FALLBACK: HouseUnsupportedCopy = {
  title: 'That feature is off in private mode',
  message:
    'This one needs a server that can read your home data, and Symply keeps that data on your devices. Everything in your home, tasks, spaces and schedules keeps working.',
};

export function getHouseUnsupportedCopy(method: string): HouseUnsupportedCopy {
  return HOUSE_UNSUPPORTED_COPY[method] ?? HOUSE_UNSUPPORTED_FALLBACK;
}
