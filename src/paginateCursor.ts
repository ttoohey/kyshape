import {
  ExtractTypeFromReferenceExpression,
  SelectQueryBuilder,
  StringReference,
} from "kysely";
import {
  buildCompositeOrderBy,
  buildCompositeWhere,
  ColumnConfig,
  ColumnFromColumnConfig,
  ColumnFromColumnConfigTuple,
  Nulls,
} from "./keyset.js";
import {
  CountedMeta,
  Direction,
  ExtractTupleTypes,
  KeysetMeta,
  PaginatedResult,
  wrapInCount,
} from "./pagination.js";

type PaginateCursorOptions<TColumn, TCursor, C extends boolean | undefined> = {
  orderBy: TColumn;
} & (C extends boolean ? { withTotalCount: C } : { withTotalCount?: never }) &
  ({
    limit: number;
    strategy?: "forward" | "reverse";
  } & (
    | { cursor: string | null | undefined; key?: never }
    | { key: TCursor | null | undefined; cursor?: never }
    | { key?: never; cursor?: never }
  ));

type SingleKeyFn<DB, TB extends keyof DB, T> = {
  /**
   * **`KyShape.paginateCursor()`**
   *
   * Keyset (cursor) based pagination.
   *
   * @see `KyShape.paginate()` for an offset pagination alternative.
   *
   * @param options.orderBy The index used to identify page boundaries.
   * @param options.orderBy.column Column reference
   * @param options.orderBy.direction Order by direction (default 'asc')
   * @param options.orderBy.nulls Whether nulls will appear first or last (default 'never')
   * @param options.orderBy.toCursor Convert from database type to JSON-compatible value for encoding in cursor string
   * @param options.orderBy.fromCursor Convert from JSON-compatible value to database type for decoding cursor string
   * @param options.limit Count of records to fetch
   * @param options.strategy Set the direction of search
   * @param options.cursor Opaque reference cursor for the page
   * @param options.key Raw reference cursor for the page
   * @param options.withTotalCount Enable extra query to fetch total count of records matching query
   *
   * @returns The list of items for the page along with meta data with next/previous links
   * - `items`: array of records fetched and transformed
   * - `meta`: pagination meta data - `{ hasNextCursor, hasPreviousCursor, nextCursor, previousCursor }`
   *
   * @remarks
   *
   * The `options.orderBy` parameter may be a single column reference, or a
   * composite reference (an array of column references). If entered as a string,
   * the defaults (`{ direction: 'asc', nulls: 'never' }`) are used. These may
   * be overridden by providing a configured column reference
   * (`{ column }`).
   *
   * The `orderBy` index must identify unique records in the table (this is
   * typically achieved by using a composite index with the table's primary key
   * as the final element). If an element in a composite index is a nullable
   * column, set the `nulls` property to `first` or `last`, only use the
   * default `never` for columns that are non-nullable.
   *
   * `options.orderBy` sets the query's `ORDER BY` expression.
   *
   * Only one of `options.cursor` or `options.key` may be supplied. The shape
   * of `options.key` is dependant on the shape of `options.orderBy`. For a
   * non-composite index it will be the type of the index's column. For a
   * composite index it will be a tuple of the index's column types.
   *
   * If the `options.withTotalCount` flag is set the `meta` data will include
   * `totalCount` (the total number of rows matching the query), and
   * `totalPages` (the total number of pages in the results). The default is
   * `false` since keyset pagination is typically used for efficiency and adding
   * an extra query to calculate the total number records is rarely required.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * const { items, meta } = await findPerson().paginateCursor({
   *   orderBy: "id",
   *   limit: 50
   * });
   *
   * if (meta.hasNextCursor) {
   *   const nextPage = await findPerson().paginateCursor({
   *     orderBy: "id",
   *     limit: 50,
   *     cursor: meta.nextCursor,
   *   });
   *   // OR: using `key` instead of `cursor`
   *   const nextPage = await findPerson().paginateCursor({
   *     orderBy: "id",
   *     limit: 50,
   *     key: meta.nextKey,
   *   });
   *
   *   // back to the previous page
   *   const previousPage = await findPerson().paginateCursor({
   *     orderBy: "id",
   *     limit: 50,
   *     strategy: 'reverse',
   *     cursor: nextPage.meta.previousCursor,
   *   });
   * }
   *
   * // composite orderBy index
   * const result = await findPerson().paginateCursor({
   *   orderBy: [
   *     { column: "last_name", nulls: "last" },
   *     { column: "first_name", nulls: "last" },
   *     "id", // unique, non-nullable as final element to ensure index is unique
   *   ],
   *   limit: 50
   * });
   * ```
   *
   * **Using column `toCursor()` and `fromCursor()` callbacks**
   *
   * To allow control over the encoding and decoding steps of the opaque cursor
   * string, the column configuration `toCursor()` and `fromCursor()` callbacks
   * may be used. These are transformation functions, typically the inverse of
   * each other.
   *
   * @example
   *
   *
   * ```ts
   * // Encode a timestamp column as a numeric Unix timestamp (seconds since epoch)
   * const result = await findPerson().paginateCursor({
   *    orderBy: {
   *      column: "created_at",
   *      toCursor: (d: Date) => d.getTime() / 1_000,
   *      fromCursor: (s: number) => new Date(s * 1_000),
   *    },
   * });
   *
   * // The resulting cursor in `result.meta.nextCursor` can be decoded and read
   * const buf = Buffer.from(result.meta.nextCursor, 'base64');
   * const key: number = JSON.parse(buf.toString()).v;
   * ```
   * `key` is the numeric Unix timestamp
   *
   * Note: `Date` values are automatically converted to their ISO string
   * representation and don't require custom logic, the above is for demonstration
   * purposes only.
   */
  <
    const TColumn extends ColumnConfig<DB, TB>,
    TCursor extends ExtractTypeFromReferenceExpression<DB, TB, TColumn>,
  >(
    options: PaginateCursorOptions<TColumn, TCursor, true>,
  ): Promise<PaginatedResult<T, KeysetMeta<TCursor> & CountedMeta>>;
  <
    const TColumn extends ColumnConfig<DB, TB>,
    TCursor extends ExtractTypeFromReferenceExpression<
      DB,
      TB,
      ColumnFromColumnConfig<TColumn>
    >,
  >(
    options: PaginateCursorOptions<TColumn, TCursor, false | undefined>,
  ): Promise<PaginatedResult<T, KeysetMeta<TCursor>>>;
};

type CompositeKeyFn<DB, TB extends keyof DB, T> = {
  <
    const TColumn extends readonly ColumnConfig<DB, TB>[],
    TCursor extends ExtractTupleTypes<
      DB,
      TB,
      ColumnFromColumnConfigTuple<TColumn>
    >,
  >(
    options: PaginateCursorOptions<TColumn, TCursor, true>,
  ): Promise<PaginatedResult<T, KeysetMeta<TCursor> & CountedMeta>>;
  <
    const TColumn extends readonly ColumnConfig<DB, TB>[],
    TCursor extends ExtractTupleTypes<
      DB,
      TB,
      ColumnFromColumnConfigTuple<TColumn>
    >,
  >(
    options: PaginateCursorOptions<TColumn, TCursor, false | undefined>,
  ): Promise<PaginatedResult<T, KeysetMeta<TCursor>>>;
};

export type PaginateCursorFn<DB, TB extends keyof DB, T> = SingleKeyFn<
  DB,
  TB,
  T
> &
  CompositeKeyFn<DB, TB, T>;

const stringifyCursorKey = (
  columnsConfig: readonly ColumnConfig<any, any>[],
  value: unknown,
) => {
  const c = columnsConfig.map((cc) =>
    typeof cc === "string" ? cc : cc.column,
  );
  const safeValue = (v: unknown): unknown => {
    if (v === null || v === undefined) {
      return null;
    }
    if (Array.isArray(v)) {
      return v.map(safeValue);
    }
    if (typeof v === "bigint") {
      return String(v);
    }
    if (v instanceof Date) {
      return v.toISOString();
    }
    if (typeof v === "object") {
      return Object.fromEntries(
        Object.entries(([k, v]: [string, unknown]) => [k, safeValue(v)]),
      );
    }
    return v;
  };
  const v = (() => {
    if (Array.isArray(value)) {
      return value.map((v, i) => {
        if (v === null) {
          return null;
        }
        const col = columnsConfig[i];
        const fn = typeof col === "string" ? null : col.toCursor;
        return safeValue(typeof fn === "function" ? fn(v) : v);
      });
    } else {
      if (value === null) {
        return null;
      }
      const col = columnsConfig[0];
      const fn = typeof col === "string" ? null : col.toCursor;
      return safeValue(typeof fn === "function" ? fn(value) : value);
    }
  })();
  return Buffer.from(JSON.stringify({ v, c })).toString("base64");
};

const parseCursorKey = (
  columnsConfig: readonly ColumnConfig<any, any>[],
  value: string,
) => {
  const columns = columnsConfig.map((cc) =>
    typeof cc === "string" ? cc : cc.column,
  );
  const { v, c } = JSON.parse(Buffer.from(value, "base64").toString());
  if (!columns.every((col, i) => col === c[i])) {
    throw new Error("Unexpected cursor columns");
  }
  const parsedValue = (() => {
    if (Array.isArray(v)) {
      return v.map((value, i) => {
        if (value === null) {
          return null;
        }
        const col = columnsConfig[i];
        const fn = typeof col === "string" ? null : col.fromCursor;
        return typeof fn === "function" ? fn(value) : value;
      });
    } else {
      if (v === null) {
        return [null];
      }
      const col = columnsConfig[0];
      const fn = typeof col === "string" ? null : col.fromCursor;
      return [typeof fn === "function" ? fn(v) : v];
    }
  })();
  return parsedValue;
};

const keyAlias = (i: number) => `__paginate_cursor_${i}`;

export function paginateCursor<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
) {
  return async function <
    const TColumn extends
      StringReference<DB, TB> | readonly StringReference<DB, TB>[],
    TCursor extends (TColumn extends any[]
      ? ExtractTupleTypes<DB, TB, ColumnFromColumnConfigTuple<TColumn>>
      : TColumn extends string
        ? ExtractTypeFromReferenceExpression<
            DB,
            TB,
            ColumnFromColumnConfig<TColumn>
          >
        : never),
  >(options: PaginateCursorOptions<TColumn, TCursor, boolean>) {
    const isReverse = options.strategy === "reverse";
    const limit = options.limit;
    const cursor = options.cursor;
    const isComposite = Array.isArray(options.orderBy);
    const columnsConfig = isComposite
      ? (options.orderBy as readonly ColumnConfig<DB, TB>[])
      : [options.orderBy as ColumnConfig<DB, TB>];

    const columns = columnsConfig.map((cc) =>
      typeof cc === "string" ? cc : cc.column,
    );
    const directions: Direction[] = columnsConfig.map((cc) =>
      typeof cc === "string" ? "asc" : (cc.direction ?? "asc"),
    );
    const nulls: Nulls[] = columnsConfig.map((cc) =>
      typeof cc === "string" ? "never" : (cc.nulls ?? "never"),
    );

    const cursorOf = (row: Record<string, unknown>): unknown | unknown[] =>
      isComposite ? columns.map((_, i) => row[keyAlias(i)]) : row[keyAlias(0)];
    const stripKeys = (row: Record<string, unknown>) => {
      const out = { ...row };
      columns.forEach((_, i) => delete out[keyAlias(i)]);
      return out as O;
    };

    const itemsQuery = query
      .clearLimit()
      .clearOffset()
      .clearOrderBy()
      .limit(limit + 1)
      .select((eb) => columns.map((col, i) => eb.ref(col).as(keyAlias(i))))
      .$if(isComposite, (q) =>
        q
          .$call(buildCompositeOrderBy(columns, directions, nulls))
          .$if(options.key !== undefined, (q) => {
            const cursor = options.key! as ExtractTupleTypes<DB, TB, any[]>;
            return q.where((eb) =>
              buildCompositeWhere(eb, columns, directions, nulls, cursor),
            );
          })
          .$if(options.cursor !== undefined, (q) => {
            const cursor = parseCursorKey(columnsConfig, options.cursor!);
            return q.where((eb) =>
              buildCompositeWhere(eb, columns, directions, nulls, cursor),
            );
          }),
      )
      .$if(!isComposite, (q) =>
        q
          .$call(buildCompositeOrderBy(columns, directions, nulls))
          .$if(options.key !== undefined, (q) => {
            const cursor = [options.key!];
            return q.where((eb) =>
              buildCompositeWhere(eb, columns, directions, nulls, cursor),
            );
          })
          .$if(options.cursor !== undefined, (q) => {
            const cursor = parseCursorKey(columnsConfig, options.cursor!);
            return q.where((eb) =>
              buildCompositeWhere(eb, columns, directions, nulls, cursor),
            );
          }),
      );

    const getMeta = (itemsPlusOne: Record<string, unknown>[]) => {
      const items = itemsPlusOne.slice(0, limit);
      if (isReverse) {
        items.reverse();
      }
      const hasNextCursor =
        (isReverse && cursor !== undefined) ||
        (!isReverse && itemsPlusOne.length > limit);
      const hasPreviousCursor =
        (!isReverse && cursor !== undefined) ||
        (isReverse && itemsPlusOne.length > limit);
      const firstRow = items.at(0);
      const lastRow = items.at(-1);
      const first = firstRow ? cursorOf(firstRow) : null;
      const last = lastRow ? cursorOf(lastRow) : null;
      const nextKey = hasNextCursor ? last : null;
      const previousKey = hasPreviousCursor ? first : null;
      const nextCursor =
        nextKey === null ? null : stringifyCursorKey(columnsConfig, nextKey);
      const previousCursor =
        previousKey === null
          ? null
          : stringifyCursorKey(columnsConfig, previousKey);

      return [
        items,
        {
          hasNextCursor,
          hasPreviousCursor,
          nextCursor,
          previousCursor,
          nextKey,
          previousKey,
        },
      ] as const;
    };

    if (options.withTotalCount !== true) {
      const itemsPlusOne = await itemsQuery.execute();
      const [items, meta] = getMeta(itemsPlusOne);
      return {
        items: items.map(stripKeys).map(transform),
        meta,
      };
    }
    const countQuery = query
      .clearLimit()
      .clearOffset()
      .clearOrderBy()
      .withPlugin(wrapInCount)
      .$castTo<{ total: bigint | string }>();
    const [count, itemsPlusOne] = await Promise.all([
      countQuery.executeTakeFirstOrThrow(),
      itemsQuery.execute(),
    ]);
    const totalCount = Number(count.total);
    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);
    const [items, meta] = getMeta(itemsPlusOne);

    return {
      items: items.map(stripKeys).map(transform),
      meta: {
        ...meta,
        totalCount,
        totalPages,
      },
    };
  } as PaginateCursorFn<DB, TB, T>;
}
