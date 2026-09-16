import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ShareIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ShareIcon(props: ShareIconProps) { return <SymplyBudgetIcon name="share" {...props} />; }
