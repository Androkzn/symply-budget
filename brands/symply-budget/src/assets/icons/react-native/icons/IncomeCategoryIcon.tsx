import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type IncomeCategoryIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function IncomeCategoryIcon(props: IncomeCategoryIconProps) { return <SymplyBudgetIcon name="income-category" {...props} />; }
