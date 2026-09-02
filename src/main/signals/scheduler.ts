const defaultMaxMs = 60 * 60_000;

export function nextDelayMs(input: {
  baseMs: number;
  failures: number;
  rng: () => number;
  maxMs?: number;
}): number {
  const max = input.maxMs ?? defaultMaxMs;
  const backoff = Math.min(input.baseMs * 2 ** Math.max(0, input.failures), max);
  return Math.round(backoff * (0.5 + input.rng()));
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SchedulerOptions {
  baseMs: () => number;
  run: () => Promise<void>;
  onSchedule?: (nextAtMs: number) => void;
  rng?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
  now?: () => number;
}

export class Scheduler {
  private readonly opts: SchedulerOptions;
  private failures = 0;
  private timer: TimerHandle | undefined;
  private next: number | undefined;
  private running: Promise<void> | undefined;
  private active = false;

  constructor(opts: SchedulerOptions) {
    this.opts = opts;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.cycle();
  }

  stop(): void {
    this.active = false;
    this.cancel();
  }

  async runNow(): Promise<void> {
    this.cancel();
    await this.cycle();
  }

  nextAt(): number | undefined {
    return this.next;
  }

  private cancel(): void {
    if (this.timer !== undefined) {
      (this.opts.clearTimeoutFn ?? clearTimeout)(this.timer);
      this.timer = undefined;
    }
    this.next = undefined;
  }

  private async cycle(): Promise<void> {
    if (this.running !== undefined) {
      await this.running;
      return;
    }
    this.running = this.execute();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
    if (this.active) this.schedule();
  }

  private async execute(): Promise<void> {
    try {
      await this.opts.run();
      this.failures = 0;
    } catch {
      this.failures += 1;
    }
  }

  private schedule(): void {
    this.cancel();
    const delay = nextDelayMs({
      baseMs: this.opts.baseMs(),
      failures: this.failures,
      rng: this.opts.rng ?? Math.random,
    });
    this.next = (this.opts.now ?? Date.now)() + delay;
    this.timer = (this.opts.setTimeoutFn ?? setTimeout)(() => {
      this.timer = undefined;
      void this.cycle();
    }, delay);
    this.opts.onSchedule?.(this.next);
  }
}
