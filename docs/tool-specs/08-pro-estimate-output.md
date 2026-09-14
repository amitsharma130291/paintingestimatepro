# Pro customer estimate output — v2.1

Input: issued EstimateRevision customerDocumentSnapshot, or a deliberately labeled draft preview assembled using an allow-list.
Allow-list: estimate number/date, business/customer info, project title/address, scope descriptions with surfaces/coats, selling total proposedPrice, currency, notes/terms, revision label, tax-not-included notice, draft/issued status. Logo optional and safely decoded; no script-capable embedded content.
Excluded by construction: purchase costs, loaded rates, hours costing, overhead allocation, internal quantities/cost breakdown, estimated profit/margin, catalog settings, actuals, payment/license data. Describe scope quantities only when deliberately in customer scope.

V1 customer document uses one project selling total; no invented distribution across lines. Detailed line-item selling prices require an explicit later model; internal cost lines are not selling line prices.

Priced output requires complete valid inputs and proposedPrice (zero allowed only after explicit no-charge confirmation). Unpriced/incomplete draft can render scope-only with DRAFT and PRICE PENDING, never misleading zero. Issued documents never recalculate using today's catalog/engine.

Print/PDF: retain all scope text, repeat table headers where applicable, prevent overlap/clipped totals, distinguish internal view from customer preview, remove controls from print. Tax notice: 'Prices exclude taxes; taxes are not calculated by this tool.' Do not claim tax-complete invoicing. Long descriptions and malicious-looking text render safely as literal text. Test multi-page output and omitted-logo cases.
