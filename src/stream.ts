import { SelectQueryBuilder, StreamOptions } from "kysely";

export type StreamFn<T> = {
  /**
   * **Pipeline.stream()**
   *
   * Transaction-based streaming.
   *
   * A memory safe way to process a database result set. Recommended for
   * short running processes where holding a database transaction open for
   * the duration is acceptable.
   *
   * @see `Pipeline.cursor()` for a keyset (cursor) based alternative.
   *
   * @param chunkSizeOrOptions see Kysely `SelectQueryBuilder.stream`
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * for await (const item of findPerson().stream()) {
   *   // process `item`
   * }
   * ```
   *
   * **Pipeline `lazy` mode**
   *
   * A pipeline with the `lazy` flag set will call `.stream()` automatically
   * when used in a `for await..of` loop.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query).lazy();
   * }
   *
   * for await (const item of findPerson()) {
   *   // process `item`
   * }
   * ```
   */
  (chunkSizeOrOptions?: number | StreamOptions): AsyncIterable<T>;
};

export function stream<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
): StreamFn<T> {
  return async function* (chunkSizeOrOptions?: number | StreamOptions) {
    for await (const item of query.stream(chunkSizeOrOptions)) {
      yield transform(item);
    }
  };
}
