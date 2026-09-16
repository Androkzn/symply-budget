import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type SubscriptionsIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function SubscriptionsIcon(props: SubscriptionsIconProps) { return <SymplyBudgetIcon name="subscriptions" {...props} />; }
