import { utf8Encode } from '../crypto/bytes';

import type { OperationInput } from './types';

/**
 * Canonical bytes signed over an operation (excludes ciphertext malleability).
 * Field order is fixed; do not reorder without bumping protocol version.
 */
export function canonicalSignBytes(input: {
  protocolVersion: number;
  schemaVersion: number;
  opId: string;
  householdId: string;
  deviceId: string;
  authorMemberId: string;
  hlc: string;
  seq: number;
  parents: string[];
  opType: string;
  entityType: string;
  entityId: string;
  keyEpoch: number;
  payloadCiphertext: Uint8Array;
}): Uint8Array {
  const header = [
    'lf-op-v1',
    String(input.protocolVersion),
    String(input.schemaVersion),
    input.opId,
    input.householdId,
    input.deviceId,
    input.authorMemberId,
    input.hlc,
    String(input.seq),
    input.parents.slice().sort().join(','),
    input.opType,
    input.entityType,
    input.entityId,
    String(input.keyEpoch),
    String(input.payloadCiphertext.length),
  ].join('\n');

  const headerBytes = utf8Encode(header);
  const out = new Uint8Array(headerBytes.length + 1 + input.payloadCiphertext.length);
  out.set(headerBytes, 0);
  out[headerBytes.length] = 0;
  out.set(input.payloadCiphertext, headerBytes.length + 1);
  return out;
}

export function sortParents(parents: string[]): string[] {
  return parents.slice().sort();
}

export function assertOperationInput(input: OperationInput): void {
  if (!input.opId || !input.householdId || !input.deviceId) {
    throw new Error('OperationInput: missing ids');
  }
  if (!Number.isInteger(input.seq) || input.seq < 1) {
    throw new Error('OperationInput: seq must be >= 1');
  }
  if (!Number.isInteger(input.keyEpoch) || input.keyEpoch < 1) {
    throw new Error('OperationInput: keyEpoch must be >= 1');
  }
}
