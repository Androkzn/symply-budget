import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type AiCoachIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function AiCoachIcon(props: AiCoachIconProps) { return <SymplyBudgetIcon name="ai-coach" {...props} />; }
