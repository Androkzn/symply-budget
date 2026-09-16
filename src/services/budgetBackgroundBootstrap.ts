import { requireOptionalNativeModule } from 'expo-modules-core';

// Loaded before expo-router even for a headless launch. The guard also lets an
// older development binary continue running while its native update is built.
const tasks: typeof import('../features/budget/local/backgroundTasks') | null =
  requireOptionalNativeModule('ExpoBackgroundTask')
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Task definitions must run before registering the React root.
    ? require('../features/budget/local/backgroundTasks') : null;

export async function registerBudgetBackgroundTasks(): Promise<void> {
  await tasks?.registerBudgetBackgroundTasks();
}
