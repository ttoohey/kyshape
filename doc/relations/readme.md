# kyshape: Relations

Chanining and nesting composable queries.

See [Composition](../composition/readme.md) for background.

```ts
import { Selectable } from "kysely";
import { addMotherToPerson, addPetsToPerson, findPerson } from "./person.js";
import { addOwnerToPet, findPet } from "./pet.js";
import { Database } from "./db.js";

type Pet = Selectable<Database["pet"]>;
type Person = Selectable<Database["person"]>;
type Owner<T = {}, U = Person> = { owner: U & T };
type Mother<T = {}, U = Person> = { mother: (U & T) | null };
type Pets<T = {}, U = Pet> = { pets: (U & T)[] };

/**
 * Chaining to add multiple unrelated fields to a query.
 */
async () => {
  const person = await findPerson()
    .shape(addPetsToPerson(findPet()))
    .shape(addMotherToPerson(findPerson()));
  console.log(person satisfies Person & Pets & Mother);
  console.log(person.pets satisfies Pet[]);
  console.log(person.mother satisfies Person | null);
};

/**
 * Nesting objects in the query builder with de-JSON-ifying the results.
 */
async () => {
  const pet = await findPet().shape(
    addOwnerToPet(
      findPerson().shape(
        addMotherToPerson(findPerson().shape(addPetsToPerson(findPet()))),
      ),
    ),
  );
  console.log(pet satisfies Pet & Owner<Mother<Pets>>);
  console.log(pet.owner satisfies Person & Mother<Pets>);
  console.log(pet.owner.mother! satisfies Person & Pets);
  console.log(pet.owner.mother!.pets satisfies Pet[]);
};
```

Extending the `addPetsToPerson()` operator with a `.transform()` doing two
things:

1. Transform the JSON-ified `pet` data to correct types
2. Apply any transforms the `petShape` needs using the shape's
   `builder.applyTransform()` method

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
```

The `petFromJson()` function performs the type casting.

```ts
// pet.ts

/**
 * Transform a "pet" record that was JSON-ified by being selected via
 * `jsonArrayFrom()` or `jsonObjectFrom()`.
 *
 * @param json the JSON-ified data
 * @returns data cast back to Pet type
 */
export function petFromJson<T extends JsonFrom<Partial<Pet>>>(json: T) {
  const { ...rest } = json;
  const data = rest as Omit<T, keyof Pet> & Pet;
  // currently Pet == JsonFrom<Pet> so there's no type casting to be done here.
  return data;
}
```

The `JsonFrom` type is a utility type to typecast a type into it's JSON-ified
version. Since the `pets` field of `data` comes from the
`jsonArrayFrom().as("pets")` call, the types are cast to JSON types (`null`,
`number`, `string`, `object`, `array`).

The same pattern is followed to create the reciprical relationship from `pet`
to `person` via the `pet.owner_id` field.

```ts
// pet.ts
/**
 * `KyShape` operator function to extend a `pet` query with an `owner` object
 * containing the pet's related owner (`person`) record.
 *
 * @param ownerShape PersonShape
 * @returns (builder: KyShapeBuilder) => KyShapeBuilder
 */
export function addOwnerToPet<PersonO, PersonT>(
  ownerShape: PersonShape<PersonO, PersonT>,
) {
  return <O, T>(petBuilder: PetBuilder<O, T>) =>
    petBuilder
      .build((query) =>
        query.select(({ ref }) =>
          jsonObjectFrom(
            ownerShape.shape.query.whereRef(
              "person.id",
              "=",
              ref("pet.owner_id"),
            ),
          )
            .$notNull()
            .as("owner"),
        ),
      )
      .transform(({ owner, ...rest }) => ({
        ...rest,
        owner: ownerShape.shape.applyTransform(
          personFromJson(owner!) as PersonO,
        ),
      }));
}
```

In this case the relationship is many-to-one so `owner` is a single object,
not an array like `pets` was. The `jsonObjectFrom().as("owner")` function is
used.

The `owner` is transformed via `personFromJson()` and also by the `ownerShape`
transformer (`.shape.applyTransform()`). As with `pets` this allows the
JSON-ified "person" data to be cast to the correct type, and ensures the
person's shape transformation isn't lost.

```ts
// person.ts
/**
 * Transform a "person" record that was JSON-ified by being selected via
 * `jsonArrayFrom()` or `jsonObjectFrom()`.
 *
 * @param json the JSON-ified data
 * @returns data cast back to Person type
 */
export function personFromJson<T extends JsonFrom<Partial<Person>>>(json: T) {
  const { created_at, ...rest } = json;
  const data = rest as Omit<T, keyof Person> & Person;
  if (created_at !== undefined) {
    data.created_at = new Date(created_at);
  }
  return data;
}
```

> [!Note]
>
> Why does `builder.transform()` require the type assertions for the
> final .applyTransform()? This is a good question, and the short answer is I
> don't know. Perhaps one day my typescript-fu will be better and I can answer
> it.

The "mother" relationship is again similar to the `pet.owner -> person`
relationship. It is also a many-to-one relation, but since it's a "to self"
relation there's a couple of nuances.

```ts
// person.ts
/**
 * `KyShape` operator to extend a `person` query with a `mother` object
 * containing the related mother's `person` record.
 *
 * @param motherShape KyShape
 * @returns (builder: KyShapeBuilder) => KyShapeBuilder
 */
export function addMotherToPerson<MotherO extends { id: number }, MotherT>(
  motherShape: PersonShape<MotherO, MotherT>,
) {
  return <O, T>(personBuilder: PersonBuilder<O, T>) =>
    personBuilder
      .build((query) =>
        query.select((eb) =>
          jsonObjectFrom(
            db
              .selectFrom(
                db
                  .selectFrom(motherShape.shape.query.as("t"))
                  .selectAll()
                  .as("m"),
              )
              .selectAll()
              .whereRef("m.id", "=", eb.ref("person.mother_id")),
          ).as("mother"),
        ),
      )
      .transform(({ mother, ...rest }) => ({
        ...rest,
        mother:
          mother === null
            ? null
            : motherShape.shape.applyTransform(
                personFromJson(mother!) as MotherO,
              ),
      }));
}
```

Since `motherShape.shape.query` is a `SELECT FROM person` query, and `person` is
not aliased (and we cannot change it to be aliased within this function), it gets
wrapped in `db.selectFrom(query).selectAll().as("m")`. This allows the
`.whereRef()` to use the alias `m.id` which would otherwise conflict with the
outer `person` table.

This pattern necessitates ensuring the `motherShape`'s query includes the
`id` column in the query's `SELECT` list. The `MotherO` generic type extends
`{ id: number }` to provide a type-safe way to ensure this (it's also this that
makes `m.id` resolvable to something kysely understands).

> [!Note]
>
> This pattern produces SQL for finding a single linked record.
> `SELECT * FROM (SELECT * FROM person) AS t WHERE t.id=person.mother_id`
> would be could be expressed as
> `SELECT * FROM person AS t WHERE t.id=person.mother_id)`.

Since `person.mother_id` is nullable, then so too is `mother`. This is reflected
in the `builder.transform()` function returning `null` if the value is `null`.

Again, type assertions are required in the final `.transform()` so care must
be taken when creating these functions.
