import { SelectQueryBuilder } from "kysely";
import { PaginateCursorFn } from "./paginateCursor.js";
import { PaginateFn } from "./paginate.js";
import { StreamCursorFn } from "./streamCursor.js";
import { FirstFn, FirstResult } from "./first.js";
import { StreamFn } from "./stream.js";
import { AllFn } from "./all.js";

export type Merge<O, T, N> = N & Omit<T, Exclude<keyof O, keyof N>>;

export type KyShapeState<
  TRequired extends boolean = boolean,
  TLazy extends boolean = boolean,
> = {
  required: TRequired;
  lazy: TLazy;
};

export type KyShape<
  DB,
  TB extends keyof DB,
  O,
  T,
  S extends KyShapeState,
> = S["lazy"] extends true
  ? Promise<FirstResult<S["required"], T>> &
      AsyncIterable<T> &
      BaseShape<DB, TB, O, T, S>
  : S["lazy"] extends false
    ? BaseShape<DB, TB, O, T, S>
    : never;

export interface BaseShape<
  DB,
  TB extends keyof DB,
  O,
  T,
  S extends KyShapeState,
> {
  /**
   * **`KyShape.required()`**
   *
   * Sets the `required` flag on the `KyShape` instance which is used by the
   * `KyShape.first()` function to determine whether to use
   * `query.executeTakeFirst()` or `query.executeTakeFirstOrThrow()`.
   *
   * @example
   *
   * ```ts
   * function findPerson(id: number) {
   *   const query = db
   *     .selectFrom("person")
   *     .selectAll()
   *     .where("id", "=", id);
   *   return kyshape(query).required();
   * }
   *
   * const person = await findPerson(123).first(); // throws if `123` isn't found
   * ```
   */
  required(): KyShape<DB, TB, O, T, Omit<S, "required"> & { required: true }>;
  notRequired(): KyShape<
    DB,
    TB,
    O,
    T,
    Omit<S, "required"> & { required: false }
  >;
  /**
   * **`KyShape.lazy()`**
   *
   * Sets the `lazy` flag on the `KyShape` instance which enables lazy execution
   * of `KyShape.first()` and `KyShape.stream()` via `await` or
   * `for await..of` use on the `KyShape` instance.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query).lazy();
   * }
   *
   *  // implicitly calls `.first()`
   * const person = await findPerson();
   *
   *  // implicitly calls `.stream()`
   * for await (const person of findPerson()) {
   *   ...
   * }
   * ```
   */
  lazy(): KyShape<DB, TB, O, T, Omit<S, "lazy"> & { lazy: true }>;
  notLazy(): KyShape<DB, TB, O, T, Omit<S, "lazy"> & { lazy: false }>;
  /** Fetch records as an array */
  all: AllFn<DB, TB, T>;
  /** Get the first matching record */
  first: FirstFn<T, S>;
  /** Offset pagination */
  paginate: PaginateFn<T>;
  /** Cursor (keyset) pagination */
  paginateCursor: PaginateCursorFn<DB, TB, T>;
  /** Transaction based streaming */
  stream: StreamFn<T>;
  /** Cursor (keyset) based streaming */
  streamCursor: StreamCursorFn<DB, TB, T>;

  shape: ShapeFacet<DB, TB, O, T, S>;
}

export interface ShapeFacet<
  DB,
  TB extends keyof DB,
  O,
  T,
  S extends KyShapeState,
> {
  /**
   * **`KyShape.shape()`**
   *
   * Build complex queries with post-query transformations bundled into
   * _shape operators_.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * const person = await findPerson().shape((builder) =>
   *   builder
   *     .extend((query) =>
   *        query.select(["person.first_name as fn", "person.last_name as ln"]),
   *      )
   *      .transform((data) => ({
   *        ...data,
   *        full_name: `${data.fn} ${data.ln}`,
   *      })),
   *   ).first();
   * ```
   *
   * **Creating re-usable _shape operators_**
   *
   * Typicallly `KyShape.shape()` callback functions (_shaper operators_)
   * are defined in a repository collection and used to compose a complex
   * query builder and post-query transformations in one step.
   *
   * @example
   *
   * ```ts
   * function addPetsToPerson<PetO, T, S extends KyShapeState>(
   *   petShape: PetShape<PetO, T, S>,
   * ) {
   *   return <O, T, S extends KyShapeState>(
   *    builder: KyShapeBuilder<PersonShape<O, T, S>>,
   *  ) =>
   *    builder
   *      .extend((query) =>
   *        query.select(({ ref }) =>
   *          jsonArrayFrom(
   *            petShape.shape.query.whereRef("pet.owner_id", "=", ref("person.id")),
   *          ).as("pets"),
   *        ),
   *      )
   *      .transform(({ pets, ...rest }) => ({
   *        ...rest,
   *        pets: pets.map((pet) =>
   *          petShape.shape.applyTransform(petFromJson(pet) as PetO),
   *        ),
   *      }));
   * }
   *
   * const person = await findPerson()
   *   .shape(addPetsToPerson(findPet()))
   *   .first();
   * ```
   *
   * **Chaining _shape operators_**
   *
   * The result of a `KyShape.shape()` is another `KyShape` instance, so they may
   * be chained to form complex database queries.
   *
   * @example
   *
   * ```ts
   * const person = await findPerson()
   *   .shape(addPetsToPerson(findPet()))
   *   .shape(addOrdersToPerson(findOrder()))
   *   .first();
   * ```
   *
   * **Nesting _shape operators_**
   *
   * By creating _shape operator_ functions with arguments that are `KyShape`
   * instances, it's possible to create a nested heirarchy query.
   *
   * ```ts
   * const person = await findPerson()
   *   .shape(addPetsToPerson(
   *     findPet().shape(addVaccinationHistoryToPet(findVaccinationHistory()))
   *   ))
   *   .first();
   * ```
   *
   * This might expect to see a structure like:
   *
   * ```json
   * {
   *   "id": 123,
   *   "first_name": "Blake",
   *   ...
   *   "pets": [
   *      {
   *         "id": 234,
   *         "species": "dog",
   *         "vaccinationHistory": [
   *            "id": 345,
   *            "date": "2026-01-02",
   *            "type": "rabies"
   *         ]
   *      }
   *   ]
   * }
   * ```
   *
   */
  <NO, NT>(
    func: (builder: ShapeBuilder<DB, TB, O, T>) => ShapeBuilder<DB, TB, NO, NT>,
  ): KyShape<DB, TB, NO, NT, S>;
  query: SelectQueryBuilder<DB, TB, O>;
  applyTransform: (data: O) => T;
}

export interface ShapeBuilder<DB, TB extends keyof DB, O, T> {
  /**
   * **`ShapeBuilder.build()`**
   *
   * Extend the shape's query builder.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * // Add aliases `fn` and `ln` to the query selection
   * const person = await findPerson().shape(
   *   builder => builder.build((qb) =>
   *     qb.select(["person.first_name as fn", "person.last_name as ln"]),
   *   )
   * ).first();
   * person.fn === person.first_name;
   * person.ln === person.last_name;
   * ```
   */
  build<N>(
    func: (qb: SelectQueryBuilder<DB, TB, O>) => SelectQueryBuilder<DB, TB, N>,
  ): ShapeBuilder<DB, TB, N, Merge<O, T, N>>;

  /**
   * **`ShapeBuilder.transform()`**
   *
   * Add a callback to transform each item of the database result
   * set.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return kyshape(query);
   * }
   *
   * // Add `full_name` to the transformed result
   * const person = await findPerson().shape(
   *   builder => builder.transform((data) => ({
   *      ...data,
   *     full_name: `${data.first_name} ${data.last_name}`,
   *   }))
   * ).first()
   * ```
   */
  transform<N>(func: (data: T) => N): ShapeBuilder<DB, TB, O, N>;
}

export type KyShapeBuilder<K> =
  K extends KyShape<infer DB, infer TB, infer O, infer T, any>
    ? ShapeBuilder<DB, TB, O, T>
    : never;
