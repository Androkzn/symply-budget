import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ExpenseIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ExpenseIcon(props: ExpenseIconProps) { return <SymplyBudgetIcon name="expense" {...props} />; }
