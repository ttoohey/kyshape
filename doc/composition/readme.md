# kyshape: Composition

Creating repositories of composable logic.

```ts
import { Selectable } from "kysely";
import { addPetsToPerson, findPerson } from "./person.js";
import { findPet } from "./pet.js";
import { Database } from "./db.js";

type Person = Selectable<Database["person"]>;
type Pet = Selectable<Database["pet"]>;

type Pets = { pets: Pet[] };

/**
 * Use `.shape()` to extend the query builder to find
 * related `Pet` records.
 *
 * `findPet()` is a `KyShape` instance for selecting all pets
 *
 * `addPetsToPerson(findPet())` extends the "person" instance to include
 * a `pets` field containing the pets identified in the `findPet()` instance,
 * with the query extended to find only related `pet` records.
 *
 * The findPerson() instance resolves to a `Person & { pets: Pet[] }` shape.
 */
async () => {
  const person = await findPerson().shape(addPetsToPerson(findPet()));
  console.log(person satisfies Person & Pets);
  for (const pet of person.pets) {
    console.log(pet satisfies Pet);
  }
};
```

## How to write shape operators

### Each repository has a `Shape` and `Builder` type

Create `Shape` and `Builder` types for each repository class. These are types
that narrows the generic `KyShape` type to be specific for the repository.

```ts
// person.ts
export type PersonShape<
  O,
  T,
  S extends KyShapeState = any,
  TB extends keyof Database = "person",
> = TB extends "person" ? KyShape<Database, TB, O, T, S> : never;

type PersonBuilder<
  O,
  T,
  TB extends keyof Database = "person",
> = TB extends "person"
  ? KyShapeBuilder<KyShape<Database, TB, O, T, any>>
  : never;
```

```ts
// pet.ts
export type PetShape<
  O,
  T,
  S extends KyShapeState = any,
  TB extends keyof Database = "pet",
> = TB extends "pet" ? KyShape<Database, TB, O, T, S> : never;
```

The generic parameters:

- `O` is the shape that the `SELECT` database query returns, the same as the `O` in `SelectQueryBuilder<DB, TB, O>`
- `T` is the shape returned by the transformer (a function `(data: O) => T`) updated by the `.transform()` modifier.
- `S` contains state information for the shape. `S["required"]` is a
  boolean that tells the shape whether `.first()` will throw if no record is
  found; it determines whether the results may be undefined or not (`true` means
  non-undefined results). `S["lazy"]` is a boolean that tells the shape whether
  lazy `await` or `for await..of` can be used on the shape directly.
- `TB` is the database table key, the same as the `TB` in `SelectQueryBuilder<DB, TB, O>`

The ternary condition (`TB extends "person"` and `TB extends "pet"`) is a guard
to prevent passing an invalid shape to functions.

### Each repository has a `find` function

Create a `find` function in each repository which returns a `KyShape` instance
initialised with a basic "select all" query builder.

> [!TIP]
>
> Typically the `find` function takes parameters so the intial query builder
> can be created with `.where()` conditions etc. This example is deliberately
> cut-down to the bare essentials.

```ts
// person.ts
/**
 * Find records from the `person` table.
 *
 * @returns KyShape
 */
export function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query).lazy().required();
}
```

```ts
// pet.ts
/**
 * Find records from the `pet` table.
 *
 * @returns KyShape
 */
export function findPet() {
  const query = db.selectFrom("pet").selectAll();
  return kyshape(query).required();
}
```

### Create KyShape operator functions

See https://kysely.dev/docs/recipes/relations for some background.

The essential step we want to encapsulate is extending the query builder
to include a `pets` field with the list of related pets.

In _kysely_ this is typically done like:

```ts
const persons = await db
  .selectFrom("person")
  .selectAll("person")
  .select((eb) => [
    // pets
    jsonArrayFrom(
      eb
        .selectFrom("pet")
        .select(["pet.id", "pet.name"])
        .whereRef("pet.owner_id", "=", "person.id")
        .orderBy("pet.name"),
    ).as("pets"),
  ])
  .execute();
console.log(persons[0].pets[0].name);
```

We will encapsulate this in a `KyShape` operator function. The operator function
returns a function suitable to be passed to `.shape()`.

```ts
// person.ts
/**
 * `KyShape` operator function to extend a `person` query with a `pets` object
 * containing an array of related `pet` records.
 *
 * @param petShape PetShape
 * @returns (builder: KyShapeBuilder) => KyShapeBuilder
 */
export function addPetsToPerson<PetO, PetT>(petShape: PetShape<PetO, PetT>) {
  return <O, T>(personBuilder: PersonBuilder<O, T>) =>
    personBuilder.build((query) =>
      query.select(({ ref }) =>
        jsonArrayFrom(
          petShape.shape.query.whereRef("pet.owner_id", "=", ref("person.id")),
        ).as("pets"),
      ),
    );
}
```

> [!NOTE]
>
> We don't include `.select()` or `.orderBy()` expressions in the `KyShape` operator
> since these may be left to the `petShape` instance's query being passed. That is,
> it's up to the caller to decide what shape of `Pet` to return and what order
> the pets will be listed in.

The operator function (`addPetsToPerson()`) accepts generics `<PetO, PetT>`
which are inferred by the actual `KyShape` instance that is passed
(`petShape`). This makes the shape of pets up to the caller.

The returned function accepts generics `<O, T>` which are inferred by the
`KyShape` instance being updated (`personBuilder`). This makes the operator function
versatile, so it can be used with any shape of `Person`, and `KyShape` instances
with and without the `required` or `lazy` flags set.

The `jsonArrayFrom()` call is passed `petShape.shape.query`, rather than creating
a query builder from scratch using `db.selectFrom("pet")`. The `.shape.query`
accessor on `KyShape` instances returns the shape's query builder. It's a normal
`SelectQueryBuilder<Database, "pet", PetO>` shaped query builder from _kysely_.
