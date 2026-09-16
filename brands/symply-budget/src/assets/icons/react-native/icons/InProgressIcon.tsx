import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type InProgressIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function InProgressIcon(props: InProgressIconProps) { return <SymplyBudgetIcon name="in-progress" {...props} />; }
