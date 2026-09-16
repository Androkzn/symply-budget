import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ImportIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ImportIcon(props: ImportIconProps) { return <SymplyBudgetIcon name="import" {...props} />; }
