import { kyshape, KyShape, KyShapeBuilder, KyShapeState } from "kyshape";
import { Database, db } from "./db.js";
import { PetShape } from "./pet.js";
import { jsonArrayFrom } from "kysely/helpers/postgres";

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
