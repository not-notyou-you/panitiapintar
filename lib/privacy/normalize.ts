// Zero-width and invisible formatting characters that can split a number to dodge detection.
const INVISIBLE = /[­᠎​-‏‪-‮⁠-⁤﻿]/g;
// Dash look-alikes mapped to ASCII hyphen so separators stay predictable.
const DASHES = /[‐-―−﹘﹣－]/g;

/** NFKC (folds full-width digits/letters to ASCII), strips invisible chars, unifies dashes. */
export function normalizeForPii(input: string): string {
  return input.normalize("NFKC").replace(INVISIBLE, "").replace(DASHES, "-");
}
