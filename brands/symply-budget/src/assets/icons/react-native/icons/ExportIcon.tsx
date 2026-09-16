import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ExportIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ExportIcon(props: ExportIconProps) { return <SymplyBudgetIcon name="export" {...props} />; }
