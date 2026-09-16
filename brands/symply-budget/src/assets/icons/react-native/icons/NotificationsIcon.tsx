import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type NotificationsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function NotificationsIcon(props: NotificationsIconProps) { return <SymplyBudgetIcon name="notifications" {...props} />; }
