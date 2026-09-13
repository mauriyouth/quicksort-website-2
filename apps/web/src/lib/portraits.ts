// Conservative exposure corrections after visual review; do not equalize skin tones.
// Preserve original photo RGB; background masks affect only edge transparency.
export const portraitBrightness: Record<string, number> = {
  "aicha": 1.04,
  "asmae": 1.03,
  "dimitry-akulov": 1.03,
  "frimpong-adotri": 1.06,
  "nageeta": 1.03,
};

export const portraitBackground = "#b9b6ad";
