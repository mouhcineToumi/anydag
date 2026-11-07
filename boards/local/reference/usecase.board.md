---
title: HunterOS — what people come to do
---

```usecase {#uc title="What people come to HunterOS to do" subtitle="Every use case, who takes part, and the two that never run on their own"}
actor recruiter "Recruiter" "owns the pipeline"
actor manager   "Hiring manager" "reviews and decides"
actor candidate "Candidate" "applies"
actor ocr       "Mistral OCR" "a secondary actor" external

system hunteros "HunterOS" "the system under discussion" hue=teal {
  usecase UC-01 "Upload a CV"
  usecase UC-02 "Extract the text"
  usecase UC-03 "Publish a dossier"
  usecase UC-04 "Anonymise the profile"
  usecase UC-05 "Match a candidate to a job"
  usecase UC-06 "Move an application on"
  usecase UC-07 "Apply to a job"
}

recruiter --- UC-01
recruiter --- UC-03
recruiter --- UC-05
recruiter --- UC-06
manager --- UC-05
manager --- UC-06
candidate --- UC-07
UC-01 -.-> UC-02 "«include»"
UC-03 -.-> UC-04 "«include»"
UC-02 --- ocr

```
