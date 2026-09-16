import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type DebtIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function DebtIcon(props: DebtIconProps) { return <SymplyBudgetIcon name="debt" {...props} />; }
