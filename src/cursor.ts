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
import { Direction, ExtractTupleTypes } from "./pagination.js";

type SingleKeyFn<DB, TB extends keyof DB, T> = {
  /**
   * **`Pipeline.cursor()`**
   *
   * Keyset (cursor) based streaming.
   *
   * A memory safe way to batch process a large database result set. Recommended
   * for long running background processes where a database transaction should
   * not be held open.
   *
   * @see `Pipeline.stream()` for a transaction based streaming alternative.
   *
   * @param index The index used to identify chunk boundaries
   * @param index.column Column reference
   * @param index.direction Order by direction (default 'asc')
   * @param index.nulls Whether nulls will appear first or last (default 'never')
   * @param options Configuration settings
   * @param options.batchSize Number of records to fetch in each batch (default 1,000)
   *
   * @remarks
   *
   * The `index` parameter may be a single column reference, or a
   * composite reference (an array of column references). If entered as a string,
   * the defaults (`{ direction: 'asc', null: 'never' }`) are used. These may be
   * overridden by providing a configured column reference
   * (`{ column }`)
   *
   * The index must identify unique records in the table (this is typically
   * achieved by using a composite index with the table's primary key as the
   * final element). If an element in a composite index is a nullable column,
   * set the `nulls` property to `first` or `last`, only use the default `never`
   * for columns that are non-nullable.
   *
   * `index` sets the query's `ORDER BY` expression.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * for await (const item of findPerson().cursor("id")) {
   *   // process each `item`
   * }
   *
   * // using a composite index
   * const stream = findPerson().cursor([
   *   { column: "last_name", nulls: "last" },
   *   { column: "first_name", nulls: "last" },
   *   id, // unique, non-nullable as final element to ensure index is unique
   * ]);
   * for await (const item of stream) {
   *   // process each `item`
   * }
   * ```
   */
  <
    const TColumn extends ColumnConfig<DB, TB>,
    TCursor extends ExtractTypeFromReferenceExpression<
      DB,
      TB,
      ColumnFromColumnConfig<TColumn>
    >,
  >(
    index: TColumn,
    options?: CursorOptions<TCursor>,
  ): AsyncGenerator<T>;
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
    index: TColumn,
    options?: CursorOptions<TCursor>,
  ): AsyncGenerator<T>;
};

type CursorOptions<TCursor> = {
  key?: TCursor;
  batchSize?: number;
};

export type CursorFn<DB, TB extends keyof DB, T> = SingleKeyFn<DB, TB, T> &
  CompositeKeyFn<DB, TB, T>;

const keyAlias = (i: number) => `__pipeline_cursor_${i}`;

export function cursor<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
) {
  return async function* <
    const TColumn extends
      StringReference<DB, TB> | readonly StringReference<DB, TB>[],
    TCursor extends (TColumn extends unknown[]
      ? ExtractTupleTypes<DB, TB, any>
      : ExtractTypeFromReferenceExpression<DB, TB, TColumn>),
  >(index: TColumn, options?: CursorOptions<TCursor>) {
    let key = options?.key;
    const { batchSize = 1_000 } = options ?? {};
    const isComposite = Array.isArray(index);
    const columnsConfig = isComposite
      ? (index as readonly ColumnConfig<DB, TB>[])
      : [index as ColumnConfig<DB, TB>];

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

    do {
      const itemsQuery = query
        .clearLimit()
        .clearOrderBy()
        .select((eb) => columns.map((col, i) => eb.ref(col).as(keyAlias(i))))
        .limit(batchSize)
        .$if(isComposite, (q) =>
          q
            .$call(buildCompositeOrderBy(columns, directions, nulls))
            .$if(key !== undefined, (q) => {
              const cursor = key! as ExtractTupleTypes<DB, TB, any[]>;
              return q.where((eb) =>
                buildCompositeWhere(eb, columns, directions, nulls, cursor),
              );
            }),
        )
        .$if(!isComposite, (q) =>
          q
            .$call(buildCompositeOrderBy(columns, directions, nulls))
            .$if(key !== undefined, (q) =>
              q.where((eb) =>
                buildCompositeWhere(eb, columns, directions, nulls, [key!]),
              ),
            ),
        );
      console.log(itemsQuery.compile());
      const items: Record<string, unknown>[] = await itemsQuery.execute();
      for (const item of items) {
        yield transform(stripKeys(item));
      }
      if (items.length < batchSize) {
        break;
      }
      const lastRow = items.at(-1);
      key = lastRow === undefined ? undefined : (cursorOf(lastRow) as TCursor);
    } while (key !== undefined);
  } as CursorFn<DB, TB, T>;
}
