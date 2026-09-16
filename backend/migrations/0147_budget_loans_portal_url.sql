-- Symply Budget — optional "manage this loan online" link on `budget_loans` (0146).
-- Households tracking a BNPL/installment plan (IKEA, Affirm, Klarna, a bank's loan
-- portal) often have a URL to check balance/make a payment; surfacing it saves a
-- bookmark hunt. Pure convenience field — never fetched server-side, validated only
-- as a well-formed URL at the zod boundary. NULL = "not set", same as lender/notes.
ALTER TABLE budget_loans ADD COLUMN portal_url TEXT;
