import type { Dialect } from "../common";

/**
 * `usecase` — who comes to the system, and what for.
 *
 *     actor recruiter "Recruiter" "owns the pipeline"
 *     actor ocr "Mistral OCR" "a secondary actor" external
 *     system hunteros "HunterOS" "the system under discussion" hue=teal {
 *       usecase UC-01 "Upload a CV"
 *       usecase UC-03 "Publish a dossier"
 *     }
 *     recruiter --- UC-01
 *     UC-01 -.-> UC-02 "«include»"
 *
 * `---` is an association and draws with no arrowhead at either end, because neither side drives
 * the other. That is the one notation here that is *less* decorated than a flowchart's, and it
 * matters: an arrow would claim a direction UML does not mean.
 */
export const usecase: Dialect = {
  type: "usecase",
  dir: "LR",
  kinds: { usecase: "usecase", actor: "actor" },
  groupWords: ["group", "system"],
};
