import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type UtilitiesIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function UtilitiesIcon(props: UtilitiesIconProps) { return <SymplyBudgetIcon name="utilities" {...props} />; }
