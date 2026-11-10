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
