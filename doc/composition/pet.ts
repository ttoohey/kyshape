import { kyshape, KyShape, KyShapeState } from "kyshape";
import { Database, db } from "./db.js";

export type PetShape<
  O,
  T,
  S extends KyShapeState = any,
  TB extends keyof Database = "pet",
> = TB extends "pet" ? KyShape<Database, TB, O, T, S> : never;

/**
 * Find records from the `pet` table.
 *
 * @returns KyShape
 */
export function findPet() {
  const query = db.selectFrom("pet").selectAll();
  return kyshape(query).required();
}
