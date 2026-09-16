import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type HomeIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function HomeIcon(props: HomeIconProps) { return <SymplyBudgetIcon name="home" {...props} />; }
