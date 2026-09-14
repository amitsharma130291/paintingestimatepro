# Paid access boundary — v2.1

This package specifies estimation logic, not a chosen payment integration. Before coding paid delivery, select a provider and document its verified payment-to-license flow from current official documentation.
Required: hosted checkout, server/provider-verified entitlement, no secret keys in client bundles, no unlock based only on success URL, idempotent delivery, failed/cancelled payment behavior, returning-buyer recovery, refund/revocation policy, and clear device/offline terms. Local-first project storage does not eliminate the need for external payment infrastructure.
If using offline signed licenses, signing must occur in a trusted service and client verification uses a public key; browser access checks alone cannot provide strong anti-copy protection. Do not claim unbreakable DRM. No app account required is compatible with purchaser email/license recovery, which must be disclosed separately.
Do not implement a mock localStorage paid=true flag as completed access control. Backup restores project data, not proof of purchase. Purchase acceptance tests are separate from this arithmetic package and remain a launch gate.
