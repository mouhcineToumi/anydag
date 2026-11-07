# `arch` — what runs, what stores, what calls what

    client browser "Learner's browser" "react 19 · vite" icon=monitor

    group gcp "Google Cloud" "larkspur-prod · europe-west1" hue=indigo {
      group run "Cloud Run" hue=teal {
        service api "larkspur-api" "fastapi · uvicorn" icon=server {
          identity "verify the id token"
          content  "tracks · branches · nodes"
        }
      }
      group fb "Firebase" hue=spruce {
        store auth "Authentication" "google · email link" icon=key-round
        store fs   "Firestore" "larkspur-dev" icon=database
      }
    }

    browser --> api "/api"
    api.identity --> auth
    api.content  --> fs
    deploy -.-> run "deploys"

Kinds: `service` `store` `db` `client` `person` `queue` `external` `container`.
**Rows are ports** — declare what a component depends on and address the row (rule 9).
Nouns, not verbs (rule 7).
