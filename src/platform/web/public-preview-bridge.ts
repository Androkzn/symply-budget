import { Platform } from 'react-native';

export type PublicBudgetPreviewScreen = 'overview' | 'spending' | 'planning' | 'savings';

type ChildMessage =
  | {
      source: 'symply-budget';
      version: 1;
      type: 'ready';
      payload: { screen: PublicBudgetPreviewScreen; mode: 'public-preview' };
    }
  | {
      source: 'symply-budget';
      version: 1;
      type: 'screen';
      payload: { screen: PublicBudgetPreviewScreen };
    }
  | {
      source: 'symply-budget';
      version: 1;
      type: 'interaction';
      payload: { action: 'month.change' | 'category.select'; itemId: string };
    };

type BrowserWindow = {
  parent?: BrowserWindow;
  postMessage?: (message: unknown, targetOrigin: string) => void;
  addEventListener?: (type: 'message', listener: (event: BrowserMessageEvent) => void) => void;
  removeEventListener?: (type: 'message', listener: (event: BrowserMessageEvent) => void) => void;
};

type BrowserMessageEvent = {
  origin: string;
  source: unknown;
  data: unknown;
};

const PORTFOLIO_ORIGIN = 'https://andreitekhtelev.dev';

function getRuntimeWindow(): BrowserWindow | null {
  if (Platform.OS !== 'web') return null;
  return (globalThis as unknown as { window?: BrowserWindow }).window ?? null;
}

function getParentWindow(): BrowserWindow | null {
  const runtimeWindow = getRuntimeWindow();
  if (!runtimeWindow?.parent || runtimeWindow.parent === runtimeWindow) return null;
  return runtimeWindow.parent;
}

function post(message: ChildMessage): void {
  getParentWindow()?.postMessage?.(message, PORTFOLIO_ORIGIN);
}

export function announcePublicBudgetPreviewScreen(screen: PublicBudgetPreviewScreen): void {
  post({ source: 'symply-budget', version: 1, type: 'screen', payload: { screen } });
}

export function announcePublicBudgetPreviewInteraction(
  action: 'month.change' | 'category.select',
  itemId: string,
): void {
  post({ source: 'symply-budget', version: 1, type: 'interaction', payload: { action, itemId } });
}

/** Start the optional parent/child handshake for the public Web preview. */
export function startPublicBudgetPreviewBridge(
  screen: PublicBudgetPreviewScreen,
): () => void {
  const runtimeWindow = getRuntimeWindow();
  const parentWindow = getParentWindow();
  if (!runtimeWindow || !parentWindow) return () => {};

  const announceReady = () => {
    post({
      source: 'symply-budget',
      version: 1,
      type: 'ready',
      payload: { screen, mode: 'public-preview' },
    });
  };

  const handleParentMessage = (event: BrowserMessageEvent) => {
    if (event.origin !== PORTFOLIO_ORIGIN || event.source !== parentWindow) return;
    if (!event.data || typeof event.data !== 'object') return;
    const message = event.data as { source?: unknown; version?: unknown; type?: unknown };
    if (message.source === 'portfolio' && message.version === 1 && message.type === 'hostReady') {
      announceReady();
    }
  };

  runtimeWindow.addEventListener?.('message', handleParentMessage);
  announceReady();
  return () => runtimeWindow.removeEventListener?.('message', handleParentMessage);
}
