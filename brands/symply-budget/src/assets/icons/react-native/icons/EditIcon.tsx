import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type EditIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function EditIcon(props: EditIconProps) { return <SymplyBudgetIcon name="edit" {...props} />; }
