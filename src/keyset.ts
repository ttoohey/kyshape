import {
  Expression,
  ExpressionBuilder,
  SelectQueryBuilder,
  SqlBool,
  StringReference,
} from "kysely";
import { Direction } from "./pagination.js";

export type Nulls = "first" | "last" | "never";

export type ColumnConfig<DB, TB extends keyof DB> =
  | StringReference<DB, TB>
  | {
      column: StringReference<DB, TB>;
      direction?: "asc" | "desc";
      nulls?: "first" | "last" | "never";
      toCursor?: (value: any) => any;
      fromCursor?: (value: any) => any;
    };

export type ColumnFromColumnConfig<C extends string | { column: string }> =
  C extends string ? C : C extends { column: string } ? C["column"] : never;

export type ColumnFromColumnConfigTuple<
  C extends readonly (string | { column: string })[],
> = {
  [K in keyof C]: ColumnFromColumnConfig<C[K]>;
};

function strictlyAfter(
  eb: ExpressionBuilder<any, any>,
  column: string,
  direction: Direction,
  nulls: Nulls,
  value: unknown,
): Expression<SqlBool> | null {
  if (nulls === "never") {
    return eb(column, direction === "asc" ? ">" : "<", value);
  }
  if (value === null) {
    return nulls === "last" ? null : eb(column, "is not", null);
  }
  const beyond = eb(column, direction === "asc" ? ">" : "<", value);
  return nulls === "last" ? eb.or([beyond, eb(column, "is", null)]) : beyond;
}

function equalTo(
  eb: ExpressionBuilder<any, any>,
  column: string,
  value: unknown,
) {
  return value === null ? eb(column, "is", null) : eb(column, "=", value);
}

export function buildCompositeWhere(
  eb: ExpressionBuilder<any, any>,
  columns: readonly string[],
  directions: readonly Direction[],
  nulls: readonly Nulls[],
  cursor: readonly unknown[],
): Expression<SqlBool> {
  columns.forEach((column, i) => {
    if (nulls[i] === "never" && cursor[i] === null) {
      throw new Error(`Cursor value for non-nullable column ${column} is null`);
    }
  });
  if (
    nulls.every((n) => n === "never") &&
    directions.every((d) => d === directions[0])
  ) {
    const op = directions[0] === "asc" ? ">" : "<";
    return columns.length === 1
      ? eb(columns[0], op, cursor[0])
      : eb(
          eb.refTuple(...(columns as [string, string])),
          op,
          eb.tuple(...(cursor as [string, string])),
        );
  }

  let condition: Expression<SqlBool> | null = null;
  for (let i = columns.length - 1; i >= 0; i--) {
    const after = strictlyAfter(
      eb,
      columns[i],
      directions[i],
      nulls[i],
      cursor[i],
    );
    const tie: Expression<SqlBool> | null =
      condition && eb.and([equalTo(eb, columns[i], cursor[i]), condition]);

    const parts: Expression<SqlBool>[] = [after, tie].filter(
      (part) => part !== null,
    );
    condition =
      parts.length === 0 ? null : parts.length === 1 ? parts[0] : eb.or(parts);
  }
  return condition ?? eb.lit(false);
}

export function buildCompositeOrderBy<DB, TB extends keyof DB>(
  columns: readonly StringReference<DB, TB>[],
  directions: readonly Direction[],
  nulls: readonly Nulls[],
) {
  return <O>(query: SelectQueryBuilder<DB, TB, O>) =>
    columns.reduce(
      (q, column, i) =>
        q.orderBy(column, (ob) => {
          const ordered = directions[i] === "asc" ? ob.asc() : ob.desc();
          if (nulls[i] === "never") {
            return ordered;
          }
          return nulls[i] === "first"
            ? ordered.nullsFirst()
            : ordered.nullsLast();
        }),
      query,
    );
}
