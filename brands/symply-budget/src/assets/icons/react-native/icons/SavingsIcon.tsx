import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SavingsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SavingsIcon(props: SavingsIconProps) { return <SymplyBudgetIcon name="savings" {...props} />; }
