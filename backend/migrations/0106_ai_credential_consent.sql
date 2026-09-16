-- Per-provider AI data-sharing consent (Apple App Review Guideline 5.1.2(i)).
-- On Connect the user gives an explicit, per-provider acknowledgement that their
-- request content (which can include household / budget / financial data) is sent
-- to a third-party AI provider under the user's OWN account and terms, and that
-- the app does not store the personal data they choose to submit.
--
-- `consent_version` records WHICH disclaimer text was accepted so a material
-- change to the terms can force re-consent. `consent_at` is the timestamp of the
-- explicit acceptance — an auditable "permission before first transmission" trail.
-- Both live on the credential row, so disconnect (row delete) resets the flag and
-- reconnecting always re-prompts. See documents/engineering/ai-provider-consent-legal.md.
ALTER TABLE user_ai_credentials ADD COLUMN consent_version TEXT;
ALTER TABLE user_ai_credentials ADD COLUMN consent_at TEXT;
