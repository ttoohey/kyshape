import { pipeline, Pipeline, PipelineState } from "kysely-pipeline";
import { Database, db } from "./db.js";

export type PetPipeline<
  O,
  T,
  S extends PipelineState,
  TB extends keyof Database = "pet",
> = TB extends "pet" ? Pipeline<Database, TB, O, T, S> : never;

/**
 * Find records from the `pet` table.
 *
 * @returns QueryBuilderPipeline
 */
export function findPet() {
  const query = db.selectFrom("pet").selectAll();
  return pipeline(query).throwIfNotFound();
}
