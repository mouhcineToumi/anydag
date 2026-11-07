---
title: HunterOS — a CV becomes an anonymised dossier
---

```flow {#cv title="A CV becomes an anonymised dossier" subtitle="HunterOS · who does what, and where the run can stop"}
lane recruiter "Recruiter" hue=ochre {
  step 01  "Upload a CV" "pdf · docx · 20 MB"
  step 04a "Ask for a clearer file" "status = failed" stop
  step 06a "Confirm the weak fields" "waits for a person" wait
}
lane hunteros "HunterOS" hue=teal {
  step 02 "Store the raw file" "minio · original"
  decision 04 "Any text found?"
  decision 06 "Every field confident?"
  step 07 "Anonymise and publish" "dossier · anon_ref" done
}
lane ai "AI services" hue=magenta {
  step 03 "Extract the text" "mistral · ocr" async
  step 05 "Parse to a profile" "gemini · json" async
}

01 --> 02 --> 03 --> 04
04 --> 04a "no"
04 --> 05 "yes"
05 --> 06
06 --> 06a "no"
06 --> 07 "yes"
06a --> 07

legend stop "the run stops here"
legend wait "waits for a person"
```
