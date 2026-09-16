import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type CompleteIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function CompleteIcon(props: CompleteIconProps) { return <SymplyBudgetIcon name="complete" {...props} />; }
