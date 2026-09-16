import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SortIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SortIcon(props: SortIconProps) { return <SymplyBudgetIcon name="sort" {...props} />; }
