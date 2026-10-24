type RetryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** One ID per unconfirmed upload intent. A confirmed receipt ends that intent. */
export class SubmissionIntents {
  private readonly pending = new Map<string, string | null>();

  constructor(
    private readonly storage: () => RetryStorage | null,
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  requestId(key: string): string {
    let id = this.pending.get(key);
    if (!this.pending.has(key)) {
      try {
        id = this.storage()?.getItem(key);
      } catch {
        // Storage restrictions must not prevent a permitted upload.
      }
    }
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      id = this.newId();
    this.pending.set(key, id);
    try {
      this.storage()?.setItem(key, id);
    } catch {
      // Keep the same ID in memory for an ambiguous network retry.
    }
    return id;
  }

  confirm(key: string): void {
    // The tombstone also prevents a stale stored ID being reused if removal is blocked.
    this.pending.set(key, null);
    try {
      this.storage()?.removeItem(key);
    } catch {
      // The confirmed receipt remains valid when browser storage is unavailable.
    }
  }
}
