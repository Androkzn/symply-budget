-- Pension "Room" tab — let a household set a member's contribution room (RRSP / TFSA)
-- WITHOUT creating a full registered account. Such a "room-only" entry is stored as a
-- lightweight registered_accounts row (member_id + account_type + starting_room_cents,
-- everything else null/0) so the existing CRA room engine stays the single source of
-- truth. is_room_only flags these placeholder rows so the client hides them from the
-- Accounts tab. When the user later adds a balance/institution/transactions, the flag
-- is cleared and the row becomes a normal account.
ALTER TABLE registered_accounts ADD COLUMN is_room_only INTEGER NOT NULL DEFAULT 0;
