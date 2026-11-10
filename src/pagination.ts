import {
  AliasNode,
  ExtractTypeFromReferenceExpression,
  IdentifierNode,
  KyselyPlugin,
  SelectionNode,
  SelectQueryNode,
  sql,
} from "kysely";

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};
type PrettifyTuple<T> = T extends readonly [infer Head, ...infer Tail]
  ? [Head, ...PrettifyTuple<Tail>]
  : [];

type MapTuple<DB, TB extends keyof DB, T extends readonly string[]> = {
  [K in keyof T]: ExtractTypeFromReferenceExpression<DB, TB, T[K]>;
};

export type ExtractTupleTypes<
  DB,
  TB extends keyof DB,
  T extends readonly string[],
> = PrettifyTuple<MapTuple<DB, TB, T>>;

export interface CountedMeta {
  totalCount: number;
  totalPages: number;
}

export type PaginatedResult<T, M> = {
  items: T[];
  meta: Prettify<M>;
};

export type Direction = "asc" | "desc";

export interface OffsetMeta {
  page: number;
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export type KeysetMeta<TCursor> = (
  | {
      hasNextCursor: true;
      nextCursor: string;
      nextKey: TCursor;
    }
  | {
      hasNextCursor: false;
      nextCursor: null;
      nextKey: null;
    }
) &
  (
    | {
        hasPreviousCursor: true;
        previousCursor: string;
        previousKey: TCursor;
      }
    | {
        hasPreviousCursor: false;
        previousCursor: null;
        previousKey: null;
      }
  );

export const wrapInCount: KyselyPlugin = {
  transformQuery({ node }) {
    if (!SelectQueryNode.is(node)) {
      return node;
    }
    return SelectQueryNode.cloneWithSelections(
      SelectQueryNode.createFrom([
        AliasNode.create(node, IdentifierNode.create("t")),
      ]),
      [SelectionNode.create(sql`count(*)`.as("total").toOperationNode())],
    );
  },
  async transformResult({ result }) {
    return result;
  },
};
