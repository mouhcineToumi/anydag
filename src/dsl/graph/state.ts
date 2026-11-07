import type { Dialect } from "../common";

/**
 * `state` — every value a field can hold, and the event that changes it.
 *
 *     state screening "Screening" "stage = \"screening\""
 *     state hired "Hired" "stage = \"hired\"" done
 *     [*] --> new --> screening "shortlist" --> interview "invite"
 *     interview --> interview "reschedule"
 *     new & screening & interview --> rejected "reject" quiet
 *     rejected --> [*]
 *
 * The second string is the stored value, in mono — this is a diagram about data, and `stage =
 * "screening"` is the thing you would grep for.
 *
 * `current` used to mark where one particular record sat, in the same blue that marked a subject
 * everywhere else. It is gone with the rest of the accent ring: a picture of every value a field
 * can hold is a picture of the type, and one record's position is a different diagram.
 */
export const state: Dialect = {
  type: "state",
  dir: "LR",
  kinds: { state: "state" },
};
