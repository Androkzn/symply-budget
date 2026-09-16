/**
 * useAihousekeeperPersona — single source of truth for resolving the currently
 * selected Aihousekeeper persona + its effective display name.
 *
 * Returns:
 *   - persona: the PersonaMeta for the selected id (falls back to cat)
 *   - name: custom name if the user set one in settings, otherwise
 *           persona.displayName. Use this for all UI strings (placeholders,
 *           tab labels, hero headers) so the display stays in sync.
 */

import { useMemo } from 'react';

import { getPersona, type PersonaMeta } from '@assets/aihousekeeper/personas';
import { useAihousekeeperStore } from '@stores/aihousekeeperStore';

export interface AihousekeeperPersonaHandle {
  persona: PersonaMeta;
  name: string;
}

export function useAihousekeeperPersona(): AihousekeeperPersonaHandle {
  const selectedPersonaId = useAihousekeeperStore((s) => s.selectedPersonaId);
  const customPersonaName = useAihousekeeperStore((s) => s.customPersonaName);
  const persona = useMemo(() => getPersona(selectedPersonaId), [selectedPersonaId]);
  const name = customPersonaName ?? persona.displayName;
  return { persona, name };
}
