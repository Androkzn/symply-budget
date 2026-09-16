import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type TransportIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function TransportIcon(props: TransportIconProps) { return <SymplyBudgetIcon name="transport" {...props} />; }
