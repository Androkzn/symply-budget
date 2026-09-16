import React from 'react';

import { Chip } from '@components/ui';

interface MemberStatusBadgeProps {
  role: 'owner' | 'member';
  size?: 'sm' | 'md';
}

export function MemberStatusBadge({ role, size = 'sm' }: MemberStatusBadgeProps) {
  return (
    <Chip
      label={role === 'owner' ? 'Owner' : 'Member'}
      variant={role === 'owner' ? 'primary' : 'secondary'}
      size={size}
    />
  );
}
