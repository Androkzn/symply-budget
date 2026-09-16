import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type ReviewDraftIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function ReviewDraftIcon(props: ReviewDraftIconProps) { return <SymplyBudgetIcon name="review-draft" {...props} />; }
