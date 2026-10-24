import { SelectQueryBuilder } from "kysely";

export type ListFn<T> = {
  /**
   * **Pipeline.list()**
   *
   * Retrieve an array of records from the pipeline's query builder.
   *
   * @remarks
   *
   * The `.list()` function will call the query builder `execute()` function
   * to retrieve the results.
   *
   * The optional `limit` and `offset` parameters allow fetching a slice of
   * the total results.
   *
   * See `Pipeline.page()` and `Pipeline.seek()` for alternative strategies
   * for listing results.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * const people = await findPerson().list(100);
   * // `people` is an array (length up to 100) of Person objects
   * ```
   */
  (limit?: number, offet?: number): Promise<T[]>;
};

export function list<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
): ListFn<T> {
  return (limit?: number, offset?: number) =>
    query
      .$if(limit !== undefined, (q) => q.limit(limit!))
      .$if(offset !== undefined, (q) => q.offset(offset!))
      .execute()
      .then((items) => items.map(transform));
}
