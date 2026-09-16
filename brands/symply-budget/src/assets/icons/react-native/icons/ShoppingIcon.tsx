import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ShoppingIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ShoppingIcon(props: ShoppingIconProps) { return <SymplyBudgetIcon name="shopping" {...props} />; }
