import { Selectable } from "kysely";
import { pipeline } from "kysely-pipeline";
import { Database, db } from "./db.js";

type Person = Selectable<Database["person"]>;

const query = db.selectFrom("person").selectAll();
const findPerson = () => pipeline(query);
const findPersonLazy = () => findPerson().lazy();

/**
 * Retrieve the first matching record of the pipeline's query builder.

* It calls the query builder `executeTakeFirst()` method.
 */
async () => {
  const person = await findPerson().first();

  person satisfies Person | undefined;
};

/**
 * A pipeline with the `lazy` flag set  is a "thenable" object which calls
 * `.first()` automatically if it's awaited.
 *
 */
async () => {
  const person = await findPersonLazy();
  console.log(person satisfies Person | undefined);
};

/**
 * A pipeline with the `throwIfNotFound()` flag set makes `.first()`
 * reject if the record is not found, which narrows
 * the type to be non-null.
 *
 * It calls the query builder `executeTakeFirstOrThrow()` method.
 */
async () => {
  const person = await findPerson().throwIfNotFound().first();
  console.log(person satisfies Person);
};

/**
 * `list()` will return an array of results from the query.
 *
 * The optional `limit` and `offset` arguments can be
 * used to get a slice of the result set.
 *
 * It calls the query builder `execute()` method.
 */
async () => {
  const people = await findPerson().list();
  console.log(people satisfies Person[]);
};
async (limit?: number, offset?: number) => {
  const people = await findPerson().list(limit, offset);
  console.log(people satisfies Person[]);
};

/**
 * `.page()` will return an array of results along with pagination meta data
 * using offset pagination.
 *
 * It calls the query builder `execute()` method.
 *
 * If `options.counting` is true (the default) it will
 * execute a second query to get the total count of
 * records.
 *
 * The `meta` result shape depends on `options.counting`.
 */
async (page: number = 1, pageSize: number = 10) => {
  const result = await findPerson().page(page, pageSize);
  console.log(result.items satisfies Person[], result.meta);
};

async (page: number = 1, pageSize: number = 10) => {
  const result = await findPerson().page(page, pageSize, {
    counting: false,
  });
  console.log(result.items satisfies Person[], result.meta);
};

/**
 * `.seek()` will return an array of results along with pagination meta data
 * using cursor/keyset pagination.
 *
 * It calls the query builder `execute()` method.
 *
 * The cursor index column may be a single column, which should be a unique
 * index (cursor pagination results can be jumbled if it's not).
 *
 * The cursor index may also be a list of columns, and again should define
 * a unique index. The typical way to do this is to put the primary key as
 * the final item in the list.
 *
 * Forward and reverse pagination is supported via `first` and `last` fields
 * and following the `nextCursor` and `previousCursor` values in the returned
 * meta data.
 *
 * If `options.counting` is true it will execute a second query to get the
 * total count of records (default is `false` since keyset pagination is
 * typically used for efficiency and adding an extra query to
 * calculate the total number records is rarely required).
 */
async () => {
  const result = await findPerson().seek({
    index: "person.id",
    first: 10,
  });
  console.log(result.items satisfies Person[], result.meta);
};

async () => {
  const page1 = await findPerson().seek({
    index: ["person.created_at", "id"],
    first: 10,
  });
  if (page1.meta.hasNext) {
    const page2 = await findPerson().seek({
      index: ["person.created_at", "id"],
      first: 10,
      cursor: page1.meta.nextCursor,
    });
    console.log(page2.items satisfies Person[]);
  }
};

async () => {
  const result = await findPerson().seek({ index: "person.id", first: 10 });
  result.items satisfies Person[];
  if (result.meta.hasNext) {
    result.meta.nextKey satisfies number;
    result.meta.nextCursor satisfies string;
  }
};

async () => {
  const result = await findPerson().seek({
    index: {
      column: "created_at",
      direction: "desc",
      nulls: "never",
    },
    first: 10,
  });
  result.items satisfies Person[];
  if (result.meta.hasNext) {
    result.meta.nextKey satisfies Date;
    result.meta.nextCursor satisfies string;
  }
};

async (key?: [Date, number]) => {
  const result = await findPerson().seek({
    index: [{ column: "created_at" }, "person.id"],
    first: 10,
    key,
    counting: true,
  });
  result.items satisfies Person[];
  result.meta.totalItems satisfies number;
  if (result.meta.hasNext) {
    result.meta.nextKey satisfies [Date, number];
    result.meta.nextCursor satisfies string;
  }
};

/**
 * `.stream()` allows async iteration over results using transaction based
 * streaming.
 *
 * It calls the query builder `stream()` method.
 */
async () => {
  for await (const person of findPerson().stream()) {
    console.log(person satisfies Person);
  }
};

/**
 * If the pipeline's `lazy` flag is set then `.stream()` is called automatically
 * when used in a `for await..of` loop.
 */
async () => {
  for await (const person of findPersonLazy()) {
    console.log(person satisfies Person);
  }
};

/**
 * `.cursor()` is for keyset async iteration over results. Results are fetched
 * in batches (controlled by the `options.batchSize` setting), and yielded as
 * async results.
 */
async () => {
  for await (const person of findPerson().cursor("person.id")) {
    console.log(person satisfies Person);
  }
};

/**
 * `.cursor()` with a composite index.
 */
async () => {
  for await (const person of findPerson().cursor(["created_at", "person.id"])) {
    console.log(person satisfies Person);
  }
};

async () => {
  for await (const person of findPerson().stream()) {
    console.log(person satisfies Person);
  }
};
