---
title: HunterOS — publishing a dossier
---

```activity {#publish title="Publishing a dossier" subtitle="HunterOS · three things happen at once, and nothing continues until all three finish"}
lane recruiter "Recruiter" hue=ochre {
  action publish "Publish this dossier" "POST /dossiers"
  action topup   "Top up first" "credits · checkout"
  action notify  "Notify the recruiter" "larkspur-mailer"
}
lane hunteros "HunterOS" hue=teal {
  decision enough "Enough credits?"
  fork f1
  action html   "Render the HTML" "jinja · inline css"
  action pdf    "Render the PDF" "weasyprint"
  action charge "Charge the credits" "credit_balance"
  join j1
  action ready "Mark it ready" "status = \"ready\""
}

[*] --> publish --> enough
enough --> topup "no"
topup --> [*]
enough --> f1 "yes"
f1 --> html & pdf & charge
html & pdf & charge --> j1
j1 --> ready --> notify --> [*]
```
