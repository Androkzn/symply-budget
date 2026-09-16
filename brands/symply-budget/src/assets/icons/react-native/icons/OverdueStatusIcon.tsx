import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type OverdueStatusIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function OverdueStatusIcon(props: OverdueStatusIconProps) { return <SymplyBudgetIcon name="overdue-status" {...props} />; }
