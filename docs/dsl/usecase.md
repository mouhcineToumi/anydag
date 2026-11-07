# `usecase` — who comes, and what for

    actor recruiter "Recruiter" "owns the pipeline"
    actor ocr "Mistral OCR" "a secondary actor" external

    system hunteros "HunterOS" "the system under discussion" hue=teal {
      usecase UC-01 "Upload a CV"
      usecase UC-03 "Publish a dossier"
    }

    recruiter --- UC-01
    UC-01 -.-> UC-02 "«include»"
    UC-02 --- ocr

`---` is an association: **no arrowhead at either end**, because neither side drives the other.
Only `«include»` / `«extend»` get an arrow. A use case is a pill with a mono id.

The use cases stack in one column, in the order of the actors that reach them — declare the
actors in the order you want them down the page, and their use cases follow. An `external`
actor stands on the far side of the system. An «include» between two pills is drawn beside the
column.
