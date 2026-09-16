import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type GoalIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function GoalIcon(props: GoalIconProps) { return <SymplyBudgetIcon name="goal" {...props} />; }
