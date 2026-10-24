import { pipeline, Pipeline, PipelineState } from "kysely-pipeline";
import { Database, db } from "./db.js";
import { PetPipeline } from "./pet.js";
import { jsonArrayFrom } from "kysely/helpers/postgres";

export type PersonPipeline<
  O,
  T,
  S extends PipelineState,
  TB extends keyof Database = "person",
> = TB extends "person" ? Pipeline<Database, TB, O, T, S> : never;

/**
 * Find records from the `person` table.
 *
 * @returns QueryBuilderPipeline
 */
export function findPerson() {
  const query = db.selectFrom("person").selectAll();
  return pipeline(query).lazy().throwIfNotFound();
}

/**
 * Factory method for a pipeline composition callback to extend a `person`
 * query with a `pets` object containing an array of related `pet` records.
 *
 * @param petPipeline PetPipeline
 * @returns (pipe: PersonPipeline) => PersonPipeline
 */
export function addPetsToPerson<O, T, S extends PipelineState>(
  petPipeline: PetPipeline<O, T, S>,
) {
  return <O, T, S extends PipelineState>(
    personPipeline: PersonPipeline<O, T, S>,
  ) =>
    personPipeline.extend((query) =>
      query.select(({ ref }) =>
        jsonArrayFrom(
          petPipeline.query.whereRef("pet.owner_id", "=", ref("person.id")),
        ).as("pets"),
      ),
    );
}
