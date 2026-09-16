import type { Bytes, DeviceId, HouseholdId, MemberId, OpId } from '../types';

export interface OperationInput {
  opId: OpId;
  householdId: HouseholdId;
  deviceId: DeviceId;
  authorMemberId: MemberId;
  hlc: string;
  seq: number;
  parents: OpId[];
  opType: string;
  entityType: string;
  entityId: string;
  /** Plaintext JSON/binary payload before HDK seal */
  plaintextPayload: Bytes;
  keyEpoch: number;
}

export interface AppliedOperationResult {
  status: 'applied' | 'duplicate' | 'rejected';
  reason?: string;
}

export interface ProjectionHandler {
  /**
   * Apply a verified, decrypted operation to domain projections.
   * Must be idempotent for the same opId.
   */
  apply(args: {
    opId: OpId;
    opType: string;
    entityType: string;
    entityId: string;
    plaintextPayload: Bytes;
    authorMemberId: MemberId;
    hlc: string;
  }): Promise<void>;
}
