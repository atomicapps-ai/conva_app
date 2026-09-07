/**
 * Operation registry — the cancellation contract every long backend operation
 * follows (browser architecture §8: "all long operations accept an operation
 * ID and cancellation contract … late results with a canceled operation ID
 * are ignored and disposed").
 *
 * Pure bookkeeping — no timers, no AbortController wiring (adapters own that
 * and call {@link OperationRegistry.cancel}). Deterministic for tests.
 */

export type OperationStatus = "running" | "completed" | "cancelled";

export interface OperationRecord {
  id: string;
  /** Free-form kind label for diagnostics (`ally.run`, `session.start`…). */
  kind: string;
  status: OperationStatus;
  /** Late results seen after cancel/complete — counted, never applied. */
  ignoredResults: number;
}

export class OperationRegistry {
  private ops = new Map<string, OperationRecord>();

  /** Register a new operation; re-using a live id is a programming error. */
  begin(id: string, kind: string): OperationRecord {
    const existing = this.ops.get(id);
    if (existing && existing.status === "running") {
      throw new Error(`operation "${id}" is already running`);
    }
    const rec: OperationRecord = { id, kind, status: "running", ignoredResults: 0 };
    this.ops.set(id, rec);
    return rec;
  }

  /** Mark cancelled. Returns false when the id is unknown or already settled. */
  cancel(id: string): boolean {
    const rec = this.ops.get(id);
    if (!rec || rec.status !== "running") return false;
    rec.status = "cancelled";
    return true;
  }

  /** Mark completed. Returns false when the id is unknown or already settled. */
  complete(id: string): boolean {
    const rec = this.ops.get(id);
    if (!rec || rec.status !== "running") return false;
    rec.status = "completed";
    return true;
  }

  /**
   * Gate for a result arriving for `id`: true when it should be applied.
   * A result for a cancelled/completed/unknown operation is counted as
   * ignored and must be disposed by the caller.
   */
  accept(id: string): boolean {
    const rec = this.ops.get(id);
    if (!rec) return false;
    if (rec.status === "running") return true;
    rec.ignoredResults += 1;
    return false;
  }

  status(id: string): OperationStatus | null {
    return this.ops.get(id)?.status ?? null;
  }

  get(id: string): OperationRecord | undefined {
    return this.ops.get(id);
  }

  /** Cancel every running operation (session stop / page unload). */
  cancelAll(): string[] {
    const cancelled: string[] = [];
    for (const rec of this.ops.values()) {
      if (rec.status === "running") {
        rec.status = "cancelled";
        cancelled.push(rec.id);
      }
    }
    return cancelled;
  }

  /** Drop settled records (memory hygiene); running ones stay. */
  prune(): number {
    let n = 0;
    for (const [id, rec] of this.ops) {
      if (rec.status !== "running") {
        this.ops.delete(id);
        n += 1;
      }
    }
    return n;
  }
}
