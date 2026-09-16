import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type RemainingIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function RemainingIcon(props: RemainingIconProps) { return <SymplyBudgetIcon name="remaining" {...props} />; }
