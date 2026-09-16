import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type InsightsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function InsightsIcon(props: InsightsIconProps) { return <SymplyBudgetIcon name="insights" {...props} />; }
