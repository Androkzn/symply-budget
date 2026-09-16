import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ForecastIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ForecastIcon(props: ForecastIconProps) { return <SymplyBudgetIcon name="forecast" {...props} />; }
