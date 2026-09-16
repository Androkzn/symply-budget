import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type AddIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function AddIcon(props: AddIconProps) { return <SymplyBudgetIcon name="add" {...props} />; }
