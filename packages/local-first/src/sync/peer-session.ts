import { bytesToBase64 } from '../crypto/base64';
import { bytesToHex } from '../crypto/bytes';
import type { OpLog } from '../oplog/oplog';
import type { StoredOperation, VersionVector } from '../store/types';
import type { Bytes, DeviceId, HouseholdId } from '../types';

import {
  MAILBOX_BATCH_VERSION,
  deserializeOperation,
  serializeOperation,
  type OpBatch,
  type SerializedStoredOperation,
} from './batch';
import type { SyncCheckpoint, SyncPeer } from './types';

export type PeerSyncMessage =
  | { type: 'hello'; deviceId: DeviceId; signingPublicKeyHex: string; agreementPublicKeyHex: string }
  | { type: 'hello_ack'; deviceId: DeviceId; signingPublicKeyHex: string }
  | { type: 'checkpoint'; checkpoint: SyncCheckpoint }
  | { type: 'ops'; ops: SerializedStoredOperation[]; senderSigningPublicKeyHex: string }
  | { type: 'ack'; opIds: string[] }
  | { type: 'done' };

/** Bidirectional byte/JSON transport (WebRTC DataChannel or in-process loopback). */
export interface PeerTransport {
  send(message: PeerSyncMessage): Promise<void>;
  onMessage(handler: (message: PeerSyncMessage) => void): () => void;
  close(): Promise<void>;
}

export type PeerSyncResult = {
  sent: number;
  applied: number;
  duplicates: number;
  rejected: number;
  peerDeviceId: DeviceId | null;
};

/**
 * App-layer sync over an authenticated peer transport.
 * Ops remain sealed+signed; transport is only a pipe (WebRTC or loopback).
 */
export class PeerSyncSession {
  constructor(
    private readonly options: {
      householdId: HouseholdId;
      deviceId: DeviceId;
      signingPublicKey: Bytes;
      agreementPublicKey: Bytes;
      opLog: OpLog;
      listLocalOps: () => Promise<StoredOperation[]>;
      /**
       * Optional: this transport still ships the whole log (it is gated off
       * behind the brand's `EXPO_PUBLIC_*_P2P=1` flag and dies at ~110 ops
       * anyway), so it has
       * no cursor of its own. The header field exists so both serializers stay
       * one format — a second, stale serializer is how a wire format drifts back
       * in.
       */
      listLocalVersionVector?: () => Promise<VersionVector>;
      resolveSenderPublicKey: (deviceId: DeviceId, hintedHex?: string) => Bytes | null;
    },
  ) {}

  async runAsInitiator(transport: PeerTransport): Promise<PeerSyncResult> {
    return this.run(transport, true);
  }

  async runAsResponder(transport: PeerTransport): Promise<PeerSyncResult> {
    return this.run(transport, false);
  }

  private async run(transport: PeerTransport, initiator: boolean): Promise<PeerSyncResult> {
    const result: PeerSyncResult = {
      sent: 0,
      applied: 0,
      duplicates: 0,
      rejected: 0,
      peerDeviceId: null,
    };

    let peer: SyncPeer | null = null;
    let peerCheckpoint: SyncCheckpoint | null = null;
    let done = false;

    const waiters: Array<() => void> = [];
    const notify = () => {
      for (const w of waiters.splice(0)) w();
    };
    const wait = () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
      });

    const unsub = transport.onMessage((message) => {
      void (async () => {
        if (message.type === 'hello' || message.type === 'hello_ack') {
          peer = {
            deviceId: message.deviceId,
            signingPublicKey: this.options.resolveSenderPublicKey(
              message.deviceId,
              message.signingPublicKeyHex,
            ) ?? hexToBytesSafe(message.signingPublicKeyHex),
            agreementPublicKey: hexToBytesSafe(
              'agreementPublicKeyHex' in message
                ? (message as { agreementPublicKeyHex?: string }).agreementPublicKeyHex ??
                    message.signingPublicKeyHex
                : message.signingPublicKeyHex,
            ),
          };
          result.peerDeviceId = message.deviceId;
          if (message.type === 'hello') {
            await transport.send({
              type: 'hello_ack',
              deviceId: this.options.deviceId,
              signingPublicKeyHex: bytesToHex(this.options.signingPublicKey),
            });
          }
        } else if (message.type === 'checkpoint') {
          peerCheckpoint = message.checkpoint;
        } else if (message.type === 'ops') {
          for (const raw of message.ops) {
            const op = deserializeOperation(raw);
            const pub =
              this.options.resolveSenderPublicKey(op.deviceId, message.senderSigningPublicKeyHex) ??
              hexToBytesSafe(message.senderSigningPublicKeyHex);
            const applied = await this.options.opLog.applyRemote(op, pub);
            if (applied.status === 'applied') result.applied += 1;
            else if (applied.status === 'duplicate') result.duplicates += 1;
            else result.rejected += 1;
          }
          await transport.send({
            type: 'ack',
            opIds: message.ops.map((o) => o.opId),
          });
        } else if (message.type === 'done') {
          done = true;
        }
        notify();
      })();
    });

    try {
      if (initiator) {
        await transport.send({
          type: 'hello',
          deviceId: this.options.deviceId,
          signingPublicKeyHex: bytesToHex(this.options.signingPublicKey),
          agreementPublicKeyHex: bytesToHex(this.options.agreementPublicKey),
        });
        while (!peer) await wait();
      } else {
        while (!peer) await wait();
      }

      const localOps = await this.options.listLocalOps();
      const localCheckpoint: SyncCheckpoint = {
        householdId: this.options.householdId,
        frontierHlc: localOps.length === 0 ? '' : localOps[localOps.length - 1]!.hlc,
        opCount: localOps.length,
        versionVector: (await this.options.listLocalVersionVector?.()) ?? {},
      };
      await transport.send({ type: 'checkpoint', checkpoint: localCheckpoint });
      while (!peerCheckpoint) await wait();

      // Send all local ops the peer may be missing (frontier heuristic: send all if counts differ).
      if ((peerCheckpoint as SyncCheckpoint).opCount < localCheckpoint.opCount || (peerCheckpoint as SyncCheckpoint).frontierHlc !== localCheckpoint.frontierHlc) {
        const batch: OpBatch = {
          v: MAILBOX_BATCH_VERSION,
          householdId: this.options.householdId,
          senderDeviceId: this.options.deviceId,
          senderSigningPublicKeyB64: bytesToBase64(this.options.signingPublicKey),
          senderVersionVector: localCheckpoint.versionVector,
          ops: localOps.map(serializeOperation),
        };
        await transport.send({
          type: 'ops',
          ops: batch.ops,
          senderSigningPublicKeyHex: bytesToHex(this.options.signingPublicKey),
        });
        result.sent = batch.ops.length;
      }

      await transport.send({ type: 'done' });
      const deadline = Date.now() + 5_000;
      while (!done && Date.now() < deadline) {
        await Promise.race([wait(), sleep(50)]);
      }
    } finally {
      unsub();
      await transport.close();
    }

    return result;
  }
}

/** In-process duplex transport for convergence tests (no WebRTC). */
export class LoopbackPeerTransport implements PeerTransport {
  private peer: LoopbackPeerTransport | null = null;
  private handlers: Array<(message: PeerSyncMessage) => void> = [];
  private inbox: PeerSyncMessage[] = [];
  private closed = false;

  static pair(): [LoopbackPeerTransport, LoopbackPeerTransport] {
    const a = new LoopbackPeerTransport();
    const b = new LoopbackPeerTransport();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  async send(message: PeerSyncMessage): Promise<void> {
    if (this.closed || !this.peer || this.peer.closed) return;
    this.peer.deliver(message);
  }

  private deliver(message: PeerSyncMessage): void {
    if (this.handlers.length === 0) {
      this.inbox.push(message);
      return;
    }
    const handlers = [...this.handlers];
    queueMicrotask(() => {
      for (const h of handlers) h(message);
    });
  }

  onMessage(handler: (message: PeerSyncMessage) => void): () => void {
    this.handlers.push(handler);
    if (this.inbox.length > 0) {
      const pending = this.inbox.splice(0);
      queueMicrotask(() => {
        for (const message of pending) handler(message);
      });
    }
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers = [];
    this.inbox = [];
  }
}

function hexToBytesSafe(hex: string): Bytes {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
