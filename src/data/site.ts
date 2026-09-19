// Centralized copy for pricing, availability, and navigation so launch
// messaging can change later without touching layout components.

export const SITE_NAME = "Painting Estimate Pro";

// NAV-LINK-FIX: every one of these hash anchors only exists on the
// homepage (index.astro). Header.astro and Footer.astro render NAV_LINKS
// on every page site-wide, so a bare "#anchor" (no leading "/") is a dead
// link on the other 10+ pages -- it just tries to scroll to an element
// that isn't there, instead of navigating home first. Namespacing with a
// leading "/" makes each link work correctly both from the homepage
// itself (still a same-page scroll) and from anywhere else (navigates to
// "/" and lands on the anchor).
// NAV-002: "Pro preview" (-> the homepage demo section) and "Open Pro"
// (-> /app, which just shows the same pricing card to anyone who hasn't
// bought yet) were two more ways to reach the same place the header's own
// CTA button and this "Pro" link already cover -- three nav items for one
// destination reads as noise, not choice. One link to the real sales page
// replaces both; the CTA button (dynamic, see HEADER_CTA/HEADER_CTA_UNLOCKED
// below) is the actual buy/launch action.
export const NAV_LINKS = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#free-tools", label: "Free tools" },
  { href: "/#faq", label: "FAQ" },
  { href: "/help", label: "Help" },
  { href: "/pricing", label: "Pro" },
  { href: "/contact", label: "Contact" },
] as const;

// The header/hero/closing CTA button's default (never-purchased) state --
// every element tagged data-pro-cta swaps to HEADER_CTA_UNLOCKED instead,
// site-wide, the instant a stored license is found in this browser (see
// BaseLayout.astro's inline script). Points at the real sales page, not a
// bare demo anchor -- that page is where "Buy Pro" itself actually lives.
export const HEADER_CTA = { label: "Buy Pro — $79", href: "/pricing" };
export const HEADER_CTA_UNLOCKED = { label: "Go to app", href: "/app" };

// The homepage hero keeps its own "see the demo first" framing -- distinct
// from the header CTA's direct buy intent -- so changing one never silently
// changes the other's copy.
export const HERO_CTA = { label: "See how it works", href: "/#price-book-health" };

export const FREE_TOOLS_LINK = { label: "Explore free painting tools", href: "/#free-tools" };

// A modest way out of the Price Book Health demo toward the offer, instead
// of looping every CTA back to the same static preview.
export const PRICE_BOOK_TO_PRICING_LINK = {
  label: "See pricing and what's included",
  href: "/#pricing",
};

// The offer card's own action forwards to objection-handling FAQ content
// rather than repeating the preview link — kept as secondary styling so it
// never reads like a purchase button.
export const PRICING_FAQ_LINK = { label: "Read questions about Pro", href: "/#faq" };

export const CLOSING_CTA_PRIMARY = {
  label: "See Pro pricing",
  href: "/#pricing",
};

// LAUNCH-001: Pro's real Dodo checkout is live at the $79 launch price
// (originalAmount is shown struck through beside it) — everywhere on the
// site that mentioned "planned"/"in development"/"not yet" for Pro itself
// was pre-launch copy and has been updated to reflect that. This does NOT
// apply to the free-tools "Coming soon" badges (STATUS_COMING_SOON, genuine
// not-yet-built tools) or the "illustrative example" labels on sample data
// (STATUS_PREVIEW/STATUS_EXAMPLE) — those are unrelated, still-true
// disclosures about specific unbuilt tools / hypothetical numbers.
export const HERO_AVAILABILITY_NOTE = "Illustrative example below · Live now";

export const PRICING_AVAILABILITY_NOTE =
  "Secure checkout via Dodo Payments · Instant access after purchase.";

export const STATUS_COMING_SOON = "Coming soon";
export const STATUS_PREVIEW = "Illustrative preview";
export const STATUS_EXAMPLE = "Illustrative example";

export const PRICE = {
  amount: "$79",
  originalAmount: "$99",
  caption: "One-time purchase · Lifetime access",
};

// The real, live policy in terms.astro's "Refunds" section — kept as one
// constant so the guarantee is never quoted at a different length in two
// places on the sales page. Change terms.astro FIRST if this ever changes;
// this is marketing copy, not the policy itself.
export const REFUND_GUARANTEE_DAYS = 7;

// The one purchase-CTA phrase used everywhere someone can actually buy
// (LicenseActions.tsx's own button, plus every marketing section that
// talks about clicking it) — so the promise made in copy always matches
// the button's own label.
export const BUY_CTA_LABEL = `Get lifetime access — ${PRICE.amount}`;

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
  "A single target margin. Different results across your services, shown here as an illustrative example. Price Book Health helps you identify where to review your own prices and cost assumptions.";

export const PRICE_BOOK_SAMPLE_CALLOUT_HEADING = "Two rates to review before your next quote.";

export const PRICE_BOOK_SAMPLE_CALLOUT_BODY =
  "In this example, ceilings and doors fall below the target. Review their underlying costs and prices before reusing those rates.";

export const PRICE_BOOK_SAMPLE_FOOTNOTE =
  "Margin is estimated profit divided by price. Actual results depend on your inputs and job conditions.";
