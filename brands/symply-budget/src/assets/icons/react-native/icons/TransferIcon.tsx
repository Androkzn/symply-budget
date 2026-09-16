import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type TransferIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function TransferIcon(props: TransferIconProps) { return <SymplyBudgetIcon name="transfer" {...props} />; }
