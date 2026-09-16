import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type BudgetIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function BudgetIcon(props: BudgetIconProps) { return <SymplyBudgetIcon name="budget" {...props} />; }
