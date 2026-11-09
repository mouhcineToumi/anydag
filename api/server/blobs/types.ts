/**
 * Where sealed bytes live: a port, with one adapter, `disk.ts`. Another
 * store — S3, GCS — is another adapter and nothing else. **Frozen**.
 *
 * The store knows a vault id and a blob id and nothing about what either means: it never sees a
 * plaintext, and it never checks an id against the bytes (it cannot: the id is a keyed hash).
 */

export interface Blobs {
  /**
   * Store `bytes` under `id`. Written whole or not at all (a temp file, then a rename). A blob already
   * held is kept as it is and the call succeeds: two devices uploading one id race harmlessly.
   */
  put(vault: string, id: string, bytes: Uint8Array): Promise<void>;
  get(vault: string, id: string): Promise<Uint8Array | null>;
  /** The stored size, or `null` when absent. */
  size(vault: string, id: string): Promise<number | null>;
  /** Remove every id given that is held; an absent one is nothing. */
  delete(vault: string, ids: readonly string[]): Promise<void>;
  /** Every id held for a vault — what the collector compares against the index. */
  list(vault: string): AsyncIterable<string>;
}
