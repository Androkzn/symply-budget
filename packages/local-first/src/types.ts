/** Protocol / schema versions for op envelopes. */
export const LOCAL_FIRST_PROTOCOL_VERSION = 1;
export const LOCAL_FIRST_SCHEMA_VERSION = 1;

export type HouseholdId = string;
export type DeviceId = string;
export type MemberId = string;
export type OpId = string;

export type MemberRole = 'OWNER' | 'ADULT';

export type Bytes = Uint8Array;

export interface DeviceIdentity {
  deviceId: DeviceId;
  /** 32-byte Ed25519 private seed */
  signingPrivateKey: Bytes;
  /** 32-byte Ed25519 public key */
  signingPublicKey: Bytes;
  /** 32-byte X25519 private key (agreement) — reserved for enrolment ECDH */
  agreementPrivateKey: Bytes;
  /** 32-byte X25519 public key */
  agreementPublicKey: Bytes;
}

export interface HouseholdKeys {
  householdId: HouseholdId;
  /** 32-byte Household Data Key */
  hdk: Bytes;
  keyEpoch: number;
}

export interface UnlockMaterial {
  /** Random 32-byte local database key (SQLCipher / memory store) */
  localDatabaseKey: Bytes;
  /** Salt for Argon2id PIN derivation */
  pinSalt: Bytes;
}
