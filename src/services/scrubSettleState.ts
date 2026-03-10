export type ScrubSettleStage = 'settle' | 'retry' | 'warmup';

export interface ScrubSettleEntry {
  clipId: string;
  targetTime: number;
  stage: ScrubSettleStage;
  deadlineAt: number;
}

class ScrubSettleState {
  private entries = new Map<string, ScrubSettleEntry>();

  begin(clipId: string, targetTime: number, timeoutMs: number): void {
    this.entries.set(clipId, {
      clipId,
      targetTime,
      stage: 'settle',
      deadlineAt: performance.now() + timeoutMs,
    });
  }

  markRetry(clipId: string, targetTime: number, timeoutMs: number): void {
    this.entries.set(clipId, {
      clipId,
      targetTime,
      stage: 'retry',
      deadlineAt: performance.now() + timeoutMs,
    });
  }

  markWarmup(clipId: string, targetTime: number, timeoutMs: number): void {
    this.entries.set(clipId, {
      clipId,
      targetTime,
      stage: 'warmup',
      deadlineAt: performance.now() + timeoutMs,
    });
  }

  get(clipId?: string): ScrubSettleEntry | undefined {
    if (!clipId) {
      return undefined;
    }
    return this.entries.get(clipId);
  }

  isPending(clipId?: string): boolean {
    return !!clipId && this.entries.has(clipId);
  }

  isDue(clipId?: string): boolean {
    const entry = this.get(clipId);
    return !!entry && performance.now() >= entry.deadlineAt;
  }

  resolve(clipId?: string): void {
    if (!clipId) {
      return;
    }
    this.entries.delete(clipId);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const scrubSettleState = new ScrubSettleState();
