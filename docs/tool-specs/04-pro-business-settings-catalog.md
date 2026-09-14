# Pro business settings and catalog — v2.1

Inputs/entities are BusinessSettings, PaintVariant, OtherMaterial, ServiceDefinition in ../DATA_CONTRACT.md. Every setting consumed elsewhere is defined there, including waste, supplies allowance, and travel.

Outputs: validated persisted settings/catalog, explicit service models, and immutable copies for new draft RateSnapshots. Confirm sample assumptions before first priced issue. Allow incomplete setup to save, but show exactly which enabled calculations lack inputs.

Current catalog edits affect new drafts and live Price Book Health only. Existing draft snapshots survive autosave/reopen. Explicit refresh creates a preview and asks for confirmation. Issued estimates require a new revision.

Variants differing in color, sheen, coverage, or price remain separate identities. No automatic matching by name+price. Delete live variant only after warning about current service links; affected live services become incomplete. Existing snapshots keep working.
Changing default labor/production settings does not invisibly rewrite customized service assumptions: provide 'refresh service defaults' with a change preview. Current overhead/target and material variants feed live health directly.
Travel default becomes exactly one new-draft expense line. Supplies allowance is one mutually exclusive mode, not a second untracked percentage. Users can also itemize other materials; make double-counting risk visible in the component breakdown.
