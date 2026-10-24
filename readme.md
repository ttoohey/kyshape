# kysely-pipeline

Helper for [kysely](https://kysely.dev/) to build composable type-safe query
builder logic.

# Summary

A Pipeline is a wrapper for a _kysely_ `SelectQueryBuilder` which allows
composition of database queries, transformation of database results, and various
strategies for consuming the responses.

Pipelines may be consumed by taking the first result, iterating over all the
results (streaming or batching results), or taking a slice of results into an
array (listing or paging). See [reading](/doc/reading/readme.md)

```ts
import { pipeline } from "kysely-pipeline";

function findPerson(criteria?: number | object) {
  let query = db.selectFrom("person").selectAll();
  if (typeof criteria === "number") {
    query = query.where("id", "=", criteria);
  }
  if (criteria?.keyword) {
    query = query.where("keyword", "like", criteria.keyword);
  }
  return pipeline(query);
}

// get a single record
const person = await findPerson(id).first();

// get a list of records
const persons = await findPerson({ keyword }).list(50);

// stream results
for await (const person of findPerson().stream()) {
  // process one person at a time
}
```

Pipeline compositions may be chained and nested to produce complex data shapes.
See [extending](/doc/extending/readme.md),
[composition](/doc/composition/readme.md), [relations](/doc/relations/readme.md).

```ts
const person = await findPerson(id)
  .compose(addPets(findPet()))
  .compose(addMother(findPerson()));
person.pets satisfies Pet[];
person.mother satisfies Person | null;

const pet = await findPet(id).compose(
  addOwner(findPerson().compose(addMother(findPerson()))),
);
pet.owner satisfies Person;
pet.owner.mother satisfies Person;
```

# API

## pipeline(query)

```ts
function pipeline(query: SelectQueryBuilder): Pipeline;
```

This function is typically used in repository 'find' function.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query).lazy();
}
```

The `findPerson()` function returns a Pipeline which means the consumer may
extend/compose the query further, and can choose which of the reading strategies
to use, from simply awaiting to get the first result, or streaming to get all
results, or using `.page()` to get a page of results.

There's no need for separate `findPersonById()` and `findPeople()` functions.
Modify `findPerson()` to implement the `WHERE` logic, and let the consumer worry
about the shape of the result.

```ts
function findPerson(criteria?: number | object) {
  const query = db
    .selectFrom("person")
    .selectAll()
    .$if(typeof criteria === "number", (q) =>
      q.where("id", "=", criteria as number),
    );
  return pipeline(query).lazy();
}
```

```ts
const person: Person = await findPerson(123);
const people: Person[] = await findPerson().list();
```

## `Pipeline` modifiers

### `Pipeline.extend(query => query)`

Extend the pipeline's query builder object.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

// Add aliases `fn` and `ln` to the query selection
const person = await findPerson()
  .extend((query) =>
    query.select(["person.first_name as fn", "person.last_name as ln"]),
  )
  .first();
person.fn === person.first_name;
person.ln === person.last_name;
```

### `Pipeline.map(data => data)`

Add a transformer callback to transform each item of the database result
set.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

// Add `full_name` to the transformed result
const person = await findPerson()
  .map((data) => ({
    ...data,
    full_name: `${data.first_name} ${data.last_name}`,
  }))
  .first();

console.log(person.full_name);
```

### `Pipeline.compose(pipeline => pipeline)`

Build complex queries with post-query transformations bundled into
_pipeline operators_ (re-usable functions that call `Pipeline.extend()`
and `Pipeline.map()`).

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

const person = await findPerson()
  .compose((pipeline) =>
    pipeline
      .extend((query) =>
        query.select(["person.first_name as fn", "person.last_name as ln"]),
      )
      .map((data) => ({
        ...data,
        full_name: `${data.fn} ${data.ln}`,
      })),
  )
  .first();
```

#### Creating re-usable _pipeline operators_

Typicallly `Pipeline.compose()` callback functions (_pipeline operators_)
are defined in a repository collection and used to compose a complex
query builder and post-query transformations in one step.

```ts
type PersonPipeline<
  O,
  T,
  S extends PipelineState,
  TB extends keyof Database = "person",
> = TB extends "person" ? Pipeline<Database, TB, O, T, S> : never;

export type PetPipeline<
  O,
  T,
  S extends PipelineState,
  TB extends keyof Database = "pet",
> = TB extends "pet" ? Pipeline<Database, TB, O, T, S> : never;

function addPetsToPerson<PetO, T, S extends PipelineState>(
  petPipeline: PetPipeline<PetO, T, S>,
) {
  return <O, T, S extends PipelineState>(
    personPipeline: PersonPipeline<O, T, S>,
  ) =>
    personPipeline
      .extend((query) =>
        query.select(({ ref }) =>
          jsonArrayFrom(
            petPipeline.query.whereRef("pet.owner_id", "=", ref("person.id")),
          ).as("pets"),
        ),
      )
      .map(({ pets, ...rest }) => ({
        ...rest,
        pets: pets.map((pet) =>
          petPipeline.transform(petFromJson(pet) as PetO),
        ),
      }));
}

const person = await findPerson().compose(addPetsToPerson(findPet())).first();
```

#### Chaining _pipeline operators_

The result of a `Pipeline.compose()` is another pipeline, so they may
be chained to form complex database queries.

```ts
const person = await findPerson()
  .compose(addPetsToPerson(findPet()))
  .compose(addOrdersToPerson(findOrder()))
  .first();
```

#### Nesting _pipeline operators_

By creating _pipeilne operator_ functions with arguments that are pipelines
themselves, it's possible to create a nested heirarchy query.

```ts
const person = await findPerson()
  .compose(
    addPetsToPerson(
      findPet().compose(addVaccinationHistoryToPet(findVaccinationHistory())),
    ),
  )
  .first();
```

This might expect to see a structure like:

```json
{
  "id": 123,
  "first_name": "Blake",
  ...
  "pets": [
     {
        "id": 234,
        "species": "dog",
        "vaccinationHistory": [
           "id": 345,
           "date": "2026-01-02",
           "type": "rabies"
        ]
     }
  ]
}
```

### `Pipeline.throwIfNotFound()`

Sets the `throwIfNotFound` flag on the pipeline which is used by the
`Pipeline.first()` function to determine whether to use
`query.executeTakeFirst()` or `query.executeTakeFirstOrThrow()`.

```ts
function findPerson(id: number) {
  const query = db.selectFrom("person").selectAll().where("id", "=", id);
  return pipeline(query).throwIfNotFound();
}

const person = await findPerson(123).first(); // throws if `123` isn't found
```

### `Pipeline.lazy()`

Sets the `lazy` flag on the pipeline which enables lazy execution
of `Pipeline.first()` and `Pipeline.stream()` via `await` or
`for await..of` use on the pipeline.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query).lazy();
}

// implicitly calls `.first()`
const person = await findPerson();

// implicitly calls `.stream()`
for await (const person of findPerson()) {
  ...
}
```

## Fetching results with `Pipeline` terminal functions

### `Pipeline.first()`

Retrieve the first matching record of the pipeline's query builder.

The `.first()` function will call the query builder `executeTakeFirst()`
function to efficiently retrieve the first item of the result set.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

const person = await findPerson().first();
```

#### The `throwIfNotFound` flag

If the pipeline's `throwIfNotFound` flag is set the query builder's
`executeTakeFirstOrThrow()` function is called. This results in a
guarantee that the item will not be undefined.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query).throwIfNotFound();
}

const person = await findPerson().first();
// `person` is _not_ `undefined`
```

#### The `lazy` flag

If the pipeline's `lazy` flag is set then awaiting the pipeline will
automatically call `.first()`.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query).lazy();
}

const person = await findPerson();
```

### `Pipeline.list(limit?, offset?)`

Retrieve an array of records from the pipeline's query builder.

The `.list()` function will call the query builder `execute()` function
to retrieve the results.

The optional `limit` and `offset` parameters allow fetching a slice of
the total results.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

const people = await findPerson().list(100);
// `people` is an array (length up to 100) of Person objects
```

### `Pipeline.page(page, limit, options?)`

Return an array of results along with pagination meta data
using offset pagination.

See `Pipeline.seek()` for a keyset (cursor) based pagination alternative.

It calls the query builder `execute()` method.

If the `options.counting` flag is set the `meta` data will include
`totalItems` (the total number of items matching the query), and
`totalPages` (the total number of pages in the results). The default is
`true` since offset pagination is typically used when a total count
and total pages are required for the UI.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}
const { items, meta } = await findPerson().page(1, 50);
// `items` is an array (length up to 50) of Person objects
```

The `meta` result contains:

```ts
{
  page: number; // reflects the `page` parameter
  limit: number; // reflects the `limit` parameter
  hasNext: boolean; // true if there is a page after this page
  hasPrevious: boolean; // true if there is a page before this page
  totalItems?: number; // set if `counting` is true (default), the total count of records matching the query
  totalPages?: number; // set if `counting` is true (default), the total number of pages (totalItems / limit)
}
```

### `Pipeline.seek(options)`

Keyset (cursor) based pagination.

See `Pipeline.page()` for an offset pagination alternative.

`options`

- `options.index` The index used to identify page boundaries.
- `options.index.column` Column reference
- `options.index.direction` Order by direction (default 'asc')
- `options.index.nulls` Whether nulls will appear first or last (default 'never')
- `options.index.toCursor` Convert from database type to JSON-compatible value for encoding in cursor string
- `options.index.fromCursor` Convert from JSON-compatible value to database type for decoding cursor string
- `options.first` Count of records to fetch per page setting pagination direction to 'forward'
- `options.last` Count of records to fetch per page setting pagination direction to 'reverse'
- `options.cursor` Opaque reference cursor for the page
- `options.key` Raw reference cursor for the page
- `options.counting` Enable extra query to fetch total count of records matching query

Returns the list of items for the page along with meta data with next/previous links

- `items`: array of records fetched and transformed
- `meta`: pagination meta data - `{ hasNext, hasPrevious, nextCursor, previousCursor }`

The `options.index` parameter may be a single column reference, or a
composite reference (an array of column references). If entered as a string,
the defaults (`{ direction: 'asc', nulls: 'never' }`) are used. These may
be overridden by providing a configured column reference
(`{ column }`).

The index must identify unique records in the table (this is typically
achieved by using a composite index with the table's primary key as the
final element). If an element in a composite index is a nullable column,
set the `nulls` property to `first` or `last`, only use the default `never`
for columns that are non-nullable.

`options.index` sets the query's `ORDER BY` expression.
One of `options.first` or `options.last` must be supplied. This defines
both the direction of pagination travel (forward or reverse), and the page
size of each page.

Only one of `options.cursor` or `options.key` may be supplied. The shape
of `options.key` is dependant on the shape of `options.index`. For a
non-composite index it will be the type of the index's column. For a
composite index it will be a tuple of the index's column types.

If the `options.counting` flag is set the `meta` data will include
`totalItems` (the total number of items matching the query), and
`totalPages` (the total number of pages in the results). The default is
`false` since keyset pagination is typically used for efficiency and adding
an extra query to calculate the total number records is rarely required.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}
const { items, meta } = await findPerson().seek({
  index: "id",
  first: 50,
});
if (meta.hasNext) {
  const nextPage = await findPerson().seek({
    index: "id",
    first: 50,
    cursor: meta.nextCursor,
  });
  // OR: using `key` instead of `cursor`
  const nextPage = await findPerson().seek({
    index: "id",
    first: 50,
    key: meta.nextKey,
  });
  // back to the previous page
  const previousPage = await findPerson().seek({
    index: "id",
    last: 50,
    cursor: nextPage.meta.previousCursor,
  });
}
// composite index
const result = await findPerson().seek({
  index: [
    { column: "last_name", nulls: "last" },
    { column: "first_name", nulls: "last" },
    "id", // unique, non-nullable as final element to ensure index is unique
  ],
  first: 50,
});
```

#### Using column `toCursor()` and `fromCursor()` callbacks

To allow control over the encoding and decoding steps of the opaque cursor
string, the column configuration `toCursor()` and `fromCursor()` callbacks
may be used. These are transformation functions, typically the inverse of
each other.

```ts
// Encode a timestamp column as a numeric Unix timestamp (seconds since epoch)
const result = await findPerson().seek({
  index: {
    column: "created_at",
    toCursor: (d: Date) => d.getTime() / 1_000,
    fromCursor: (s: number) => new Date(s * 1_000),
  },
});
// The resulting cursor in `result.meta.nextCursor` can be decoded and read
const buf = Buffer.from(result.meta.nextCursor, "base64");
const key: number = JSON.parse(buf.toString()).v;
```

`key` is the numeric Unix timestamp

Note: `Date` values are automatically converted to their ISO string
representation and don't require custom logic, the above is for demonstration
purposes only.

## `Pipeline.stream(chunkSizeOrOptions?)`

Transaction-based streaming.

A memory safe way to process a database result set. Recommended for
short running processes where holding a database transaction open for
the duration is acceptable.

See `Pipeline.cursor()` for a keyset (cursor) based alternative.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

for await (const item of findPerson().stream()) {
  // process `item`
}
```

### Pipeline `lazy` mode

A pipeline with the `lazy` flag set will call `.stream()` automatically
when used in a `for await..of` loop.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query).lazy();
}

for await (const item of findPerson()) {
  // process `item`
}
```

## `Pipeline.cursor(index, options?)`

Keyset (cursor) based streaming.

A memory safe way to batch process a large database result set. Recommended
for long running background processes where a database transaction should
not be held open.

See `Pipeline.stream()` for a transaction based streaming alternative.

- `index` The index used to identify chunk boundaries
- `index.column` Column reference
- `index.direction` Order by direction (default 'asc')
- `index.nulls` Whether nulls will appear first or last (default 'never')
- `options` Configuration settings
- `options.batchSize` Number of records to fetch in each batch (default 1,000)

The `index` parameter may be a single column reference, or a
composite reference (an array of column references). If entered as a string,
the defaults (`{ direction: 'asc', null: 'never' }`) are used. These may be
overridden by providing a configured column reference
(`{ column }`)

The index must identify unique records in the table (this is typically
achieved by using a composite index with the table's primary key as the
final element). If an element in a composite index is a nullable column,
set the `nulls` property to `first` or `last`, only use the default `never`
for columns that are non-nullable.

`index` sets the query's `ORDER BY` expression.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query);
}

for await (const item of findPerson().cursor("id")) {
  // process each `item`
}
```

Using a composite index:

```ts
const stream = findPerson().cursor([
  { column: "last_name", nulls: "last" },
  { column: "first_name", nulls: "last" },
  id, // unique, non-nullable as final element to ensure index is unique
]);

for await (const item of stream) {
  // process each `item`
}
```

## Helpers

## type JsonFrom

A utility type to cast a object to a JSON-ified version. Useful when an object
comes from `jsonArrayFrom()` or `jsonObjectFrom()` queries.

```ts
// casts to an object with the same keys as T with non-JSON valid keys replaced
// with `string`
type JsonFrom<T>
```
