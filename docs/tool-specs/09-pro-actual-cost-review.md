# Pro actual-cost review — v2.1

Inputs: ActualReview linked to a specific issued revision, with confirmed flags and nullable amounts for materials, labor, direct expenses, and overhead. Labor direct/hoursRate is mutually exclusive. Overhead uses explicitly confirmed baseline allocation or entered actual flat amount.

In progress: output entered category costs, recorded subtotal, and missing-category indicators. Category variance may show only for confirmed categories. Suppress final profit, margin, and total variance.
Final: require all categories confirmed (zero valid); actualCost=sum four categories. profitAgainstOriginalQuote=baseline proposedPrice-actualCost; margin = profit / baselinePrice when baselinePrice > 0, regardless of the sign of profit; when baselinePrice = 0, margin = null (undefined); variance=actual-estimated per category/total. Original zero price yields loss amount with undefined margin, not unpriced.

Label baseline overhead as allocated, not measured actual overhead. Label revenue as original quote, not cash received. This version does not model change orders, discounts after acceptance, collections, or actual revenue; disclose that boundary.
Saving/editing actuals never changes baseline inputs, issued outputs, or rates. Recompute from current actual fields without accumulation. New estimate revisions do not automatically rebase actual reviews. Changing baseline requires explicit selection and confirmation, preserving prior review history or a separate new review. Backup includes linked records and IDs.

Regression examples: baseline price $3,200 and final costs $3,500 yield profit -$300 and margin -9.375% (display -9.4%). Baseline price $0 and costs $100 yield profit -$100 and margin null. Do not suppress a loss when the baseline price is positive. A missing baseline price cannot belong to a valid issued revision; reject it as an invalid baseline rather than treating it as zero.
