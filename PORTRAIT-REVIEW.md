# Natural portrait detail review

Branch: `portrait-natural-detail-review`
Base: `650357f`, pulled from main before editing.

The generated silhouette masks introduce uneven fringes and clipped fine edges. Comparing Mohamed and Renaud with their original full-resolution photos confirms that the background mask, rather than the existing card crop, is responsible.

This local comparison removes silhouette masking from all homepage portraits and the five Careers portraits. It retains the original source photos, existing card frames, Nageeta's approved headroom, and the previously approved small exposure corrections. Original backgrounds and plants are visible again. No facial features are regenerated.

This is a review baseline. A uniform-background version is not claimed to be fixed by this change. The user has been asked whether to prioritize original backgrounds with intact detail or retain the matching background and refine edges.

Local URLs:
- http://127.0.0.1:5193/#team
- http://127.0.0.1:5193/career

Validation: homepage and Careers screenshots reviewed; website build, prerender and theme checks passed. Nothing pushed or deployed.
