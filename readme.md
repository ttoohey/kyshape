# kyshape

**A functional data-shaping and relationship composition engine for Kysely.**

`kyshape` is a lightweight tool that helps you turn flat database rows from Kysely into the exact nested JavaScript objects your application needs.

While Kysely is great at building SQL queries, pulling down deeply nested relationships and formatting data fields usually requires writing a lot of repetitive, rigid repository functions. `kyshape` solves this by letting you define a reusable data **KyShape instance**. You can then easily customize and expand this shape on the fly by chaining modular helper functions inside a simple `.shape()` callback.

### Key Features

- **Dynamic Data Hydration:** Turn flat, dry SQL rows into deeply nested object graphs, like arrays of child relations, on the fly without leaving the Kysely ecosystem.
- **Combined Operator Pattern:** Package database-level query extensions (`.build()`) and in-memory row transformations (`.transform()`) into a single, cohesive helper. This allows you to bundle complex relationships or custom field mappings into modular, reusable blocks that handle their own SQL generation and data parsing seamlessly.
- **Eliminate Repository Bloat:** Stop writing nearly identical repository functions like `findPerson`, `findPersonWithPets`, and `findPersonWithCompany`. A single base shape can be extended to serve any layout required by the consumer.
- **Complete Native Execution:** A `KyShape` instance replaces your traditional database execution triggers. Once you are done describing your data layout, you run it directly using standard, familiar methods like `.all()`, `.first()`, `.count()`, `.stream()`, or `.paginate()`.

By separating how you build a query from how you transform its results, `kyshape` makes it easy to snap together modular database blocks while retaining the raw flexibility and type safety of Kysely.

### Examples

```ts
import { kyshape } from "kyshape";

function findPerson(criteria?: number | object) {
  let query = db.selectFrom("person").selectAll();
  if (typeof criteria === "number") {
    query = query.where("id", "=", criteria);
  }
  if (criteria?.keyword) {
    query = query.where("keyword", "like", criteria.keyword);
  }
  return kyshape(query);
}

// get a single record
const person = await findPerson(id).first();

// get a list of records
const persons = await findPerson({ keyword }).all(50);

// stream results
for await (const person of findPerson().stream()) {
  // process one person at a time
}
```

Compositions may be chained and nested to produce complex data shapes.
See [extending](/doc/extending/readme.md),
[composition](/doc/composition/readme.md), [relations](/doc/relations/readme.md).

```ts
// chaining
const person = await findPerson(id)
  .shape(addPets(findPet()))
  .shape(addMother(findPerson()))
  .first();
person.pets satisfies Pet[];
person.mother satisfies Person | null;

// nesting
const pet = await findPet(id)
  .shape(addOwner(findPerson().shape(addMother(findPerson()))))
  .first();
pet.owner satisfies Person;
pet.owner.mother satisfies Person;
```

# API

## kyshape(query)

Wraps a raw Kysely query builder to initialize an unexecuted data layout
container (**KyShape instance**). This acts as the starting entry point for both
building database queries and transforming raw result rows.

**Parameters**

- **`query`**: A standard Kysely `SelectQueryBuilder` object.

**Returns**

A **`KyShape` instance** exposing native database execution triggers and the
`.shape()` composition method.

**Example usage**

```ts
function findPerson(criteria?: number | object) {
  const query = db
    .selectFrom("person")
    .selectAll()
    .$if(typeof criteria === "number", (q) =>
      q.where("id", "=", criteria as number),
    );
  return kyshape(query).lazy();
}
```

```ts
const person: Person = await findPerson(123);
const people: Person[] = await findPerson().all();
```

## `ShapeBuilder`

### `ShapeBuilder.build(query => query)`

Extend the `KyShape` instance's query builder object.

**Parameters**

- **`callback`**: A function to extend a `SelectQueryBuilder` instance.

**Returns**

A new **`KyShapeBuilder` instance** with the extended query builder.

**Example usage**

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

// Add aliases `fn` and `ln` to the query selection
const person = await findPerson()
  .shape((builder) =>
    builder.build((query) =>
      query.select(["person.first_name as fn", "person.last_name as ln"]),
    ),
  )
  .first();
person.fn === person.first_name;
person.ln === person.last_name;
```

### `ShapeBuilder.transform(data => data)`

Add a callback to transform each item of the database result set.

**Parameters**

- **`callback`**: A function to transform a single row of the query result set

**Returns**

A new **`ShapeBuilder` instance** with the transformed results.

**Example usage**

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

// Add `full_name` to the transformed result
const person = await findPerson()
  .shape((builder) =>
    builder.transform((data) => ({
      ...data,
      full_name: `${data.first_name} ${data.last_name}`,
    })),
  )
  .first();

console.log(person.full_name);
```

### `KyShape.shape(builder => builder)`

Build complex queries with post-query transformations bundled into
_operators_ (re-usable functions that call `ShapeBuilder.build()`
and `ShapeBuilder.transform()`).

**Parameters**

- **`callback`**: an operator function applying extensions via `KyShapeBuilder`
  `.build()` and `.transform()`

**Returns**

A new **`KyShape` instance** with the extended query builder and/or
transformation applied.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

const person = await findPerson()
  .shape((builder) =>
    builder
      .build((query) =>
        query.select(["person.first_name as fn", "person.last_name as ln"]),
      )
      .transform((data) => ({
        ...data,
        full_name: `${data.fn} ${data.ln}`,
      })),
  )
  .first();
```

#### Creating re-usable _operators_

Typicallly `KyShape.shape()` callback functions (_operators_)
are defined in a repository collection and used to compose a complex
query builder and post-query transformations in one step.

```ts
type PersonBuilder<
  O,
  T,
  TB extends keyof Database = "person",
> = TB extends "person"
  ? KyShapeBuilder<KyShape<Database, TB, O, T, any>>
  : never;

export type PetShape<
  O,
  T = O,
  S extends KyShapeState = any,
  TB extends keyof Database = "pet",
> = TB extends "pet" ? KyShape<Database, TB, O, T, S> : never;

export function addPetsToPerson<PetO, PetT>(petShape: PetShape<PetO, PetT>) {
  return <O, T>(personBuilder: PersonBuilder<O, T>) =>
    personBuilder
      .build((query) =>
        query.select(({ ref }) =>
          jsonArrayFrom(
            petShape.shape.query.whereRef(
              "pet.owner_id",
              "=",
              ref("person.id"),
            ),
          ).as("pets"),
        ),
      )
      .transform(({ pets, ...rest }) => ({
        ...rest,
        pets: pets.map((pet) =>
          petShape.shape.applyTransform(petFromJson(pet) as PetO),
        ),
      }));
}

const person = await findPerson().shape(addPetsToPerson(findPet())).first();
```

#### Chaining _operators_

The result of a `KyShape.shape()` is another `KyShape`, so they may
be chained to form complex database queries.

```ts
const person = await findPerson()
  .shape(addPetsToPerson(findPet()))
  .shape(addOrdersToPerson(findOrder()))
  .first();
```

#### Nesting _operators_

By creating _operator_ functions with arguments that are `KyShape`
instances themselves, it's possible to create a nested heirarchy query.

```ts
const person = await findPerson()
  .shape(
    addPetsToPerson(
      findPet().shape(addVaccinationHistoryToPet(findVaccinationHistory())),
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

### `KyShape.required()`

Sets the `required` flag on the `KyShape` which is used by the
`KyShape.first()` function to determine whether to use
`query.executeTakeFirst()` or `query.executeTakeFirstOrThrow()`.

```ts
function findPerson(id: number) {
  const query = db.selectFrom("person").selectAll().where("id", "=", id);
  return kyshape(query).required();
}

const person = await findPerson(123).first(); // throws if `123` isn't found
```

### `KyShape.lazy()`

Sets the `lazy` flag on the `KyShape` which enables lazy execution
of `KyShape.first()` and `KyShape.stream()` via `await` or
`for await..of` use on the `KyShape` instance.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query).lazy();
}

// implicitly calls `.first()`
const person = await findPerson();

// implicitly calls `.stream()`
for await (const person of findPerson()) {
  ...
}
```

## Fetching results with `KyShape` terminal functions

### `KyShape.first()`

Retrieve the first matching record of the shape's underlying query builder.

The `.first()` function will call the query builder `executeTakeFirst()`
function to efficiently retrieve the first item of the result set.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

const person = await findPerson().first();
```

#### The `required` flag

If the shape's `required` flag is set then the query builder's
`executeTakeFirstOrThrow()` function is called. This results in a
guarantee that the item will not be undefined.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query).required();
}

const person = await findPerson().first();
// `person` is _not_ `undefined`
```

#### The `lazy` flag

If the shape's `lazy` flag is set then awaiting the shape instance will
automatically call `.first()`.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query).lazy();
}

const person = await findPerson();
```

### `KyShape.all(limit?, offset?)`

Retrieve an array of records from the shape instances's underlying query builder.

The `.all()` function will call the query builder `execute()` function
to retrieve the results.

The optional `limit` and `offset` parameters allow fetching a slice of
the total results.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

const people = await findPerson().all(100);
// `people` is an array (length up to 100) of Person objects
```

### `KyShape.paginate(options)`

Return an array of results along with pagination meta data
using offset pagination.

See `KyShape.paginateCursor()` for a keyset (cursor) based pagination alternative.

It calls the query builder `execute()` method.

If the `options.withTotalCount` flag is set the `meta` data will include
`totalCount` (the total number of items matching the query), and
`totalPages` (the total number of pages in the results). The default is
`true` since offset pagination is typically used when a total count
and/or total pages are required for the UI.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}
const { items, meta } = await findPerson().page({ page: 1, limit: 50 });
// `items` is an array (length up to 50) of Person objects
```

The `meta` result contains:

```ts
{
  page: number; // reflects the `page` parameter
  limit: number; // reflects the `limit` parameter
  hasNextPage: boolean; // true if there is a page after this page
  hasPreviousPage: boolean; // true if there is a page before this page
  totalCount?: number; // set if `counting` is true (default), the total count of rows matching the query
  totalPages?: number; // set if `counting` is true (default), the total number of pages (totalItems / limit)
}
```

### `KyShape.paginateCursor(options)`

Keyset (cursor) based pagination.

See `KyShape.paginate()` for an offset pagination alternative.

`options`

- `options.orderBy` The index used to identify page boundaries.
- `options.orderBy.column` Column reference
- `options.orderBy.direction` Order by direction (default 'asc')
- `options.orderBy.nulls` Whether nulls will appear first or last (default 'never')
- `options.orderBy.toCursor` Convert from database type to JSON-compatible value for encoding in cursor string
- `options.orderBy.fromCursor` Convert from JSON-compatible value to database type for decoding cursor string
- `options.limit` Number of records to fetch
- `options.strategy` Whether getting pages in forward or reverse direction
- `options.cursor` Opaque reference cursor for the page
- `options.key` Raw reference cursor for the page
- `options.withTotalCount` Enable extra query to fetch total count of records matching query

Returns the list of items for the page along with meta data with next/previous links

- `items`: array of records fetched and transformed
- `meta`: pagination meta data - `{ hasNextCursor, hasPreviousCursor, nextCursor, previousCursor }`

The `options.orderBy` parameter may be a single column reference, or a
composite reference (an array of column references). If entered as a string,
the defaults (`{ direction: 'asc', nulls: 'never' }`) are used. These may
be overridden by providing a configured column reference
(`{ column }`).

The `orderBy` index must identify unique records in the table (this is typically
achieved by using a composite index with the table's primary key as the
final element). If an element in a composite index is a nullable column,
set the `nulls` property to `first` or `last`, only use the default `never`
for columns that are non-nullable.

`options.orderBy` sets the query's `ORDER BY` expression.

`options.limit` must be supplied.

`options.strategy` defines the direction of pagination travel (forward or
reverse), and the page.

Only one of `options.cursor` or `options.key` may be supplied. The shape
of `options.key` is dependant on the shape of `options.orderBy`. For a
non-composite index it will be the type of the index's column. For a
composite index it will be a tuple of the index's column types.

If the `options.withTotalCount` flag is set the `meta` data will include
`totalCount` (the total number of rows matching the query), and
`totalPages` (the total number of pages in the results). The default is
`false` since keyset pagination is typically used for efficiency and adding
an extra query to calculate the total number records is rarely required.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}
await (async () => {
  const { items, meta } = await findPerson().paginateCursor({
    orderBy: "id",
    limit: 50,
  });
  if (meta.hasNextCursor) {
    const nextPage = await findPerson().paginateCursor({
      orderBy: "id",
      limit: 50,
      cursor: meta.nextCursor,
    });
    // OR: using `key` instead of `cursor`
    const nextPage = await findPerson().paginateCursor({
      orderBy: "id",
      limit: 50,
      key: meta.nextKey,
    });
    // back to the previous page
    const previousPage = await findPerson().paginateCursor({
      orderBy: "id",
      limit: 50,
      strategy: "reverse",
      cursor: nextPage.meta.previousCursor,
    });
  }
});
// reverse streaming
await (async () => {
  const { items, meta } = await findPerson().paginateCursor({
    orderBy: "id",
    limit: 50,
    strategy: "reverse",
  });
  if (meta.hasNextCursor) {
    const nextPage = await findPerson().paginateCursor({
      orderBy: "id",
      limit: 50,
      strategy: "reverse",
      cursor: meta.nextCursor,
    });
    // back to the previous page
    const previousPage = await findPerson().paginateCursor({
      orderBy: "id",
      limit: 50,
      strategy: "reverse",
      cursor: nextPage.meta.previousCursor,
    });
  }
});

// composite index
const result = await findPerson().paginateCursor({
  orderBy: [
    { column: "last_name", nulls: "last" },
    { column: "first_name", nulls: "last" },
    "id", // unique, non-nullable as final element to ensure index is unique
  ],
  limit: 50,
});
```

#### Using column `toCursor()` and `fromCursor()` callbacks

To allow control over the encoding and decoding steps of the opaque cursor
string, the column configuration `toCursor()` and `fromCursor()` callbacks
may be used. These are transformation functions, typically the inverse of
each other.

```ts
// Encode a timestamp column as a numeric Unix timestamp (seconds since epoch)
const result = await findPerson().paginateCursor({
  orderBy: {
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

## `KyShape.stream(chunkSizeOrOptions?)`

Transaction-based streaming.

A memory safe way to process a database result set. Recommended for
short running processes where holding a database transaction open for
the duration is acceptable.

See `KyShape.streamCursor()` for a keyset (cursor) based alternative.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

for await (const item of findPerson().stream()) {
  // process `item`
}
```

### `lazy` mode

A `KyShape` instance with the `lazy` flag set will call `.stream()` automatically
when used in a `for await..of` loop.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query).lazy();
}

for await (const item of findPerson()) {
  // process `item`
}
```

## `KyShape.streamCursor(index, options?)`

Keyset (cursor) based streaming.

A memory safe way to batch process a large database result set. Recommended
for long running background processes where a database transaction should
not be held open.

See `KyShape.stream()` for a transaction based streaming alternative.

- `orderBy` The index used to identify chunk boundaries
- `orderBy.column` Column reference
- `orderBy.direction` Order by direction (default 'asc')
- `orderBy.nulls` Whether nulls will appear first or last (default 'never')
- `options` Configuration settings
- `options.batchSize` Number of records to fetch in each batch (default 1,000)

The `orderBy` parameter may be a single column reference, or a
composite reference (an array of column references). If entered as a string,
the defaults (`{ direction: 'asc', null: 'never' }`) are used. These may be
overridden by providing a configured column reference
(`{ column }`)

The `OrderBy` index must identify unique records in the table (this is typically
achieved by using a composite index with the table's primary key as the
final element). If an element in a composite index is a nullable column,
set the `nulls` property to `first` or `last`, only use the default `never`
for columns that are non-nullable.

`OrderBy` sets the query's `ORDER BY` expression.

```ts
function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query);
}

for await (const item of findPerson().streamCursor("id")) {
  // process each `item`
}
```

Using a composite index:

```ts
const stream = findPerson().streamCursor([
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

### TODO

- `KyShape.count()`
- `KyShape.exists()`
- `KyShape.pluck()`
- `KyShape.streamChunks()`
- `KyShape.streamCursorChunks()`
