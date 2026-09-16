import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type FoodIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function FoodIcon(props: FoodIconProps) { return <SymplyBudgetIcon name="food" {...props} />; }
