# `erd` — entities and their references

    group tenancy "Tenancy" hue=indigo {
      entity workspace { id uuid pk; slug text; credit_balance bigint; +4 }
      entity app_user  { id uuid pk; workspace_id fk=tenancy; email text }
    }
    group intake "Intake" hue=coral {
      entity candidate { id uuid pk; workspace_id fk=tenancy; source_document_id fk=intake; +18 }
    }
    workspace ||--o{ app_user "workspace_id" quiet
    workspace ||--o{ intake   "workspace_id" quiet
    document.id ||--o{ candidate.source_document_id

Row: `<name> [<type>] [pk] [fk[=<group>]]`. `fk=<group>` colours the pill with that domain's hue,
so a column says where it reaches. `+N` renders a muted "N more columns".

Point the tenancy edge at the **group**, once, rather than at every table (rule 4).
