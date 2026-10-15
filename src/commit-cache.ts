/**
 * Caches data loaded per commit id. Commit ids are content addressed, so cached data never goes
 * stale. Failed loads are evicted so they are retried, and the oldest entries are dropped beyond
 * the limit. Settled values are also available synchronously.
 */
export class CommitCache<T> {
  private readonly pending = new Map<string, Promise<T>>();
  private readonly settled = new Map<string, T>();

  constructor(private readonly limit: number) {}

  has(commitId: string): boolean {
    return this.pending.has(commitId);
  }

  getSettled(commitId: string): T | undefined {
    return this.settled.get(commitId);
  }

  /**
   * Returns the cached load for the commit, starting `load` when there is none or the cached
   * one fails.
   */
  load(commitId: string, load: () => Promise<T>): Promise<T> {
    const start = () => this.set(commitId, load());
    return this.pending.get(commitId)?.catch(start) ?? start();
  }

  set(commitId: string, promise: Promise<T>): Promise<T> {
    this.pending.delete(commitId);
    this.settled.delete(commitId);
    this.pending.set(commitId, promise);
    promise.then(
      (value) => {
        if (this.pending.get(commitId) === promise) {
          this.settled.set(commitId, value);
        }
      },
      () => {
        if (this.pending.get(commitId) === promise) {
          this.pending.delete(commitId);
        }
      },
    );
    while (this.pending.size > this.limit) {
      const oldest = this.pending.keys().next().value!;
      this.pending.delete(oldest);
      this.settled.delete(oldest);
    }
    return promise;
  }

  setValue(commitId: string, value: T): void {
    void this.set(commitId, Promise.resolve(value));
    this.settled.set(commitId, value);
  }

  clear(): void {
    this.pending.clear();
    this.settled.clear();
  }
}
