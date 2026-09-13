# Homepage portrait review

Local branch: `portrait-background-review`
Base: `8d35ea6` (main was pulled before this work).

All 14 homepage portraits use their original photographs, with generated grayscale silhouette masks and one neutral background (`#b9b6ad`). Faces, expressions, pose, clothing and existing card crops are not regenerated. The originals remain untouched.

Visual exposure review: Aicha +4%, Asmae +3%, Dimitry +3%, Frimpong +6%, Nageeta +3%; other portraits remain at original exposure. These modest CSS adjustments are reversible and are not intended to equalize different skin tones.

Preview: http://127.0.0.1:5193/#team

Only the homepage team section is changed. Nothing has been pushed or deployed. Review the hair outlines and brightness in the local preview before merging; generated masks can need edge refinements.
