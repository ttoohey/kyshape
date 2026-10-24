import { SelectQueryBuilder } from "kysely";
import {
  CountedMeta,
  OffsetMeta,
  PaginatedResult,
  wrapInCount,
} from "./pagination.js";

type PageOptions<TCounting extends boolean> = {
  counting: TCounting;
};

export type PageFn<T> = {
  /***
   * **`Pipeline.page()`**
   *
   * Return an array of results along with pagination meta data
   * using offset pagination.
   *
   * @see `Pipeline.seek()` for a keyset (cursor) based pagination alternative.
   *
   * @param page which page of results to return (1-based)
   * @param limit how many records to fetch for each page
   * @param options.counting Enable extra query to fetch total count of records matching query
   *
   * @returns The list of items for the page along with meta data
   * - `items`: array of records fetched and transformed
   * - `meta`: pagination meta data - `{ page, limit, hasNext, hasPrevious, totalItems?, totalPages? }`
   *
   * @remarks
   *
   * It calls the query builder `execute()` method.
   *
   * If the `options.counting` flag is set the `meta` data will include
   * `totalItems` (the total number of items matching the query), and
   * `totalPages` (the total number of pages in the results). The default is
   * `true` since offset pagination is typically used when a total count
   * and total pages are required for the UI.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * const { items, meta } = await findPerson().page(1, 50);
   * ```
   */
  (
    page: number,
    limit: number,
    options: PageOptions<true>,
  ): Promise<PaginatedResult<T, OffsetMeta & CountedMeta>>;
  (
    page: number,
    limit: number,
    options: PageOptions<false>,
  ): Promise<PaginatedResult<T, OffsetMeta>>;
  (
    page: number,
    limit: number,
  ): Promise<PaginatedResult<T, OffsetMeta & CountedMeta>>;
};

export function page<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transformer: (data: O) => T,
) {
  return (async (
    page: number,
    limit: number,
    options?: { counting: boolean },
  ) => {
    page = Math.floor(page);
    limit = Math.floor(limit);
    if (page < 1) {
      throw new Error("Invalid page");
    }
    if (limit < 1) {
      throw new Error("Invalid page size");
    }
    if (options?.counting === false) {
      const itemsPlusOne = await query
        .limit(limit + 1)
        .offset((page - 1) * limit)
        .$castTo<O>()
        .execute();
      const hasNext = itemsPlusOne.length > limit;
      const hasPrevious = page > 1;
      const items = itemsPlusOne.slice(0, limit);
      return {
        meta: { page, limit, hasNext, hasPrevious },
        items: items.map(transformer),
      };
    }
    const countQuery = query
      .clearLimit()
      .clearOffset()
      .clearOrderBy()
      .withPlugin(wrapInCount)
      .$castTo<{ total: bigint | string }>();
    const itemsQuery = query
      .clearLimit()
      .clearOffset()
      .limit(limit)
      .offset((page - 1) * limit)
      .$castTo<O>();
    const [count, items] = await Promise.all([
      countQuery.executeTakeFirstOrThrow(),
      itemsQuery.execute(),
    ]);
    const totalItems = Number(count.total);
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);
    const hasNext = page < totalPages;
    const hasPrevious = page > 1 && totalPages > 0;
    return {
      meta: { hasNext, hasPrevious, page, limit, totalItems, totalPages },
      items: items.map(transformer),
    };
  }) as PageFn<T>;
}
