import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type BillsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function BillsIcon(props: BillsIconProps) { return <SymplyBudgetIcon name="bills" {...props} />; }
