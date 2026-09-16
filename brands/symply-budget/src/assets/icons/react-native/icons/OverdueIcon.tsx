import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type OverdueIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function OverdueIcon(props: OverdueIconProps) { return <SymplyBudgetIcon name="overdue" {...props} />; }
