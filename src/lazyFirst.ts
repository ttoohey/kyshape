import { SelectQueryBuilder } from "kysely";
import { thenable } from "./thenable.js";
import { first, FirstResult } from "./first.js";
import { KyShapeState } from "./types.js";

export function lazyFirst<
  TObject extends object,
  DB,
  TB extends keyof DB,
  O,
  T,
  S extends KyShapeState,
>(
  object: TObject,
  query: SelectQueryBuilder<DB, TB, O>,
  transformer: (data: O) => T,
  state: S,
): TObject & Promise<FirstResult<S["required"], T>> {
  return thenable(object, first(query, transformer, state)) as any;
}
