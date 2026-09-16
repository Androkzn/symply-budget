import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type IncomeIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function IncomeIcon(props: IncomeIconProps) { return <SymplyBudgetIcon name="income" {...props} />; }
