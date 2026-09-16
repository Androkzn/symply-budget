-- Drop the action-item entity entirely. Report-derived findings now convert
-- straight to tasks (see task-draft-service.ts); nothing left references
-- these tables after 0061 repointed all FKs at tasks. No real users yet, so
-- no data backfill.

DROP TABLE action_item_guidance;
DROP TABLE action_items;
DROP TABLE action_plans;
