import { kyshape, KyShape, KyShapeBuilder, KyShapeState } from "kyshape";
import { JsonFrom } from "kyshape/helpers";
import { Database, db } from "./db.js";
import { personFromJson, PersonShape } from "./person.js";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import { Selectable } from "kysely";

type Pet = Selectable<Database["pet"]>;

export type PetShape<
  O,
  T = O,
  S extends KyShapeState = any,
  TB extends keyof Database = "pet",
> = TB extends "pet" ? KyShape<Database, TB, O, T, S> : never;

type PetBuilder<O, T, TB extends keyof Database = "pet"> = TB extends "pet"
  ? KyShapeBuilder<KyShape<Database, TB, O, T, any>>
  : never;

/**
 * Find records from the `pet` table.
 *
 * @returns KyShape
 */
export function findPet() {
  const query = db.selectFrom("pet").selectAll();
  return kyshape(query).lazy().required();
}

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
