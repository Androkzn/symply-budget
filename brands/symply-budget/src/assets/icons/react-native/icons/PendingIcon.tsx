import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type PendingIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function PendingIcon(props: PendingIconProps) { return <SymplyBudgetIcon name="pending" {...props} />; }
