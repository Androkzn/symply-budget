-- Drop the legacy, runtime-created `life_os_ai_usage` table (AI cost-guard
-- counters). After the Kaizen rebrand the cost-guard code creates and uses
-- `kaizen_ai_usage` at request time (CREATE TABLE IF NOT EXISTS), leaving the
-- old table orphaned. `IF EXISTS` makes this a no-op on fresh databases and on
-- the house DB. The counters are ephemeral (per-window AI spend) and regenerate.
-- Immutable once applied remote; do not edit.
DROP TABLE IF EXISTS life_os_ai_usage;
