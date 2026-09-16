/**
 * Floor Plan Vectorization Service
 *
 * Phase 1: `generateSemanticSvg` — Claude Vision semantic SVG.
 * Phase 2: `traceFloorPlan` — pixel-perfect VTracer via Cloudflare Container.
 * Also: `rasterizeToPng` — PDF/image → PNG via the same container when available.
 */

import {
  FLOOR_PLAN_VECTORIZE_SYSTEM_PROMPT,
  FLOOR_PLAN_VECTORIZE_USER_PROMPT,
  MAX_SEMANTIC_SVG_BYTES,
} from '../ai/prompts/vectorize-floor-plan';
import { createAnthropicAdapterForUser } from '../ai/provider-factory';
import type { Env } from '../types';
import { nowIso } from '../utils/id';

export interface SemanticVectorizationResult {
  svg: string;
  bytes: number;
  model: string;
  generated_at: string;
}

export interface TraceVectorizationResult {
  svg: string;
  bytes: number;
  generated_at: string;
}

export interface RasterizeResult {
  pngBytes: Uint8Array;
  contentType: 'image/png';
  width?: number;
  height?: number;
}

export class FloorPlanVectorizationService {
  private readonly model = 'claude-sonnet-4-5-20250929';
  private userId?: string | null;

  /** `userId` bills the acting user's own Anthropic key when connected (BYOK). */
  constructor(private env: Env, userId?: string | null) {
    this.userId = userId;
  }

  /**
   * Ask Claude Vision to redraw the floor plan as a semantic SVG.
   */
  async generateSemanticSvg(params: {
    imageBase64: string;
    mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  }): Promise<SemanticVectorizationResult> {
    const startedAt = Date.now();
    console.log('[FLOOR-PLAN-VECTORIZE] Generating semantic SVG…');

    const provider = await createAnthropicAdapterForUser(
      this.env,
      this.userId,
      { feature: 'floor_plan_vectorize', userId: this.userId },
      this.model
    );
    const { text: raw } = await provider.generateFromMediaContent({
      systemPrompt: FLOOR_PLAN_VECTORIZE_SYSTEM_PROMPT,
      userText: FLOOR_PLAN_VECTORIZE_USER_PROMPT,
      media: { base64: params.imageBase64, mediaType: params.mediaType },
      maxTokens: 8192,
      model: this.model,
    });
    const svg = sanitizeSvg(raw);

    const bytes = new TextEncoder().encode(svg).byteLength;
    if (bytes > MAX_SEMANTIC_SVG_BYTES) {
      throw new Error(
        `Semantic SVG exceeded max size (${bytes} > ${MAX_SEMANTIC_SVG_BYTES} bytes)`
      );
    }

    console.log(
      `[FLOOR-PLAN-VECTORIZE] Semantic SVG ready in ${Date.now() - startedAt}ms (${bytes} bytes)`
    );

    return {
      svg,
      bytes,
      model: this.model,
      generated_at: nowIso(),
    };
  }

  /**
   * Pixel-perfect literal trace via the Cloudflare Container worker.
   *
   * Contract:
   *   POST {VECTORIZER_TRACE_URL}/trace
   *     body:    { imageUrl: string, contentType: string } OR { imageBase64, contentType }
   *     headers: { Authorization: Bearer ${VECTORIZER_TRACE_TOKEN} }
   *     200:     { svg: string }
   */
  async traceFloorPlan(params: {
    imageUrl?: string;
    imageBase64?: string;
    contentType: string;
  }): Promise<TraceVectorizationResult> {
    if (!this.env.VECTORIZER_TRACE_URL) {
      throw new Error(
        'Trace pipeline not configured. Set VECTORIZER_TRACE_URL when the Cloudflare Container is deployed.'
      );
    }

    const url = `${this.env.VECTORIZER_TRACE_URL.replace(/\/$/, '')}/trace`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.env.VECTORIZER_TRACE_TOKEN) {
      headers.Authorization = `Bearer ${this.env.VECTORIZER_TRACE_TOKEN}`;
    }

    const body: Record<string, string> = { contentType: params.contentType };
    if (params.imageBase64) body.imageBase64 = params.imageBase64;
    if (params.imageUrl) body.imageUrl = params.imageUrl;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Trace container returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as { svg?: string };
    if (!data.svg || typeof data.svg !== 'string') {
      throw new Error('Trace container response missing svg');
    }

    const svg = sanitizeSvg(data.svg);
    const bytes = new TextEncoder().encode(svg).byteLength;

    return {
      svg,
      bytes,
      generated_at: nowIso(),
    };
  }

  /**
   * Rasterize PDF (or any supported input) to PNG via the container.
   * Returns null when the container is not configured.
   */
  async rasterizeToPng(params: {
    imageUrl?: string;
    imageBase64?: string;
    contentType: string;
  }): Promise<RasterizeResult | null> {
    if (!this.env.VECTORIZER_TRACE_URL) {
      return null;
    }

    const url = `${this.env.VECTORIZER_TRACE_URL.replace(/\/$/, '')}/rasterize`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.env.VECTORIZER_TRACE_TOKEN) {
      headers.Authorization = `Bearer ${this.env.VECTORIZER_TRACE_TOKEN}`;
    }

    const body: Record<string, string> = { contentType: params.contentType };
    if (params.imageBase64) body.imageBase64 = params.imageBase64;
    if (params.imageUrl) body.imageUrl = params.imageUrl;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Rasterize container returned ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      pngBase64?: string;
      width?: number;
      height?: number;
    };
    if (!data.pngBase64) {
      throw new Error('Rasterize container response missing pngBase64');
    }

    const binary = atob(data.pngBase64);
    const pngBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      pngBytes[i] = binary.charCodeAt(i);
    }

    return {
      pngBytes,
      contentType: 'image/png',
      width: data.width,
      height: data.height,
    };
  }

  isTraceConfigured(): boolean {
    return Boolean(this.env.VECTORIZER_TRACE_URL);
  }
}

/**
 * Whitelist-based SVG sanitizer.
 */
function sanitizeSvg(raw: string): string {
  let svg = raw.trim();

  if (svg.startsWith('```svg')) svg = svg.slice(6);
  else if (svg.startsWith('```xml')) svg = svg.slice(6);
  else if (svg.startsWith('```')) svg = svg.slice(3);
  if (svg.endsWith('```')) svg = svg.slice(0, -3);
  svg = svg.trim();

  const open = svg.indexOf('<svg');
  const close = svg.lastIndexOf('</svg>');
  if (open === -1 || close === -1 || close < open) {
    throw new Error('AI response did not contain a valid <svg> root element.');
  }
  svg = svg.slice(open, close + '</svg>'.length);

  const forbiddenTagRegex =
    /<\s*(script|style|foreignObject|iframe|object|embed|use|image|filter|mask|clipPath|switch|metadata)\b/i;
  if (forbiddenTagRegex.test(svg)) {
    throw new Error('AI response contained a disallowed SVG element.');
  }

  if (/javascript:/i.test(svg) || /\son\w+\s*=/i.test(svg) || /xlink:href\s*=/i.test(svg)) {
    throw new Error('AI response contained a disallowed SVG attribute.');
  }

  if (!/xmlns\s*=\s*"http:\/\/www\.w3\.org\/2000\/svg"/.test(svg)) {
    svg = svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/viewBox\s*=/.test(svg)) {
    svg = svg.replace(/^<svg\b/, '<svg viewBox="0 0 1000 1000"');
  }

  return svg;
}
