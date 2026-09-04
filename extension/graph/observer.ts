// Browser DOM/events → MutationObserver → Mutation Queue.
//
// Buffers raw MutationRecords and flushes them in coalesced batches (one per
// animation frame) so a burst of DOM churn becomes a single ApplyDelta pass
// instead of thousands.

export type FlushHandler = (records: MutationRecord[]) => void;

export class DomObserver {
  private mo: MutationObserver;
  private queue: MutationRecord[] = [];
  private scheduled = false;
  private running = false;

  constructor(
    private onFlush: FlushHandler,
    private root: Node = document,
  ) {
    this.mo = new MutationObserver((records) => this.enqueue(records));
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.mo.observe(this.root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
      attributeOldValue: true,
      characterDataOldValue: true,
    });
  }

  stop(): void {
    this.running = false;
    this.mo.disconnect();
    this.queue = [];
  }

  private enqueue(records: MutationRecord[]): void {
    for (const r of records) this.queue.push(r);
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.flushNow();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 0);
  }

  /** Drain the queue immediately (also picks up records not yet delivered). */
  flushNow(): void {
    for (const r of this.mo.takeRecords()) this.queue.push(r);
    if (!this.queue.length) return;
    const batch = this.queue;
    this.queue = [];
    this.onFlush(batch);
  }
}
