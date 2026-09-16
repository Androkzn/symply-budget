import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type MaintenanceFundIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function MaintenanceFundIcon(props: MaintenanceFundIconProps) { return <SymplyBudgetIcon name="maintenance-fund" {...props} />; }
