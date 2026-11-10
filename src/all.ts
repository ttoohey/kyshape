import { SelectQueryBuilder, StringReference } from "kysely";
import { buildCompositeOrderBy, Nulls } from "./keyset.js";
import { Direction } from "./pagination.js";

type ColumnConfig<DB, TB extends keyof DB> =
  | StringReference<DB, TB>
  | {
      column: StringReference<DB, TB>;
      direction?: "asc" | "desc";
      nulls?: "first" | "last" | "never";
    };

type AllOptions<DB, TB extends keyof DB> = {
  limit?: number;
  offset?: number;
  orderBy?: ColumnConfig<DB, TB> | readonly ColumnConfig<DB, TB>[];
};

export type AllFn<DB, TB extends keyof DB, T> = {
  /**
   * **KyShape.all()**
   *
   * Fetch an array of rows from the `KyShape` instance's query builder.
   *
   * @remarks
   *
   * The `.all()` function will call the query builder `execute()` function
   * to fetch the results.
   *
   * The optional `limit` and `offset` parameters allow fetching a slice of
   * the total results.
   *
   * The short form allows passing `limit` as the single argument.
   *
   * See `KyShape.paginate()` and `KyShape.paginateCursor()` for alternative
   * strategies for listing results.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * const people = await findPerson().all({ limit: 100 });
   * // `people` is an array (length up to 100) of `Person` objects
   * ```
   */
  (options?: number | AllOptions<DB, TB>): Promise<T[]>;
};

export function all<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
): AllFn<DB, TB, T> {
  return async (options?: number | AllOptions<DB, TB>) => {
    const { limit, offset, orderBy } =
      typeof options === "number" ? { limit: options } : (options ?? {});
    const rows = await query
      .$if(limit !== undefined, (qb) => qb.limit(limit!))
      .$if(offset !== undefined, (qb) => qb.offset(offset!))
      .$if(orderBy !== undefined, (qb) => {
        const isComposite = Array.isArray(orderBy);
        const columnsConfig = isComposite
          ? (orderBy as readonly ColumnConfig<DB, TB>[])
          : [orderBy as ColumnConfig<DB, TB>];

        const columns = columnsConfig.map((cc) =>
          typeof cc === "string" ? cc : cc.column,
        );
        const directions: Direction[] = columnsConfig.map((cc_1) =>
          typeof cc_1 === "string" ? "asc" : (cc_1.direction ?? "asc"),
        );
        const nulls: Nulls[] = columnsConfig.map((cc_2) =>
          typeof cc_2 === "string" ? "never" : (cc_2.nulls ?? "never"),
        );
        return qb.$call(buildCompositeOrderBy(columns, directions, nulls));
      })
      .execute();
    return rows.map(transform);
  };
}
