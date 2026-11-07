# `class` — types and how they relate

    group app "Application" hue=indigo {
      class IngestService { -store: DocumentStore; +ingest(upload) Candidate }
      interface TextExtractor { +extract(doc) list[Page] }
      class MistralExtractor { -api_key: SecretStr; +extract(doc) list[Page] }
    }

    MistralExtractor ..|> TextExtractor
    IngestService ..> TextExtractor "«uses»"
    Candidate *-- Profile "1"
    AnonymisedProfile --|> Profile

A member with `()` is a method, without is an attribute, and the two land in separate compartments
automatically. Visibility: `+` `-` `#` `~`. Kinds `class` `interface` `abstract` `enum` set the
stereotype line.
