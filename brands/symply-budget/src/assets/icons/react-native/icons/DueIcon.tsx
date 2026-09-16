import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type DueIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function DueIcon(props: DueIconProps) { return <SymplyBudgetIcon name="due" {...props} />; }
