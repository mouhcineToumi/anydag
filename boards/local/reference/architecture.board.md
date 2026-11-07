---
title: Larkspur — what runs where
theme: paper
---

```arch {#infra title="What runs where" subtitle="Larkspur · the app, its ports, and the pipeline that ships it"}
client browser "Learner's browser" "react 19 · vite · spa" icon=monitor

group gcp "Google Cloud" "larkspur-prod · europe-west1" hue=indigo {
  group run "Cloud Run" hue=teal {
    service web "larkspur-web" "nginx · the built spa and the landing page" icon=layout
    service api "larkspur-api" "fastapi · uvicorn · hexagonal" icon=server {
      identity "verify the id token"
      content  "tracks · branches · nodes"
      progress "read and write"
      assets   "signed urls"
    }
  }
  group fb "Firebase" hue=spruce {
    store auth  "Authentication" "google · email link" icon=key-round
    store fs    "Firestore" "larkspur-dev" icon=database
    store gcs   "Cloud Storage" "larkspur-dev-bucket · -public" icon=archive
  }
}

group delivery "Delivery" "push to main → a verified revision" hue=ochre {
  external gha  "GitHub Actions" "larkspur/larkspur-app" icon=git-branch
  service  wif  "Workload Identity" "no key anywhere" icon=shield
  service  ar   "Artifact Registry" "tagged with VERSION" icon=package
  service  dep  "Deploy a revision" "europe-west1" icon=circle-arrow-up
  service  hc   "Check /api/health" "VERSION must match" icon=activity
}

browser --> web "https"
browser --> api "/api"

api.identity --> auth
api.content  --> fs
api.progress --> fs
api.assets   --> gcs

gha --> wif --> ar --> dep --> hc
dep -.-> run "deploys"

legend solid    "a call at runtime"
legend dashed   "happens at deploy time"
legend external "runs outside the project"
```
