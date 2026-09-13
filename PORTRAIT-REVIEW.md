# Matching portrait backgrounds

The homepage and Careers collage use the same neutral background (#b9b6ad) and original photo RGB. Existing crops, Nageeta's raised position and the small approved brightness corrections remain.

The `*-soft.svg` masks wrap the original generated grayscale masks with an SVG filter: clamp low-level grayscale noise, contract the edge by 2 mask pixels, and antialias by 0.6 pixels. This reduces the old wall fringe without regenerating faces. Renaud's fine hair area retains the original matte rather than the contracted boundary. Original source images and masks remain available.

These are still background mattes, not pixel-exact manual retouching of every hair. Enlarged edge comparisons and both page previews were checked locally. The website build and prerender/theme checks passed before release.

Mohamed's matte had a black notch above the left glasses hinge. A localized SVG contour restores original photograph pixels there and joins gradually into the existing temple edge. The correction was compared with the full-resolution original at 4x mask scale, then checked in both page layouts. No portrait RGB file was changed.
