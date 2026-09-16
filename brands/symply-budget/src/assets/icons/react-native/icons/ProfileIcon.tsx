import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ProfileIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ProfileIcon(props: ProfileIconProps) { return <SymplyBudgetIcon name="profile" {...props} />; }
