---
title: HunterOS — an application moves through the funnel
---

```state {#funnel title="An application moves through the funnel" subtitle="HunterOS · every value application.stage can hold, and the event that changes it"}
state new       "New"       "stage = \"new\""
state screening "Screening" "stage = \"screening\""
state interview "Interview" "stage = \"interview\""
state offer     "Offer"     "stage = \"offer\""
state hired     "Hired"     "stage = \"hired\"" done
state rejected  "Rejected"  "stage = \"rejected\"" muted
state declined  "Declined"  "stage = \"declined\"" muted

[*] --> new
new --> screening "shortlist"
screening --> interview "invite"
interview --> offer "send offer"
offer --> hired "accept"
hired --> [*]

interview --> interview "reschedule"
new & screening & interview --> rejected "reject" quiet
offer --> declined "decline" quiet
rejected --> [*]
declined --> [*]

legend quiet "leaves the funnel"
```
