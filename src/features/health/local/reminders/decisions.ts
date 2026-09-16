/**
 * The two decisions **DoD He3d** requires to be *recorded* rather than merely
 * made — plan §7:
 *
 * > Rolling-horizon reminders (≤56/64, bounded reschedule, `authenticationRequired`
 * > decision recorded); widget slice with the never-list asserted; **Q3a default
 * > per §9**.
 *
 * They are constants in code, not prose in a doc, because both are the kind of
 * decision a later change reverses by accident. A doc line saying "we do not set
 * `.completeFileProtection`" cannot fail a build; `HEALTH_GLANCE_FILE_PROTECTION`
 * with a test around it can. The matching narrative entry lives in
 * `documents/requirements/Health v2/README.md`.
 */

/* ==================================================================== */
/* Decision 1 — `authenticationRequired` on reminder actions            */
/* ==================================================================== */

/**
 * **Every Health notification action is declared `isAuthenticationRequired: true`.**
 *
 * The constraint is the **DEK class**, not the notification system. The Health
 * ledger key is `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (`local/persistence.ts`), so
 * *any* code path that writes the ledger while the device is locked fails — and
 * a notification action is exactly such a path: iOS hands a non-authenticating
 * action straight to the app from the lock screen. Plan §5 states the
 * consequence in as many words: under the current DEK class a "Log water" /
 * "Mark habit done" action from a locked screen would fail as a **silent
 * no-op** — the member taps, the sheet dismisses, nothing is written, and
 * nothing tells them.
 *
 * `isAuthenticationRequired: true` makes iOS unlock the device before handing
 * the action over, which is the only configuration under which the write can
 * succeed.
 */
export const HEALTH_REMINDER_AUTHENTICATION_REQUIRED = true;

/**
 * **He3d ships zero notification actions.** This is the second half of the same
 * decision, and it is the half that is actually load-bearing today.
 *
 * The plan offers two acceptable outcomes — "declare every reminder action
 * `authenticationRequired: true` … **or must not offer log-from-notification at
 * all**". He3d takes the second: Health registers no
 * `setNotificationCategoryAsync` category, so there is no action to get the flag
 * wrong on. The constant above is not decoration — it is the default any future
 * action must be built with, enforced by {@link healthReminderActionOptions} and
 * asserted by `reminders.test.ts`, so the day someone does add "Log water" the
 * flag is already correct rather than remembered.
 *
 * If product wants log-from-locked, the **DEK class must change first** (§16 Q8's
 * option set). Do not reach for it by dropping this flag.
 */
export const HEALTH_REMINDER_ACTIONS: readonly never[] = [];

/** iOS action options every future Health reminder action must be built from. */
export function healthReminderActionOptions(): {
  isAuthenticationRequired: boolean;
  opensAppToForeground: boolean;
} {
  return {
    isAuthenticationRequired: HEALTH_REMINDER_AUTHENTICATION_REQUIRED,
    // A foreground open is the honest companion to the flag above: the write
    // needs an unlocked device *and* a running app to reach the ledger, so
    // pretending the action is a background one would re-create the silent
    // no-op by another route.
    opensAppToForeground: true,
  };
}

/**
 * The lock-screen CONTENT half of the same decision, since "is reminder content
 * hidden on the lock screen?" is the question a reader of the DoD row will ask.
 *
 * **The app cannot hide it.** Whether a notification's body is previewed on a
 * locked screen is the member's own iOS setting (Show Previews: Always / When
 * Unlocked / Never), and "Always" is the default. There is no entitlement, no
 * `content-available` trick and no `.privacySensitive()` equivalent for
 * notifications — the same trap plan §9 documents for WidgetKit, where the
 * modifier "does essentially nothing by default".
 *
 * So the control is **what is put in the body**, and the rule is: a Health
 * reminder body carries *no reading*. No weight, no calorie total, no water
 * volume, no cycle, injury or vitality anything. It says what to do, never what
 * the member's numbers are. The one member-authored string that appears is a
 * habit's own name, which is exactly what the server push it replaces already
 * put there — the local scheduler must not become a privacy regression, and it
 * must not silently become an improvement the member cannot rely on either.
 */
export const HEALTH_REMINDER_BODIES_CARRY_READINGS = false;

/* ==================================================================== */
/* Decision 2 — Q3a: the widget glance file class                       */
/* ==================================================================== */

/**
 * **Q3a default: Option A.** Recorded here, in code, because §9 makes shipping
 * it a requirement rather than a preference:
 *
 * > **Q3a gates *enabling* the glance, not He3d — it must not strand He3a–c.**
 * > If Q3a is still open when He3d is ready, ship **Option A's file class by
 * > default** — do **not** set `.completeFileProtection` and do **not** add
 * > `NSFileProtectionComplete` to the widget entitlement (both are opt-ins; the
 * > App Group default is already `CompleteUntilFirstUserAuthentication`) — with
 * > the glance **dark** and in-product copy, per §0.
 *
 * Option B (`.completeFileProtection` + `NSFileProtectionComplete`) is
 * **forbidden by §17 to guess**: adding that entitlement is irreversible for a
 * shipped widget and leaves it a placeholder whenever the device is locked —
 * Home Screen included — i.e. permanently dark. Option A is reversible in the
 * only direction that matters: answering Q3a later flips the glance on with **no
 * file-class migration**.
 */
export const HEALTH_GLANCE_FILE_PROTECTION = 'CompleteUntilFirstUserAuthentication' as const;

/**
 * No `NSFileProtectionComplete` on the widget extension. Half of Option A, and
 * the irreversible half — see above.
 */
export const HEALTH_GLANCE_WIDGET_ENTITLEMENT: readonly string[] = [];

/**
 * The glance ships **dark** until Q3a is answered. Option A picks the file class
 * that *allows* a lock-screen glance; it does not by itself decide that Health
 * should render health facts on a lock screen, which is the product question
 * Q3a actually is. Shipping the file class without the glance is what lets
 * He3a–c land on schedule while leaving the answer genuinely open.
 */
export const HEALTH_GLANCE_ENABLED_BY_DEFAULT = false;

/**
 * The real enforcement mechanism, restated where the file-class decision is —
 * because §9's whole point is that the file class is **not** it:
 *
 * > The never-list is enforced at the **write boundary**, not by file
 * > protection. `cycle`, `injury` and `vitality` are never written into the App
 * > Group slice at all. **That is the real control.**
 *
 * Owned and asserted by the widget slice (`widgetSlice.test.ts`); named here so
 * a reader who arrives at the file-class decision cannot come away believing the
 * file class was the protection.
 */
export const HEALTH_GLANCE_NEVER_LIST = ['cycle', 'injury', 'vitality'] as const;

/** Member-facing copy for the dark glance — never a silent empty state (§9/§0). */
export function getHealthGlanceDarkCopy(): { title: string; message: string } {
  return {
    title: 'The Home Screen widget is off on this build',
    message:
      'Your health data now lives encrypted on this device, so the widget would have to keep its own copy outside the app to draw anything. We have not turned that on yet. Everything in the app works exactly as before, and reminders still arrive.',
  };
}
