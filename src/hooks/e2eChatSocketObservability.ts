/**
 * WebSocket observability helpers for House + Budget chat hooks.
 */
import { recordE2EWsEvent } from '@api/e2eTestObservability';

export type E2EChatSocketChannel = 'house-chat' | 'budget-chat';

export function e2eLogChatWsConnect(channel: E2EChatSocketChannel, path: string): void {
  recordE2EWsEvent({ action: 'connect', channel, path });
}

export function e2eLogChatWsOpen(channel: E2EChatSocketChannel, path: string): void {
  recordE2EWsEvent({ action: 'open', channel, path });
}

export function e2eLogChatWsMessage(
  channel: E2EChatSocketChannel,
  path: string,
  messageType: string,
): void {
  recordE2EWsEvent({ action: 'message', channel, path, detail: `type=${messageType}` });
}

export function e2eLogChatWsSend(
  channel: E2EChatSocketChannel,
  path: string,
  sendType: string,
): void {
  recordE2EWsEvent({ action: 'send', channel, path, detail: `type=${sendType}` });
}

export function e2eLogChatWsError(channel: E2EChatSocketChannel, path: string): void {
  recordE2EWsEvent({ action: 'error', channel, path });
}

export function e2eLogChatWsClose(
  channel: E2EChatSocketChannel,
  path: string,
  code?: number,
): void {
  recordE2EWsEvent({
    action: 'close',
    channel,
    path,
    detail: code != null ? `code=${code}` : undefined,
  });
}
