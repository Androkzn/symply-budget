import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type PlannedIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function PlannedIcon(props: PlannedIconProps) { return <SymplyBudgetIcon name="planned" {...props} />; }
