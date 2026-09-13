# Matching portrait backgrounds

Local review branch: `portrait-matte-rework`. This revision has not been deployed.

The homepage and Careers collage share 14 finished photographs from
`apps/web/src/assets/team-portraits`. The neutral background is #b9b6ad.
Existing card framing, Nageeta's raised position, text and ordering are preserved.
Vite imports give changed photographs content-hashed URLs. Neither page applies
a separate CSS cutout mask or a second brightness filter.

The earlier SVG masks damaged some ear, beard and hair contours. These replacements
were rebuilt from the original photographs using non-generative photo matting,
explicitly authorized by the user. Original photos and old public masks remain
available, but the new rendering does not use those masks.

Processing used rembg 2.0.84, BiRefNet portrait (CPU), and PyMatting closed-form
alpha estimation with foreground color recovery. Inputs were EXIF-oriented and
resized within 1800 x 2520 using Lanczos. A trimap uses thresholds 240/10 and a
40-pixel uncertain edge band at 1800-pixel width (scaled for smaller sources).
This is an estimation band, not a contraction of the final subject boundary.
Natural semitransparent hair edges are composited into the new background.
Fully opaque areas are restored from the source photograph, with only previously
approved exposure multipliers: Aicha 1.04, Asmae 1.03, Dimitry 1.03, Frimpong 1.06,
Nageeta 1.03; all others 1.00. No face generation, reshaping or skin smoothing.

Mirette's sleeve/torso gap needed extra background seeds: purple source pixels
inside x=1280..1460, y=1870..2310 at the normalized resolution. The alpha solver
then recovered the surrounding sleeve edge. No subject contour was hand-drawn.

Exports are lossless WebP, approximately 31 MB for the full set. Most are
1800 x 2520; Mirette is 1800 x 2519. Nageeta's available source is only 640 x 1137
and was not upscaled. Fine hair remains limited by the source photo and matting
estimate, so review enlarged edges before approving publication.

Local working files are in `../output/matting-review` (normalized sources/coarse
mattes), `../output/matting-final` (finished photos/final alpha/report), and the
`../output/matting-*.py` processing scripts. Those drafts, model weights and Python
dependencies are not application assets. Source and final checksums accompany
the committed exports in `portrait-manifest.json`.

Review URLs, while the local servers are running:
- http://127.0.0.1:5193/#team
- http://127.0.0.1:5193/career
- http://127.0.0.1:5196/portrait-review.html
