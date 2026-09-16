import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SpendingsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SpendingsIcon(props: SpendingsIconProps) { return <SymplyBudgetIcon name="spendings" {...props} />; }
