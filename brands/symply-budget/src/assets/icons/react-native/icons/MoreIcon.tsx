import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type MoreIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function MoreIcon(props: MoreIconProps) { return <SymplyBudgetIcon name="more" {...props} />; }
