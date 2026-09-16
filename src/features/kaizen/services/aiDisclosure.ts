import { storageHelpers } from './storage';

const AI_DISCLOSURE_KEY = 'kaizen.ai.disclosure.ack';

export function getAIDisclosureAck(): boolean {
  return storageHelpers.getString(AI_DISCLOSURE_KEY) === 'true';
}

export function setAIDisclosureAck(acknowledged: boolean): void {
  if (acknowledged) storageHelpers.setString(AI_DISCLOSURE_KEY, 'true');
  else storageHelpers.remove(AI_DISCLOSURE_KEY);
}
