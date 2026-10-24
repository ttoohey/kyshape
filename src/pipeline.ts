import type { SelectQueryBuilder } from "kysely";
import type { Merge, BasePipeline, Pipeline, PipelineState } from "./types.js";
import { cursor } from "./cursor.js";
import { list } from "./list.js";
import { lazyStream } from "./lazyStream.js";
import { lazyFirst } from "./lazyFirst.js";
import { seek } from "./seek.js";
import { page } from "./page.js";
import { first } from "./first.js";
import { stream } from "./stream.js";

function basePipeline<DB, TB extends keyof DB, O, T, S extends PipelineState>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
  state: S,
): Pipeline<DB, TB, O, T, S> {
  const p: BasePipeline<DB, TB, O, T, S> = {
    query,
    transform,
    throwIfNotFound: () =>
      basePipeline(query, transform, { ...state, throwIfNotFound: true }),
    lazy: () => basePipeline(query, transform, { ...state, lazy: true }),
    extend: <N>(
      func: (
        qb: SelectQueryBuilder<DB, TB, O>,
      ) => SelectQueryBuilder<DB, TB, N>,
    ): Pipeline<DB, TB, N, Merge<O, T, N>, S> =>
      basePipeline(
        func(query),
        transform as unknown as (data: N) => Merge<O, T, N>,
        state,
      ),
    map: (func) => basePipeline(query, (data) => func(transform(data)), state),
    compose: (func) => func(basePipeline(query, transform, state)),
    first: first(query, transform, state),
    cursor: cursor(query, transform),
    list: list(query, transform),
    page: page(query, transform),
    /**
     * seek docblock
     */
    seek: seek(query, transform),
    stream: stream(query, transform),
  };
  if (!state.lazy) {
    Object.freeze(p);
    return p as Pipeline<DB, TB, O, T, S>;
  }
  const s = lazyStream(p, query, transform);
  const f = lazyFirst(s, query, transform, state);
  Object.freeze(f);
  return f as Pipeline<DB, TB, O, T, S>;
}

export function pipeline<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
) {
  return basePipeline(query, (data: O) => data, {
    throwIfNotFound: false,
    lazy: false,
  });
}
