import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type HealthIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function HealthIcon(props: HealthIconProps) { return <SymplyBudgetIcon name="health" {...props} />; }
