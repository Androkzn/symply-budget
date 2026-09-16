import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type CategoriesIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function CategoriesIcon(props: CategoriesIconProps) { return <SymplyBudgetIcon name="categories" {...props} />; }
