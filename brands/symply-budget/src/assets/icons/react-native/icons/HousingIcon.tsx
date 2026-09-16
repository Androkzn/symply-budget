import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type HousingIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function HousingIcon(props: HousingIconProps) { return <SymplyBudgetIcon name="housing" {...props} />; }
