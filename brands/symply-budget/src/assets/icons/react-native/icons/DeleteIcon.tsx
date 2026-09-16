import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type DeleteIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function DeleteIcon(props: DeleteIconProps) { return <SymplyBudgetIcon name="delete" {...props} />; }
