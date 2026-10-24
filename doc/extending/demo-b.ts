import { Selectable } from "kysely";
import { pipeline } from "kysely-pipeline";
import { Database, db } from "./db.js";

type Person = Selectable<Database["person"]>;
type Aliases = { fn: string; ln: string | null };
type FullName = { full_name: string };

const query = db.selectFrom("person").selectAll();
const findPerson = () => pipeline(query).lazy();

/**
 * `.extend()` allows making changes to the pipeline's query builder
 *
 * It returns a new pipeline with the new query builder.
 */
async () => {
  const person = await findPerson().extend((query) =>
    query.select(["person.first_name as fn", "person.last_name as ln"]),
  );
  console.log(person satisfies (Person & Aliases) | undefined);
};

/**
 * `.map()` transforms the query builder responses
 *
 * It returns a new pipeline with the new transformer function.
 */
async () => {
  const person = await findPerson().map((data) => ({
    ...data,
    full_name: `${data.first_name} ${data.last_name}`,
  }));
  console.log(person satisfies (Person & FullName) | undefined);
};

/**
 * `.compose()` allows grouping query builder extensions and result transformers
 * into a single callback.
 */
async () => {
  const person = await findPerson().compose((pipeline) =>
    pipeline
      .extend((query) =>
        query.select(["person.first_name as fn", "person.last_name as ln"]),
      )
      .map((data) => ({
        ...data,
        full_name: `${data.fn} ${data.ln}`,
      })),
  );
  console.log(person satisfies (Person & Aliases & FullName) | undefined);
};
