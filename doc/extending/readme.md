# kyshape: Extending

Extending the `KyShape` instance query builder and transforming results.

- use `.shape(builder => ...)` to compose the shape
- use `builder.build(query => ...)` to modify the query builder
- use `builder.transform(row => ...)` to modify the result transformer

These methods can be chained multiple times to create complex shapes.

```ts
import { Selectable } from "kysely";
import { kyshape } from "kyshape";
import { Database, db } from "./db.js";

type Person = Selectable<Database["person"]>;
type Aliases = { fn: string; ln: string | null };
type FullName = { full_name: string };

const query = db.selectFrom("person").selectAll();
const findPerson = () => kyshape(query).lazy();

/**
 * `builder.build()` allows making changes to the `KyShape` instance's query
 * builder
 *
 * It returns a new `KyShape` instance with the new query builder.
 */
async () => {
  const person = await findPerson().shape((builder) =>
    builder.build((query) =>
      query.select(["person.first_name as fn", "person.last_name as ln"]),
    ),
  );
  console.log(person satisfies (Person & Aliases) | undefined);
};

/**
 * `builder.transform()` transforms the query builder responses
 *
 * It returns a new `KyShape` instance with the new transformer function.
 */
async () => {
  const person = await findPerson().shape((builder) =>
    builder.transform((data) => ({
      ...data,
      full_name: `${data.first_name} ${data.last_name}`,
    })),
  );
  console.log(person satisfies (Person & FullName) | undefined);
};

/**
 * `.shape()` allows grouping query builder extensions and result transformers
 * into a single callback.
 */
async () => {
  const person = await findPerson().shape((builder) =>
    builder
      .build((query) =>
        query.select(["person.first_name as fn", "person.last_name as ln"]),
      )
      .transform((data) => ({
        ...data,
        full_name: `${data.fn} ${data.ln}`,
      })),
  );
  console.log(person satisfies (Person & Aliases & FullName) | undefined);
};
```
