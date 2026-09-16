import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SearchIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SearchIcon(props: SearchIconProps) { return <SymplyBudgetIcon name="search" {...props} />; }
