import type { PeerSyncMessage, PeerTransport } from '@symply/local-first';

import { fetchTurnConfig } from '../controlPlaneClient';

import type { LocalFirstSignalingClient } from './signalingClient';

type WebRtcModule = typeof import('react-native-webrtc');

/**
 * The shipped `react-native-webrtc` .d.ts omits the `on*` event-handler
 * properties (`onicecandidate` / `ondatachannel` / `onmessage`) — they exist
 * at runtime via event-target-shim's `defineEventAttribute`, just untyped
 * (the class only threads one of the shim's two generic params). Extend the
 * real instance types with the handful this file assigns, instead of a
 * hand-rolled duck type that could drift from the actual class shape. There
 * is no global `RTCPeerConnection`/`RTCDataChannel` — RN's tsconfig has no
 * `dom` lib — so these locals stand in for the DOM names this file used to
 * (incorrectly) assume were ambient.
 */
type RTCPeerConnection = InstanceType<WebRtcModule['RTCPeerConnection']> & {
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  ondatachannel: ((ev: { channel: RTCDataChannel }) => void) | null;
};
type RTCDataChannel = ReturnType<InstanceType<WebRtcModule['RTCPeerConnection']>['createDataChannel']> & {
  onmessage: ((ev: { data: unknown }) => void) | null;
};

/**
 * WebRTC DataChannel transport for peer sync.
 * Falls back gracefully when TURN is not configured (mailbox remains primary).
 */
export class WebRtcPeerTransport implements PeerTransport {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private handlers: Array<(message: PeerSyncMessage) => void> = [];
  private closed = false;

  constructor(
    private readonly options: {
      signaling: LocalFirstSignalingClient;
      remoteDeviceId: string;
      isInitiator: boolean;
    },
  ) {}

  /**
   * Off by default, behind EXPO_PUBLIC_BUDGET_P2P=1.
   *
   * The peer path is not production-ready and is worse than no path at all
   * today: PeerSyncSession serializes the ENTIRE op log into ONE DataChannel
   * message and sends it with no chunking and no bufferedAmount/maxMessageSize
   * check, so it exceeds libwebrtc's ~256 KiB SCTP message limit at roughly 110
   * ops and either throws or tears the channel down. It cannot act as the escape
   * hatch from the mailbox cap either — it fails at a LOWER threshold — and
   * /v2/turn currently returns `not_configured` unconditionally, which the old
   * check treated as "available", so every sync attempted it.
   *
   * The flag lets it be exercised deliberately while Stage 1 gives it a
   * cursor-bounded, chunked transfer.
   */
  static async isAvailable(): Promise<boolean> {
    if (process.env.EXPO_PUBLIC_BUDGET_P2P !== '1') return false;
    try {
      const turn = await fetchTurnConfig();
      // Allow host candidates even without TURN (LAN / same-network testers).
      return turn.status === 'ok' || turn.status === 'not_configured';
    } catch {
      return false;
    }
  }

  async start(): Promise<void> {
    // Lazy-require so Jest / web builds without the native module still load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const webrtc = require('react-native-webrtc') as typeof import('react-native-webrtc');
    const turn = await fetchTurnConfig();
    const iceServers =
      turn.iceServers.length > 0
        ? turn.iceServers
        : [{ urls: ['stun:stun.cloudflare.com:3478'] }];

    // A local narrows reliably through the closures below — TS can't prove
    // `this.pc` isn't reassigned once a closure that could run later exists.
    const pc = new webrtc.RTCPeerConnection({ iceServers }) as RTCPeerConnection;
    this.pc = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.options.signaling.sendIce(this.options.remoteDeviceId, ev.candidate);
      }
    };

    const unsub = this.options.signaling.onEvent((event) => {
      void (async () => {
        if (!this.pc || this.closed) return;
        if (event.type === 'signal.answer' && this.options.isInitiator) {
          if (event.fromDeviceId !== this.options.remoteDeviceId) return;
          await this.pc.setRemoteDescription({ type: 'answer', sdp: event.sdp });
        } else if (event.type === 'signal.offer' && !this.options.isInitiator) {
          if (event.fromDeviceId !== this.options.remoteDeviceId) return;
          await this.pc.setRemoteDescription({ type: 'offer', sdp: event.sdp });
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.options.signaling.sendAnswer(this.options.remoteDeviceId, answer.sdp ?? '');
        } else if (event.type === 'signal.ice') {
          if (event.fromDeviceId !== this.options.remoteDeviceId) return;
          try {
            await this.pc.addIceCandidate(event.candidate);
          } catch {
            /* ignore stale candidates */
          }
        }
      })();
    });

    // Keep unsub on close
    (this as { _unsub?: () => void })._unsub = unsub;

    if (this.options.isInitiator) {
      const channel = pc.createDataChannel('symply-lf-sync', { ordered: true }) as RTCDataChannel;
      this.channel = channel;
      this.bindChannel(channel);
      const offer = await pc.createOffer({});
      await pc.setLocalDescription(offer);
      this.options.signaling.sendOffer(this.options.remoteDeviceId, offer.sdp ?? '');
    } else {
      pc.ondatachannel = (ev) => {
        this.channel = ev.channel;
        this.bindChannel(ev.channel);
      };
    }

    await this.waitForOpen(15_000);
  }

  private bindChannel(channel: RTCDataChannel): void {
    channel.onmessage = (ev) => {
      try {
        const message = JSON.parse(String(ev.data)) as PeerSyncMessage;
        for (const h of this.handlers) h(message);
      } catch {
        /* ignore */
      }
    };
  }

  private waitForOpen(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.closed) {
          reject(new Error('transport_closed'));
          return;
        }
        if (this.channel?.readyState === 'open') {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error('datachannel_timeout'));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  async send(message: PeerSyncMessage): Promise<void> {
    if (this.channel?.readyState === 'open') {
      this.channel.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (message: PeerSyncMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    const unsub = (this as { _unsub?: () => void })._unsub;
    unsub?.();
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.channel = null;
    this.pc = null;
  }
}
