import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type OtherIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function OtherIcon(props: OtherIconProps) { return <SymplyBudgetIcon name="other" {...props} />; }
