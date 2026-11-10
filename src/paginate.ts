import { SelectQueryBuilder } from "kysely";
import {
  CountedMeta,
  OffsetMeta,
  PaginatedResult,
  wrapInCount,
} from "./pagination.js";

type PaginateOptions<TCounting extends boolean> = {
  page: number;
  limit: number;
  withTotalCount?: TCounting;
};

export type PaginateFn<T> = {
  /***
   * **`KyShape.paginate()`**
   *
   * Fetch an array of rows along with pagination meta data using offset
   * pagination.
   *
   * @see `KyShape.paginateCursor()` for a keyset (cursor) based pagination
   * alternative.
   *
   * @param options.page which page of rows to fetch (1-based)
   * @param options.limit how many records to fetch for each page
   * @param options.withTotalCount Enable extra query to fetch total count of
   * rows matching query
   *
   * @returns The list of rows for the page along with meta data
   * - `items`: array of rows fetched and transformed
   * - `meta`: pagination meta data - `{ page, limit, hasNextPage, hasPreviousPage, totalCount?, totalPages? }`
   *
   * @remarks
   *
   * It calls the query builder `execute()` method.
   *
   * If the `options.withTotalCount` flag is set the `meta` data will include
   * `totalCount` (the total number of rows matching the query), and
   * `totalPages` (the total number of pages in the results). The default is
   * `true` since offset pagination is typically used when a total count
   * and total pages are required for the UI.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * const { items, meta } = await findPerson().paginate({ page: 1, limit: 50 });
   * ```
   */
  (
    options: PaginateOptions<true>,
  ): Promise<PaginatedResult<T, OffsetMeta & CountedMeta>>;
  (options: PaginateOptions<false>): Promise<PaginatedResult<T, OffsetMeta>>;
};

export function paginate<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transformer: (data: O) => T,
) {
  return (async (options: PaginateOptions<boolean>) => {
    const page = Math.floor(options.page);
    const limit = Math.floor(options.limit);
    if (page < 1) {
      throw new Error("Invalid page");
    }
    if (limit < 1) {
      throw new Error("Invalid page size");
    }
    if (options.withTotalCount === false) {
      const itemsPlusOne = await query
        .limit(limit + 1)
        .offset((page - 1) * limit)
        .$castTo<O>()
        .execute();
      const hasNextPage = itemsPlusOne.length > limit;
      const hasPreviousPage = page > 1;
      const items = itemsPlusOne.slice(0, limit);
      return {
        meta: { page, limit, hasNextPage, hasPreviousPage },
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
    const totalCount = Number(count.total);
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1 && totalPages > 0;
    return {
      meta: {
        hasNextPage,
        hasPreviousPage,
        page,
        limit,
        totalCount,
        totalPages,
      },
      items: items.map(transformer),
    };
  }) as PaginateFn<T>;
}
