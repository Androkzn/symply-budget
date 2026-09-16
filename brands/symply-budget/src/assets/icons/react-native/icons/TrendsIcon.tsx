import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type TrendsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function TrendsIcon(props: TrendsIconProps) { return <SymplyBudgetIcon name="trends" {...props} />; }
