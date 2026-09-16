import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SkippedIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SkippedIcon(props: SkippedIconProps) { return <SymplyBudgetIcon name="skipped" {...props} />; }
