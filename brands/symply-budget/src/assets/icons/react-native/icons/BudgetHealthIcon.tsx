import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type BudgetHealthIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function BudgetHealthIcon(props: BudgetHealthIconProps) { return <SymplyBudgetIcon name="budget-health" {...props} />; }
