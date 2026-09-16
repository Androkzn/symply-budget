import { LifeSystem } from '../constants';

import { storageHelpers } from './storage';

const QUEUE_KEY = 'kaizen.setup.queue';
const CONFIGURED_KEY = 'kaizen.setup.configured';

export type SetupAdvanceResult =
  | { kind: 'next-system'; system: string }
  | { kind: 'career-setup' }
  | { kind: 'complete' };

export function beginSetupQueue(systems: string[]): void {
  storageHelpers.setString(QUEUE_KEY, JSON.stringify(systems));
  storageHelpers.setString(CONFIGURED_KEY, JSON.stringify([]));
}

export function readSetupQueue(): string[] {
  try {
    const parsed = JSON.parse(storageHelpers.getString(QUEUE_KEY) ?? '[]') as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function readConfiguredSystems(): string[] {
  try {
    const parsed = JSON.parse(storageHelpers.getString(CONFIGURED_KEY) ?? '[]') as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function needsCareerSetupStep(): boolean {
  const queue = readSetupQueue();
  if (!queue.includes(LifeSystem.Career)) return false;
  const configured = new Set(readConfiguredSystems());
  return queue.every(system => configured.has(system));
}

export function isSetupFlowActive(): boolean {
  const queue = readSetupQueue();
  if (queue.length === 0) return false;
  if (nextUnconfiguredSystem()) return true;
  return needsCareerSetupStep();
}

export function nextUnconfiguredSystem(): string | null {
  const queue = readSetupQueue();
  const configured = new Set(readConfiguredSystems());
  return queue.find(system => !configured.has(system)) ?? null;
}

export function markSystemConfigured(system: string): SetupAdvanceResult {
  const configured = new Set(readConfiguredSystems());
  configured.add(system);
  storageHelpers.setString(CONFIGURED_KEY, JSON.stringify([...configured]));

  const queue = readSetupQueue();
  const remaining = queue.filter(item => !configured.has(item));
  if (remaining.length > 0) {
    return { kind: 'next-system', system: remaining[0] };
  }
  if (queue.includes(LifeSystem.Career)) {
    return { kind: 'career-setup' };
  }
  clearSetupFlow();
  return { kind: 'complete' };
}

export function clearSetupFlow(): void {
  storageHelpers.remove(QUEUE_KEY);
  storageHelpers.remove(CONFIGURED_KEY);
}

export function finishSetupAfterCareer(): void {
  clearSetupFlow();
}

/**
 * Total onboarding step count for a given system selection — 3 fixed steps
 * (Welcome, Notifications, the systems picker itself) plus one per selected
 * system, plus 5 more if Career is among them (its own deep setup wizard).
 * One continuous count across the whole account-onboarding run, so the
 * shared progress bar never resets partway through.
 */
export function estimateOnboardingStepTotal(systems: string[]): number {
  return 3 + systems.length + (systems.includes(LifeSystem.Career) ? 5 : 0);
}
