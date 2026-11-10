import { SelectQueryBuilder } from "kysely";
import { KyShapeState } from "./types.js";

export type FirstResult<B extends boolean, T> = B extends true
  ? T
  : B extends false
    ? T | undefined
    : never;

export type FirstFn<T, S extends KyShapeState> = {
  /**
   * **KyShape.first()**
   *
   * Retrieve the first matching record of the `KyShape` instances's query builder.
   *
   * @remarks
   *
   * The `.first()` function will call the query builder `executeTakeFirst()`
   * function to efficiently retrieve the first item of the result set.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * const person = await findPerson().first();
   * ```
   *
   * **The `required` flag**
   *
   * If the `KyShape` instance's `required` flag is set the query builder's
   * `executeTakeFirstOrThrow()` function is called. This results in a
   * guarantee that the item will not be undefined.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query).throwIfNotFound();
   * }
   *
   * const person = await findPerson().first();
   * // `person` is _not_ `undefined`
   * ```
   *
   * **The `lazy` flag**
   *
   * If the `KyShapeState` `lazy` flag is set then awaiting the `KyShape`
   * instance will automatically call `.first()`.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query).lazy();
   * }
   *
   * const person = await findPerson();
   * ```
   */
  (): Promise<FirstResult<S["required"], T>>;
};

export function first<DB, TB extends keyof DB, O, T, S extends KyShapeState>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
  state: S,
): FirstFn<T, S> {
  return (state.required
    ? async () => await query.executeTakeFirstOrThrow().then(transform)
    : async () =>
        await query
          .executeTakeFirst()
          .then((data) =>
            data === null ? null : transform(data as O),
          )) as unknown as FirstFn<T, S>;
}
