import { z } from "zod";
export const IllustrationInput = z.object({
  phrases: z.array(
    z.object({ start: z.number().nonnegative(), end: z.number().positive(), text: z.string().max(5000) }),
  ),
  motion: z.boolean(),
  hasStock: z.boolean(),
});
export const IllustrationSchema = z
  .object({
    kind: z.literal("proportion"),
    value: z.number().min(0).max(100),
    start: z.number().nonnegative(),
    end: z.number().positive(),
    sourceText: z.string(),
    reason: z.string(),
  })
  .refine((p) => p.end > p.start);
export function planIllustration(input: z.input<typeof IllustrationInput>) {
  const { phrases, motion, hasStock } = IllustrationInput.parse(input);
  if (!motion || hasStock) return null;
  for (const p of phrases) {
    // Only depict a part-to-whole statement. Changes, discounts and multipliers have different denominators.
    const matches = [
      ...p.text.matchAll(
        /(?<![\d.,+−-])(\d{1,3}(?:[.,]\d+)?)\s*(?:%|percent\b|per cent\b|pour cent\b)\s+(?:of\b|des\b|de\b|du\b)/gi,
      ),
    ];
    if (
      matches.length !== 1 ||
      p.end - p.start < 1.15 ||
      /\b(?:not|never|pas|moins|under|over|about|nearly|almost|than|environ)\b/i.test(p.text)
    )
      continue;
    const value = Number(matches[0]![1]!.replace(",", "."));
    if (value < 0 || value > 100) continue;
    return IllustrationSchema.parse({
      kind: "proportion",
      value,
      start: p.start,
      end: Math.min(p.end, p.start + 3),
      sourceText: p.text,
      reason: "The retained phrase states a specific part of a whole. The bar represents that exact percentage.",
    });
  }
  return null;
}
