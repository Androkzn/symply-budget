import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SyncIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SyncIcon(props: SyncIconProps) { return <SymplyBudgetIcon name="sync" {...props} />; }
