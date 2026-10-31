import { sleepWithSignal } from "../utils";

export class SpeedMeter {
  private samples: Array<{ time: number; bytes: number }> = [];
  private bytes: number;

  constructor(startBytes = 0) {
    this.bytes = startBytes;
    this.samples.push({ time: Date.now(), bytes: startBytes });
  }

  add(bytes: number): void {
    this.bytes += bytes;
    this.push();
  }

  set(bytes: number): void {
    this.bytes = bytes;
    this.push();
  }

  private push(): void {
    const now = Date.now();
    this.samples.push({ time: now, bytes: this.bytes });
    this.prune(now);
  }

  private prune(now: number): void {
    const cutoff = now - 4_000;
    while (this.samples.length > 2 && (this.samples[0]?.time ?? now) < cutoff) {
      this.samples.shift();
    }
  }

  rate(now = Date.now()): number {
    this.prune(now);
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    if (!first || !last || this.samples.length < 2) return 0;
    const elapsed = (last.time - first.time) / 1000;
    if (elapsed <= 0) return 0;
    return Math.max(0, Math.round((last.bytes - first.bytes) / elapsed));
  }
}

export class RateLimiter {
  private limit = 0;
  private tokens = 0;
  private capacity = 0;
  private last = Date.now();

  constructor(limit: number) {
    this.setLimit(limit);
  }

  setLimit(limit: number): void {
    const next = Math.max(0, Math.round(limit));
    if (next === this.limit) return;
    this.limit = next;
    this.capacity =
      next > 0
        ? Math.max(64 * 1024, Math.min(next, 1024 * 1024))
        : 0;
    // Start with an empty bucket so the limit applies immediately instead of
    // allowing a large speed-limit-sized burst on every download.
    this.tokens = 0;
    this.last = Date.now();
  }

  private refill(): void {
    if (this.limit <= 0) return;
    const now = Date.now();
    const elapsed = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(
      this.capacity,
      this.tokens + (elapsed * this.limit) / 1000,
    );
  }

  async take(bytes: number, signal: AbortSignal): Promise<void> {
    if (this.limit <= 0 || bytes <= 0) return;
    let remaining = bytes;
    while (remaining > 0) {
      const slice = Math.min(remaining, this.capacity);
      this.refill();
      while (this.tokens < slice) {
        const missing = slice - this.tokens;
        const wait = Math.max(4, Math.ceil((missing / this.limit) * 1000));
        await sleepWithSignal(Math.min(wait, 750), signal);
        this.refill();
      }
      this.tokens -= slice;
      remaining -= slice;
    }
  }
}

