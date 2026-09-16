import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type PaidIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function PaidIcon(props: PaidIconProps) { return <SymplyBudgetIcon name="paid" {...props} />; }
