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
