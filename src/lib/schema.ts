// Schema.org JSON-LD builders. Kept framework-agnostic (plain objects) so
// Astro pages can JSON.stringify() them straight into
// <script type="application/ld+json"> tags at build time.
//
// Deliberately excluded everywhere: aggregateRating / review. There are no
// real customer reviews or ratings anywhere in the product, so adding them
// would be fabricated social proof Google could penalize (and the exact
// thing every pricing-page brief in this project has banned).

const BRAND_NAME = "PaintingPricing Calculator";
const PRODUCT_NAME = "Painting Estimate Pro";

export function organizationSchema(siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}/#organization`,
    name: BRAND_NAME,
    url: siteUrl,
    logo: `${siteUrl}/apple-touch-icon.png`,
  };
}

export function websiteSchema(siteUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl}/#website`,
    name: BRAND_NAME,
    url: siteUrl,
    publisher: { "@id": `${siteUrl}/#organization` },
  };
}

interface ProductSchemaOptions {
  /** Page URL this Offer is actually purchasable from. */
  url: string;
  /** Real, current copy describing the product — no rewriting for SEO. */
  description: string;
  /** Numeric price string, no currency symbol (e.g. "79", not "$79"). */
  price: string;
  /** Absolute image URL — a real product screenshot, not a stock photo. */
  image: string;
}

export function productSchema(siteUrl: string, opts: ProductSchemaOptions) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${siteUrl}/#product`,
    name: PRODUCT_NAME,
    description: opts.description,
    image: opts.image,
    brand: { "@id": `${siteUrl}/#organization` },
    url: opts.url,
    offers: {
      "@type": "Offer",
      url: opts.url,
      price: opts.price,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  };
}

interface FaqEntry {
  question: string;
  answer: string;
}

export function faqPageSchema(faqs: readonly FaqEntry[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };
}

// Embedding JSON inside an HTML <script> tag is safe from all of this
// content's real inputs (hardcoded marketing copy, no user input reaches
// these builders) but "</script" appearing in a string would still break
// out of the tag early — escape defensively rather than assume.
export function toLdJson(schema: unknown): string {
  return JSON.stringify(schema).replace(/</g, "\\u003c");
}
