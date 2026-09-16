/**
 * Kaizen Coach Chat — decision tracing
 *
 * AI decision tracing for successful turns, not only failures (plan: Kaizen
 * Master reference-pattern bullet). The trace is returned to the client and is
 * cheap to log; it records each tool-loop iteration so a turn can be replayed /
 * audited without re-running the model.
 */

import type { ContextAssemblyTrace } from '../kaizen-brain/contextBuilder';

export interface ToolCallTrace {
  iteration: number;
  toolName: string;
  /** Arguments the model requested (redacted of obvious PII by the registry). */
  arguments: Record<string, unknown>;
  ok: boolean;
  /** Short reason when the tool failed or was rejected by a guardrail. */
  error?: string;
  durationMs: number;
}

export interface DecisionTrace {
  sessionId: string;
  model: string;
  provider: string;
  /** Why the loop ended: 'final' | 'max_iterations' | 'error' | 'gated'. */
  finishReason: 'final' | 'max_iterations' | 'error' | 'gated';
  iterations: number;
  toolCalls: ToolCallTrace[];
  contextAssembly?: ContextAssemblyTrace;
  /** Total wall-clock for the turn. */
  durationMs: number;
  /** Provider usage if reported (prompt/completion tokens). */
  usage?: Record<string, number> | null;
}

/** Mutable trace accumulator used while the bounded loop runs. */
export class TraceBuilder {
  private readonly start = Date.now();
  private readonly toolCalls: ToolCallTrace[] = [];
  private iterations = 0;
  private finishReason: DecisionTrace['finishReason'] = 'final';
  private contextAssembly?: ContextAssemblyTrace;
  private usage: Record<string, number> | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly provider: string,
    private readonly model: string
  ) {}

  setContextAssembly(trace: ContextAssemblyTrace): void {
    this.contextAssembly = trace;
  }

  markIteration(): void {
    this.iterations++;
  }

  recordToolCall(t: ToolCallTrace): void {
    this.toolCalls.push(t);
  }

  setFinishReason(reason: DecisionTrace['finishReason']): void {
    this.finishReason = reason;
  }

  setUsage(usage: Record<string, number> | null): void {
    this.usage = usage;
  }

  build(): DecisionTrace {
    return {
      sessionId: this.sessionId,
      model: this.model,
      provider: this.provider,
      finishReason: this.finishReason,
      iterations: this.iterations,
      toolCalls: this.toolCalls,
      contextAssembly: this.contextAssembly,
      durationMs: Date.now() - this.start,
      usage: this.usage,
    };
  }
}
