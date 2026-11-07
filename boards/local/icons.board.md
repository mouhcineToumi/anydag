---
title: Icons — the three modes
theme: paper
---

```md {#intro x=-168 y=-296 w=680}
# Three kinds of glyph

A **concept** glyph is Lucide — a server, a queue, a person. It draws in `currentColor` and takes
the tile's hue, so the theme still owns every colour on the card.

A **mono** glyph is a brand reduced to a silhouette. Same contract, same tint: `icon=mono:postgresql`
is Postgres' elephant wearing the group's hue rather than Postgres' blue.

A **brand** glyph is the logo in its own colours. It gets a neutral tile and the hue moves to the
card border, because two colour systems inside one 36px square read as noise.
```

```arch {#concept x=-128 y=224 title="Concept glyphs" subtitle="Lucide · hue-tinted, theme owns the colour"}
group a "One group, one hue" hue=teal {
  service api "api" "the kind carries the icon" icon=server
  store db "store" icon=database
  queue q "queue" icon=list-ordered
  client ui "client" icon=monitor
}
api --> db
api --> q
ui --> api
```

```arch {#mono x=992 y=288 title="Mono glyphs" subtitle="Simple Icons · a brand, still wearing the hue" dir=TB}
group b "Same hue, real brands" hue=violet {
  service pg "postgres" "icon=mono:postgresql" icon=mono:postgresql
  service dk "docker" "icon=mono:docker" icon=mono:docker
  service k8 "kubernetes" "icon=mono:kubernetes" icon=mono:kubernetes
  service rd "redis" "icon=mono:redis" icon=mono:redis
}
pg --> dk
dk --> k8
k8 --> rd
```

```arch {#brand x=2040 y=184 title="Brand glyphs" subtitle="logos · unmodified, neutral tile, hue on the border"}
group c "Data" hue=teal {
  store pg "PostgreSQL" "icon=postgresql" icon=postgresql
  store rd "Redis" "icon=redis" icon=redis
  store ch "ClickHouse" "icon=clickhouse" icon=clickhouse
}
group d "Platform" hue=indigo {
  service dk "Docker" icon=docker
  service k8 "Kubernetes" icon=kubernetes
  service tf "Terraform" icon=terraform
}
group e "AI" hue=ochre {
  external oai "OpenAI" icon=openai
  external ant "Anthropic" icon=anthropic
  external mis "Mistral" icon=mistral-ai
}
dk --> pg
k8 --> dk
tf --> k8
ant --> ch
oai --> rd
mis --> ch
```

```arch {#cloud x=5096 y=336 title="Cloud services" subtitle="aws:* and gcp:* — CC0 where one exists"}
group aws "AWS" hue=ochre {
  service lam "Lambda" "aws:lambda" icon=aws:lambda
  store s3 "S3" "aws:s3" icon=aws:s3
  store rds "RDS" "aws:rds" icon=aws:rds
  queue sqs "SQS" "aws:sqs" icon=aws:sqs
}
group gcp "Google Cloud" hue=indigo {
  service run "Cloud Run" "gcp:cloud-run" icon=gcp:cloud-run
}
lam --> s3
lam --> rds
sqs --> lam
run --> rds
```

```arch {#status x=3592 y=288 title="Status still outranks the brand" subtitle="a border says what a node is doing before it says which group it is in"}
group f "One group, one hue" hue=teal {
  service ok "shipped" "done" icon=docker done
  service bad "failing" "stop" icon=redis stop
  service slow "waiting" "wait" icon=postgresql wait
}
ok --> bad
ok --> slow
```

```arch {#gradients x=4320 y=288 title="Gradients and ids" subtitle="86 of 195 colour marks carry an id — the same one twice is the collision case"}
group g "The same icon twice, plus four more that carry ids" hue=violet {
  service a1 "Azure one" icon=microsoft-azure
  service a2 "Azure two" icon=microsoft-azure
  service sb "Supabase" icon=supabase
  service gf "Grafana" icon=grafana
  service py "Python" icon=python
  service ng "Angular" icon=angular
}
a1 --> sb
a2 --> gf
py --> ng
```

```arch {#dark x=6400 y=288 title="Dark-theme risk" subtitle="marks that are black-on-transparent vanish on a dark tile"}
group h "Black marks" {
  service gh "GitHub" icon=github
  service vc "Vercel" icon=vercel
  service ex "Express" icon=express
  service nx "Next.js" icon=nextjs
}
gh --> vc
ex --> nx
```

```arch {#vendor x=7128 y=288 title="Vendor packs" subtitle="Azure has no CC0 equivalent — these three share gradient ids upstream"}
group az "Azure — three icons, one set of gradient ids" hue=indigo {
  service i1 "Intune" icon=azure:intune
  service i2 "Intune App Protection" icon=azure:intune-app-protection
  service i3 "Intune for Education" icon=azure:intune-for-education
}
group svc "Services with no CC0 mark" hue=teal {
  service aks "AKS" icon=azure:aks
  store cos "Cosmos DB" icon=azure:cosmos-db
  service fn "Functions" icon=azure:functions
}
i1 --> aks
i2 --> cos
i3 --> fn
```

```edges {#edges-mm44}
intro --> concept
```
