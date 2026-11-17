# `flow` — who does what, in what order

    lane recruiter "Recruiter" hue=ochre {
      step 01  "Upload a CV" "pdf · docx · 20 MB"
      step 04a "Ask for a clearer file" "status = failed" stop
      step 06a "Confirm the weak fields" "waits for a person" wait
    }
    lane hunteros "HunterOS" hue=teal {
      step 02 "Store the raw file" "minio · original"
      decision 04 "Any text found?"
      step 07 "Anonymise and publish" "dossier · anon_ref" done
    }
    lane ai "AI services" hue=magenta { step 03 "Extract the text" "mistral · ocr" async }

    01 --> 02 --> 03 --> 04
    04 --> 04a "no"
    04 --> 05 "yes"

A `decision` is a pill, not a diamond. The step's id is shown, so make it short and meaningful.

A step is a fixed width that its meta widens (the meta never wraps), and its title wraps inside it:
the card is drawn for two title lines, and grows one line taller for each line past them. A long
title is never cut off, but a short one keeps a column of steps in rhythm.

Columns come from longest-path order, bands from lane order — neither is ELK's.

A loop back — `retry --> check` after `check --> fix "no"` — is fine: the body of the loop lands in
the columns after the decision it returns to, and the return edge is drawn back to it.
