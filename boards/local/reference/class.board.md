---
title: HunterOS — one slice of the hexagon
---

```class {#hexagon title="One slice of the hexagon" subtitle="HunterOS · the ingest use case, the ports it declares, and what plugs into them"}
group domain "Domain" hue=spruce {
  class Candidate { +id: UUID; +anon_ref: int; +profile: Profile; +anonymise() AnonymisedProfile; +day_rate() Money }
  class Profile { +full_name: str; +skills: list[str]; +years: float; +headline() str }
  class AnonymisedProfile { +full_name: None; +headline() str }
}

group app "Application" "a port is an interface the core owns; an adapter implements it" hue=indigo {
  class IngestService { -store: DocumentStore; -extractor: TextExtractor; +ingest(upload) Candidate }
  interface TextExtractor { +extract(doc) list[Page] }
  interface DocumentStore { +put(key, data) None; +get(key) bytes; +signed_url(key) str }
  class MistralExtractor { -api_key: SecretStr; +extract(doc) list[Page] }
  class MinioDocumentStore { -client: Minio; -bucket: str; +put(key, data) None; +get(key) bytes; +signed_url(key) str }
}

IngestService ..> TextExtractor "«uses»"
IngestService ..> DocumentStore "«uses»"
MistralExtractor ..|> TextExtractor
MinioDocumentStore ..|> DocumentStore
IngestService ..> Candidate "«creates»"
Candidate *-- Profile "1"
AnonymisedProfile --|> Profile
```
