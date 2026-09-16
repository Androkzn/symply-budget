import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SoftTransferIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SoftTransferIcon(props: SoftTransferIconProps) { return <SymplyBudgetIcon name="soft-transfer" {...props} />; }
