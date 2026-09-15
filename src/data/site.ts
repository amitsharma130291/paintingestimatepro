// Centralized copy for pricing, availability, and navigation so launch
// messaging can change later without touching layout components.

export const SITE_NAME = "Painting Estimate Pro";

export const NAV_LINKS = [
  { href: "#price-book-health", label: "Pro preview" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#free-tools", label: "Free tools" },
  { href: "#faq", label: "FAQ" },
] as const;

// "View Pro preview" always points at the static product demonstration —
// used by the header and the hero's primary action — never at a working
// app, checkout, or signup.
export const HEADER_CTA = { label: "View Pro preview", href: "#price-book-health" };

export const FREE_TOOLS_LINK = { label: "Explore free painting tools", href: "#free-tools" };

// A modest way out of the Price Book Health demo toward the offer, instead
// of looping every CTA back to the same static preview.
export const PRICE_BOOK_TO_PRICING_LINK = {
  label: "See the planned features and price",
  href: "#pricing",
};

// The offer card's own action forwards to objection-handling FAQ content
// rather than repeating the preview link — kept as secondary styling so it
// never reads like a purchase button.
export const PRICING_FAQ_LINK = { label: "Read questions about Pro", href: "#faq" };

export const CLOSING_CTA_PRIMARY = {
  label: "Review the planned Pro offer",
  href: "#pricing",
};

export const HERO_OFFER_LINE = "Planned at $99 one-time · No monthly subscription";

export const HERO_AVAILABILITY_NOTE = "In development · Illustrative previews below";

export const PRICING_AVAILABILITY_NOTE =
  "In development. Purchasing is not available yet.";

export const STATUS_COMING_SOON = "Coming soon";
export const STATUS_PREVIEW = "Illustrative preview";
export const STATUS_EXAMPLE = "Illustrative example";

export const PRICE = {
  amount: "$99",
  caption: "One-time purchase · Planned lifetime access",
};

export const TARGET_MARGIN = "35%";

// UX-012: the homepage's Price Book Health section is a hand-authored,
// clearly-labeled SAMPLE table, never a captured screenshot and never a
// claim that these are the live tool's actual default numbers. Pulled out
// here (rather than left inline in PriceBookHealth.astro) so the sample
// data and its "review pricing" flags have real automated test coverage:
// tests/browser/priceBookHealthSampleLabeling.test.ts independently
// recomputes each row's flag from its own margin vs. TARGET_MARGIN and
// confirms it matches, instead of that consistency being verified only by
// a human reading the numbers.
export const PRICE_BOOK_SAMPLE_ROWS = [
  { service: "Walls", price: "$1.80 / ft²", margin: "42.2%", status: "Above target", flag: false },
  { service: "Ceilings", price: "$1.50 / ft²", margin: "28.0%", status: "Review pricing", flag: true },
  { service: "Trim", price: "$1.25 / linear ft", margin: "36.8%", status: "Above target", flag: false },
  { service: "Doors", price: "$85 / door", margin: "21.2%", status: "Review pricing", flag: true },
] as const;

export const PRICE_BOOK_SAMPLE_INTRO =
  "A single target margin. Different results across your services. The planned Price Book Health view helps you identify where to review your prices and cost assumptions.";

export const PRICE_BOOK_SAMPLE_CALLOUT_HEADING = "Two rates to review before your next quote.";

export const PRICE_BOOK_SAMPLE_CALLOUT_BODY =
  "In this example, ceilings and doors fall below the target. Review their underlying costs and prices before reusing those rates.";

export const PRICE_BOOK_SAMPLE_FOOTNOTE =
  "Margin is estimated profit divided by price. Actual results depend on your inputs and job conditions.";
