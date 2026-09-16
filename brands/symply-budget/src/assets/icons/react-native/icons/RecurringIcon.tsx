import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type RecurringIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function RecurringIcon(props: RecurringIconProps) { return <SymplyBudgetIcon name="recurring" {...props} />; }
