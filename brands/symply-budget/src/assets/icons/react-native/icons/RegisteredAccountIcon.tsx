import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type RegisteredAccountIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function RegisteredAccountIcon(props: RegisteredAccountIconProps) { return <SymplyBudgetIcon name="registered-account" {...props} />; }
