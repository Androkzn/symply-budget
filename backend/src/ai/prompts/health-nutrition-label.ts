/**
 * Nutrition-label scanning — single-step vision extraction.
 *
 * Ported from the donor's `POST /api/v1/ai/scan-nutrition-label`
 * (`~/Desktop/Symply Ecosystem/Simply Health/backend/src/routes/ai.ts` L434).
 * The donor's nine CRITICAL RULES are kept almost verbatim — they are good, and
 * they are what makes an OCR pass trustworthy ("Extract EXACT values from the
 * label, not estimates", "Calories is the MOST important field", "Handle both US
 * and Canadian label formats", "product_name MUST ALWAYS be in English").
 *
 * ── THREE DELIBERATE CHANGES ─────────────────────────────────────────────────
 *
 * 1. **The donor needed TWO scans; this needs one.** The donor's label pass
 *    reads the Nutrition Facts panel, then its UI immediately asks the user to
 *    "Scan Product Name" from the package front through a SECOND endpoint
 *    (`/scan-product-name`), because the panel usually does not carry the brand.
 *    Here `product_name` / `brand` stay in this schema AND the user may attach
 *    the front-of-pack shot as a second image in the same request, so one round
 *    trip does both. Two model calls to read one box of cereal is a cost and a
 *    latency the member pays for nothing.
 *
 * 2. **`base_*_per_100` is requested explicitly.** The donor returns only
 *    per-SERVING figures, so its food rows cannot be re-portioned afterwards —
 *    the exact gap migration 0124 closed for the diary ("A nutrition PORTION
 *    could not be re-derived"). `custom_foods` in this platform stores
 *    `base_calories_per_100` etc. as the single basis every portion derives
 *    from, so the scan has to produce it. When the label prints a per-100 g
 *    column (mandatory in the EU/UK, common in Canada) the model COPIES it;
 *    otherwise the service derives it arithmetically from serving size, and says
 *    which of the two happened via `per_100_source`. Deriving in the service
 *    rather than asking the model for arithmetic is deliberate: a model that is
 *    told to divide will sometimes round first.
 *
 * 3. **`serving_size_g` is separated from the printed `serving_size` text.**
 *    "2/3 cup (55 g)" is what the label says; 55 is what the maths needs.
 *
 * Units: exactly as printed on the label, which is what the donor's rule 7 says.
 * Energy is kcal. Every macro is grams; sodium/cholesterol/potassium are mg.
 */

/** One scanned label, before any normalisation. */
export interface RawNutritionLabel {
  /** Always English — translated if the pack is not. Null when unreadable. */
  product_name: string | null;
  brand: string | null;
  /** Verbatim serving text, e.g. "2/3 cup (55g)". */
  serving_size: string | null;
  /** The serving mass in GRAMS (or ml), parsed out of `serving_size`. */
  serving_size_g: number | null;
  /** Unit that `serving_size_g` is expressed in. */
  serving_size_unit: 'g' | 'ml' | null;
  servings_per_container: number | null;
  /** Per SERVING unless `per_100_declared` is true — see the module header. */
  calories: number | null;
  total_fat: number | null;
  saturated_fat: number | null;
  trans_fat: number | null;
  cholesterol: number | null;
  sodium: number | null;
  total_carbohydrates: number | null;
  dietary_fiber: number | null;
  total_sugars: number | null;
  added_sugars: number | null;
  protein: number | null;
  /** The per-100 column WHEN THE LABEL PRINTS ONE. Never computed by the model. */
  per_100_calories: number | null;
  per_100_protein: number | null;
  per_100_carbohydrates: number | null;
  per_100_fat: number | null;
  ingredients: string | null;
  vitamin_d: number | null;
  calcium: number | null;
  iron: number | null;
  potassium: number | null;
  /** 0–1. The donor's field; the UI turns it into a "verify these values" banner. */
  confidence: number | null;
  notes: string | null;
}

export const SCAN_NUTRITION_LABEL_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: [
    'product_name',
    'brand',
    'serving_size',
    'serving_size_g',
    'serving_size_unit',
    'servings_per_container',
    'calories',
    'total_fat',
    'saturated_fat',
    'trans_fat',
    'cholesterol',
    'sodium',
    'total_carbohydrates',
    'dietary_fiber',
    'total_sugars',
    'added_sugars',
    'protein',
    'per_100_calories',
    'per_100_protein',
    'per_100_carbohydrates',
    'per_100_fat',
    'ingredients',
    'vitamin_d',
    'calcium',
    'iron',
    'potassium',
    'confidence',
    'notes',
  ],
  properties: {
    product_name: {
      type: ['string', 'null'],
      description:
        'The product name in ENGLISH. If the package is in French, Spanish, or any other language, TRANSLATE it. Null if no product name is visible anywhere in the images.',
    },
    brand: {
      type: ['string', 'null'],
      description: 'Brand or manufacturer as printed, with ® and ™ removed. Null if not visible.',
    },
    serving_size: {
      type: ['string', 'null'],
      description: 'The serving-size line VERBATIM as printed, e.g. "2/3 cup (55g)" or "per 30 g".',
    },
    serving_size_g: {
      type: ['number', 'null'],
      description:
        'The numeric serving mass parsed out of the serving line, e.g. 55 for "2/3 cup (55g)". Null when the label gives no gram/ml figure for a serving.',
    },
    serving_size_unit: {
      type: ['string', 'null'],
      enum: ['g', 'ml', null],
      description: 'The unit of serving_size_g. "ml" only for liquids labelled by volume.',
    },
    servings_per_container: {
      type: ['number', 'null'],
      description: 'Servings per container/package if printed, else null.',
    },
    calories: {
      type: ['number', 'null'],
      description:
        'Energy PER SERVING in kcal, exactly as printed. This is the single most important field — if the panel shows it, it must not be null. If the label prints only kJ, convert (kJ / 4.184) and say so in notes.',
    },
    total_fat: { type: ['number', 'null'], description: 'Total fat per serving, grams.' },
    saturated_fat: { type: ['number', 'null'], description: 'Saturated fat per serving, grams.' },
    trans_fat: { type: ['number', 'null'], description: 'Trans fat per serving, grams.' },
    cholesterol: { type: ['number', 'null'], description: 'Cholesterol per serving, MILLIGRAMS.' },
    sodium: { type: ['number', 'null'], description: 'Sodium per serving, MILLIGRAMS.' },
    total_carbohydrates: {
      type: ['number', 'null'],
      description: 'Total carbohydrate per serving, grams.',
    },
    dietary_fiber: { type: ['number', 'null'], description: 'Dietary fibre per serving, grams.' },
    total_sugars: { type: ['number', 'null'], description: 'Total sugars per serving, grams.' },
    added_sugars: { type: ['number', 'null'], description: 'Added sugars per serving, grams.' },
    protein: { type: ['number', 'null'], description: 'Protein per serving, grams.' },
    per_100_calories: {
      type: ['number', 'null'],
      description:
        'ONLY when the label prints a separate PER 100 g (or per 100 ml) column: the kcal from that column, copied. NEVER calculate this yourself — leave it null and the app derives it.',
    },
    per_100_protein: {
      type: ['number', 'null'],
      description: 'Protein from the printed per-100 column, grams. Null if there is no such column.',
    },
    per_100_carbohydrates: {
      type: ['number', 'null'],
      description: 'Carbohydrate from the printed per-100 column, grams. Null if no such column.',
    },
    per_100_fat: {
      type: ['number', 'null'],
      description: 'Fat from the printed per-100 column, grams. Null if no such column.',
    },
    ingredients: {
      type: ['string', 'null'],
      description:
        'The INGREDIENTS list as one string, preserving the printed order and commas, if it is visible anywhere in the images. Null when not visible.',
    },
    vitamin_d: { type: ['number', 'null'], description: 'Vitamin D per serving, micrograms, or null.' },
    calcium: { type: ['number', 'null'], description: 'Calcium per serving, milligrams, or null.' },
    iron: { type: ['number', 'null'], description: 'Iron per serving, milligrams, or null.' },
    potassium: { type: ['number', 'null'], description: 'Potassium per serving, milligrams, or null.' },
    confidence: {
      type: ['number', 'null'],
      description:
        'How well the panel could be read, 0 to 1. Use 0.9+ for a sharp, fully legible panel; 0.5–0.8 when some rows are blurred or cropped; below 0.4 when you are mostly inferring layout.',
    },
    notes: {
      type: ['string', 'null'],
      description:
        'One short sentence about anything that limits the reading — glare, a cropped row, kJ-only energy, a per-100-only panel. Null when the read was clean.',
    },
  },
};

export const SCAN_NUTRITION_LABEL_SYSTEM_PROMPT = `You are a nutrition label OCR expert. Extract ALL nutrition information from the food label image or images you are given.

CRITICAL RULES:
1. Extract EXACT values from the label, not estimates. You are transcribing, not calculating.
2. Calories is the MOST important field — always extract it when the panel shows it.
3. Handle every label format: US "Nutrition Facts", Canadian bilingual "Nutrition Facts / Valeur nutritive", EU/UK "Nutrition Information" per-100 tables, and Australian "per serve / per 100 g" tables.
4. Look for: Serving Size, Servings Per Container, Calories (or Energy), Total Fat, Saturated Fat, Trans Fat, Cholesterol, Sodium, Total Carbohydrates, Dietary Fibre, Total Sugars, Added Sugars, Protein.
5. Also look for the product name and brand — they are usually on the FRONT of the pack, not on the panel. Several images may be attached (the panel and the front); read them all as ONE product.
6. If an INGREDIENTS list is visible anywhere in the images, extract it as one string, preserving the printed order and commas.
7. Return values in the units printed on the label. Energy in kcal, macros in grams, sodium/cholesterol/potassium in milligrams. If a label gives energy ONLY in kilojoules, divide by 4.184 and note it.
8. product_name MUST ALWAYS be in English. If the label is in French, Spanish, or any other language, TRANSLATE the product name to English.
9. Do NOT calculate the per-100 g figures. Copy them ONLY if the label prints a separate per-100 g (or per-100 ml) column; otherwise leave the per_100_* fields null. The app derives them from serving size, and a model that divides tends to round first.
10. Never invent a number. A row you cannot read is null, not a plausible value. Set confidence low and say why in notes.
11. If the image is not a nutrition label at all — a receipt, a menu, a person, a blank wall — return every field null with confidence 0 and say so in notes. Do not describe the image and do not produce a "typical" label for what you think the food is.

Always return via the "output" tool.`;

export const SCAN_NUTRITION_LABEL_USER_PROMPT =
  'Read this nutrition label and return every value printed on it: the serving size (with its gram figure), servings per container, calories, fat, saturated fat, trans fat, cholesterol, sodium, carbohydrates, fibre, sugars, added sugars and protein, plus the product name and brand in English, the ingredients list if visible, and the per-100 g column only if the label prints one. If several images are attached they are the same product — read them together.';
