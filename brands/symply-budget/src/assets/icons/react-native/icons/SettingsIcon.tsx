import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SettingsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SettingsIcon(props: SettingsIconProps) { return <SymplyBudgetIcon name="settings" {...props} />; }
