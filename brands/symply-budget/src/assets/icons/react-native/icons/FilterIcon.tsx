import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type FilterIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function FilterIcon(props: FilterIconProps) { return <SymplyBudgetIcon name="filter" {...props} />; }
