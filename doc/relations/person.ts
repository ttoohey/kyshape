import { Selectable } from "kysely";
import { jsonArrayFrom, jsonObjectFrom } from "kysely/helpers/postgres";
import { kyshape, KyShape, KyShapeBuilder, KyShapeState } from "kyshape";
import { JsonFrom } from "kyshape/helpers";
import { Database, db } from "./db.js";
import { petFromJson, PetShape } from "./pet.js";

export type PersonShape<
  O,
  T = O,
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

export type Person = Selectable<Database["person"]>;

/**
 * Find records from the `person` table.
 *
 * @returns KyShape
 */
export function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return kyshape(query).lazy().required();
}

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

/**
 * `KyShape` operator function to extend a `person` query with a `pets` object
 * containing an array of related `pet` records.
 *
 * @param petShape KyShape
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
