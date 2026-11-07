---
title: HunterOS — candidates, jobs and the tenant they live in
---

```erd {#schema title="Candidates, jobs and the tenant they live in" subtitle="HunterOS · the Postgres schema behind the funnel"}
group tenancy "Tenancy" hue=indigo {
  entity workspace { id uuid pk; slug text; credit_balance bigint; +4 }
  entity app_user  { id uuid pk; workspace_id fk=tenancy; email text; password_hash text }
}

group intake "Intake" hue=coral {
  entity document  { id uuid pk; workspace_id fk=tenancy; s3_key_original text; status text; +6 }
  entity candidate { id uuid pk; workspace_id fk=tenancy; source_document_id fk=intake; anon_ref int; anonymized_profile jsonb; +18 }
  entity dossier   { id uuid pk; workspace_id fk=tenancy; candidate_id fk=intake; s3_key_pdf text }
}

group funnel "Funnel" hue=spruce {
  entity job         { id uuid pk; workspace_id fk=tenancy; ref text; status text; +19 }
  entity application { id uuid pk; workspace_id fk=tenancy; job_id fk=funnel; candidate_id fk=intake; stage text; +12 }
  entity application_event { id uuid pk; workspace_id fk=tenancy; application_id fk=funnel; kind text }
}

workspace ||--o{ app_user "workspace_id" quiet
workspace ||--o{ intake   "workspace_id" quiet
workspace ||--o{ funnel   "workspace_id" quiet

document.id  ||--o{ candidate.source_document_id
candidate.id ||--o{ dossier.candidate_id
job.id       ||--o{ application.job_id
candidate.id ||--o{ application.candidate_id
application.id ||--o{ application_event.application_id

legend solid "a relationship the model is about"
legend quiet "tenancy — drawn once per group, not once per table"
```
