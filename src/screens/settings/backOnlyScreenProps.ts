/**
 * The prop shape of a settings screen that is mounted in MORE THAN ONE stack.
 *
 * Appearance, Currency, Region, Notification Settings, Terms and Privacy are
 * registered twice now: in the Settings stack (House and every brand that kept
 * an ACCOUNT/PREFERENCES section on the More tab) and in the Budget stack, whose
 * settings hub moved behind the Profile gear when Budget's More tab became the
 * overflow-tabs hub. Terms and Privacy are also root expo-router routes, reached
 * from Profile, which is a sibling TAB of the one hosting either stack.
 *
 * A prop typed `SettingsStackScreenProps<'X'>` can only be mounted in the stack
 * it names, so these screens declare the only thing they actually read instead —
 * `goBack` — which every navigator satisfies structurally. The prop is optional
 * because a root route renders the component directly, with no `component=` to
 * hand one over; those screens fall back to the ambient `NavigationContext`.
 */
export type BackOnlyScreenProps = { navigation?: { goBack: () => void } };
