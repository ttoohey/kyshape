import { SelectQueryBuilder } from "kysely";
import { SeekFn } from "./seek.js";
import { PageFn } from "./page.js";
import { CursorFn } from "./cursor.js";
import { FirstFn, FirstResult } from "./first.js";
import { StreamFn } from "./stream.js";
import { ListFn } from "./list.js";

export type Merge<O, T, N> = N & Omit<T, Exclude<keyof O, keyof N>>;

export type PipelineState<
  TThrowIfNotFound extends boolean = boolean,
  TLazy extends boolean = boolean,
> = {
  throwIfNotFound: TThrowIfNotFound;
  lazy: TLazy;
};

export type Pipeline<
  DB,
  TB extends keyof DB,
  O,
  T,
  S extends PipelineState,
> = S["lazy"] extends true
  ? Promise<FirstResult<S["throwIfNotFound"], T>> &
      AsyncIterable<T> &
      BasePipeline<DB, TB, O, T, S>
  : S["lazy"] extends false
    ? BasePipeline<DB, TB, O, T, S>
    : never;

export interface BasePipeline<
  DB,
  TB extends keyof DB,
  O,
  T,
  S extends PipelineState,
> {
  /**
   * **`Pipeline.query`**
   *
   * Directly access the pipeline's query builder object.
   *
   * This is typically used when using a pipeline to generate an SQL sub-select.
   */
  query: SelectQueryBuilder<DB, TB, O>;
  /**
   * **`Pipeline.extend()`**
   *
   * Extend the pipeline's query builder object.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * // Add aliases `fn` and `ln` to the query selection
   * const person = await findPerson().extend((query) =>
   *   query.select(["person.first_name as fn", "person.last_name as ln"]),
   * ).first();
   * person.fn === person.first_name;
   * person.ln === person.last_name;
   * ```
   */
  extend<N>(
    func: (qb: SelectQueryBuilder<DB, TB, O>) => SelectQueryBuilder<DB, TB, N>,
  ): Pipeline<DB, TB, N, Merge<O, T, N>, S>;
  /**
   * **`Pipeline.map()`**
   *
   * Add a transformer callback to transform each item of the database result
   * set.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * // Add `full_name` to the transformed result
   * const person = await findPerson().map((data) => ({
   *   ...data,
   *   full_name: `${data.first_name} ${data.last_name}`,
   * })).first()
   * ```
   */
  map<N>(func: (data: T) => N): Pipeline<DB, TB, O, N, S>;
  /**
   * **`Pipeline.compose()`**
   *
   * Build complex queries with post-query transformations bundled into
   * _pipeline operators_ (re-usable functions that call `Pipeline.extend()`
   * and `Pipeline.map()`).
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query);
   * }
   *
   * const person = await findPerson().compose((pipeline) =>
   *   pipeline
   *     .extend((query) =>
   *        query.select(["person.first_name as fn", "person.last_name as ln"]),
   *      )
   *      .map((data) => ({
   *        ...data,
   *        full_name: `${data.fn} ${data.ln}`,
   *      })),
   *   ).first();
   * ```
   *
   * **Creating re-usable _pipeline operators_**
   *
   * Typicallly `Pipeline.compose()` callback functions (_pipeline operators_)
   * are defined in a repository collection and used to compose a complex
   * query builder and post-query transformations in one step.
   *
   * @example
   *
   * ```ts
   * function addPetsToPerson<PetO, T, S extends PipelineState>(
   *   petPipeline: PetPipeline<PetO, T, S>,
   * ) {
   *   return <O, T, S extends PipelineState>(
   *    personPipeline: PersonPipeline<O, T, S>,
   *  ) =>
   *    personPipeline
   *      .extend((query) =>
   *        query.select(({ ref }) =>
   *          jsonArrayFrom(
   *            petPipeline.query.whereRef("pet.owner_id", "=", ref("person.id")),
   *          ).as("pets"),
   *        ),
   *      )
   *      .map(({ pets, ...rest }) => ({
   *        ...rest,
   *        pets: pets.map((pet) =>
   *          petPipeline.transform(petFromJson(pet) as PetO),
   *        ),
   *      }));
   * }
   *
   * const person = await findPerson()
   *   .compose(addPetsToPerson(findPet()))
   *   .first();
   * ```
   *
   * **Chaining _pipeline operators_**
   *
   * The result of a `Pipeline.compose()` is another pipeline, so they may
   * be chained to form complex database queries.
   *
   * @example
   *
   * ```ts
   * const person = await findPerson()
   *   .compose(addPetsToPerson(findPet()))
   *   .compose(addOrdersToPerson(findOrder()))
   *   .first();
   * ```
   *
   * **Nesting _pipeline operators_**
   *
   * By creating _pipeilne operator_ functions with arguments that are pipelines
   * themselves, it's possible to create a nested heirarchy query.
   *
   * ```ts
   * const person = await findPerson()
   *   .compose(addPetsToPerson(
   *     findPet().compose(addVaccinationHistoryToPet(findVaccinationHistory()))
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
  compose<QN, TN>(
    func: (p: Pipeline<DB, TB, O, T, S>) => Pipeline<DB, TB, QN, TN, S>,
  ): Pipeline<DB, TB, QN, TN, S>;
  /**
   * **`Pipeline.throwIfNotFound()`**
   *
   * Sets the `throwIfNotFound` flag on the pipeline which is used by the
   * `Pipeline.first()` function to determine whether to use
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
   *   return pipeline(query).throwIfNotFound();
   * }
   *
   * const person = await findPerson(123).first(); // throws if `123` isn't found
   * ```
   */
  throwIfNotFound(): Pipeline<
    DB,
    TB,
    O,
    T,
    Omit<S, "throwIfNotFound"> & { throwIfNotFound: true }
  >;
  /**
   * **`Pipeline.lazy()`**
   *
   * Sets the `lazy` flag on the pipeline which enables lazy execution
   * of `Pipeline.first()` and `Pipeline.stream()` via `await` or
   * `for await..of` use on the pipeline.
   *
   * @example
   *
   * ```ts
   * function findPerson() {
   *   const query = db.selectFrom("person").selectAll();
   *   return pipeline(query).lazy();
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
  lazy(): Pipeline<DB, TB, O, T, Omit<S, "lazy"> & { lazy: true }>;
  /** Get the first matching record */
  first: FirstFn<T, S>;
  /** Transaction based streaming */
  stream: StreamFn<T>;
  /** Fetch records as an array */
  list: ListFn<T>;
  /** Offset pagination */
  page: PageFn<T>;
  /** Cursor (keyset) pagination */
  seek: SeekFn<DB, TB, T>;
  /** Cursor (keyset) based streaming */
  cursor: CursorFn<DB, TB, T>;
  /** Apply the transformer to a record */
  transform: (data: O) => T;
}
