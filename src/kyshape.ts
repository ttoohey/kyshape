import type { SelectQueryBuilder } from "kysely";
import type {
  Merge,
  BaseShape,
  KyShape,
  KyShapeState,
  ShapeBuilder,
  ShapeFacet,
} from "./types.js";
import { streamCursor } from "./streamCursor.js";
import { all } from "./all.js";
import { lazyStream } from "./lazyStream.js";
import { lazyFirst } from "./lazyFirst.js";
import { paginateCursor } from "./paginateCursor.js";
import { paginate } from "./paginate.js";
import { first } from "./first.js";
import { stream } from "./stream.js";

type ShapeBuilderX<DB, TB extends keyof DB, O, T> = ShapeBuilder<
  DB,
  TB,
  O,
  T
> & {
  $query: SelectQueryBuilder<DB, TB, O>;
  $transform: (data: O) => T;
};

function builder<DB, TB extends keyof DB, O, T>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
): ShapeBuilderX<DB, TB, O, T> {
  return {
    $query: query,
    $transform: transform,
    build: <N>(
      func: (
        qb: SelectQueryBuilder<DB, TB, O>,
      ) => SelectQueryBuilder<DB, TB, N>,
    ): ShapeBuilderX<DB, TB, N, Merge<O, T, N>> =>
      builder(func(query), transform as unknown as (data: N) => Merge<O, T, N>),
    transform: (func) => builder(query, (data) => func(transform(data))),
  };
}

function shape<DB, TB extends keyof DB, O, T, S extends KyShapeState>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
  state: S,
): ShapeFacet<DB, TB, O, T, S> {
  const shapeFacet = <NO, NT>(
    cb: (func: ShapeBuilder<DB, TB, O, T>) => ShapeBuilder<DB, TB, NO, NT>,
  ) => {
    const { $query, $transform } = cb(
      builder(query, transform),
    ) as ShapeBuilderX<DB, TB, NO, NT>;
    return baseShape($query, $transform, state);
  };
  shapeFacet.query = query;
  shapeFacet.applyTransform = transform;
  return shapeFacet;
}

function baseShape<DB, TB extends keyof DB, O, T, S extends KyShapeState>(
  query: SelectQueryBuilder<DB, TB, O>,
  transform: (data: O) => T,
  state: S,
): KyShape<DB, TB, O, T, S> {
  const p: BaseShape<DB, TB, O, T, S> = {
    required: () => baseShape(query, transform, { ...state, required: true }),
    notRequired: () =>
      baseShape(query, transform, { ...state, required: false }),
    lazy: () => baseShape(query, transform, { ...state, lazy: true }),
    notLazy: () => baseShape(query, transform, { ...state, lazy: false }),
    first: first(query, transform, state),
    all: all(query, transform),
    paginate: paginate(query, transform),
    paginateCursor: paginateCursor(query, transform),
    stream: stream(query, transform),
    streamCursor: streamCursor(query, transform),
    shape: shape(query, transform, state),
  };
  if (!state.lazy) {
    Object.freeze(p);
    return p as KyShape<DB, TB, O, T, S>;
  }
  const s = lazyStream(p, query, transform);
  const f = lazyFirst(s, query, transform, state);
  Object.freeze(f);
  return f as KyShape<DB, TB, O, T, S>;
}

export function kyshape<DB, TB extends keyof DB, O>(
  query: SelectQueryBuilder<DB, TB, O>,
) {
  return baseShape(query, (data: O) => data, {
    required: false,
    lazy: false,
  });
}
