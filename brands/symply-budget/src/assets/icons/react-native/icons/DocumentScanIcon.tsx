import React from 'react';

import { SymplyBudgetIcon, type SymplyBudgetIconProps } from '../SymplyBudgetIcon';
export type DocumentScanIconProps = Omit<SymplyBudgetIconProps, 'name'>;
export function DocumentScanIcon(props: DocumentScanIconProps) { return <SymplyBudgetIcon name="document-scan" {...props} />; }
