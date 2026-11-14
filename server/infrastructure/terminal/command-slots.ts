import os from 'node:os';

export interface SlotHolder { owner: string; command: string; since: number }
export interface SlotWaiter { owner: string; command: string; since: number }
export interface SlotLease { release(): void; waitedMs: number }
export class SlotTimeoutError extends Error {
  constructor(readonly waitedMs: number) { super('Timed out waiting for a free command slot'); }
}

interface Waiter extends SlotWaiter { grant(lease: SlotLease): void; fail(error: Error): void }

// A quarter of the cores, at least two: heavy commands (tests, builds, type checks) are CPU-bound and several of them already saturate a machine.
export const autoSlotLimit = () => Math.max(2, Math.floor((os.availableParallelism?.() ?? os.cpus().length) / 4));
let configured: () => number = () => 0;
/** `read` returns the developer's number of slots; 0 or less means the automatic value. */
export function configureSlotLimit(read: () => number): void { configured = read; }
export function slotLimit(): number {
  const value = Math.floor(configured());
  return Number.isFinite(value) && value > 0 ? value : autoSlotLimit();
}

const holders = new Set<SlotHolder>();
const queue: Waiter[] = [];

function drain(): void {
  while (queue.length && holders.size < slotLimit()) {
    const waiter = queue.shift()!;
    const holder: SlotHolder = { owner: waiter.owner, command: waiter.command, since: Date.now() };
    holders.add(holder);
    let released = false;
    waiter.grant({ waitedMs: holder.since - waiter.since, release() {
      if (released) return;
      released = true;
      holders.delete(holder);
      drain();
    } });
  }
}

/** First come, first served. Rejects with `SlotTimeoutError` or the signal's reason. */
export function acquireSlot(owner: string, command: string, options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<SlotLease> {
  const { signal, timeoutMs } = options;
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const leave = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const index = queue.indexOf(waiter);
      if (index >= 0) queue.splice(index, 1);
    };
    const onAbort = () => { leave(); reject(signal!.reason ?? new Error('Aborted')); };
    const waiter: Waiter = { owner, command, since: Date.now(),
      grant: lease => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); resolve(lease); },
      fail: error => { leave(); reject(error); } };
    queue.push(waiter);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs && timeoutMs > 0) timer = setTimeout(() => waiter.fail(new SlotTimeoutError(Date.now() - waiter.since)), timeoutMs);
    drain();
  });
}

export function slotStatus(): { limit: number; running: SlotHolder[]; waiting: SlotWaiter[] } {
  return { limit: slotLimit(), running: [...holders].map(({ owner, command, since }) => ({ owner, command, since })),
    waiting: queue.map(({ owner, command, since }) => ({ owner, command, since })) };
}
