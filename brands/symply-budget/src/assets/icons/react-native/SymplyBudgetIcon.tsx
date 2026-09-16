import React, { useMemo } from 'react';
import { SvgXml } from 'react-native-svg';

export type SymplyBudgetIconName = 'budget' | 'home' | 'ai-coach' | 'more' | 'planned' | 'spendings' | 'income' | 'expense' | 'remaining' | 'transfer' | 'soft-transfer' | 'import' | 'export' | 'review-draft' | 'bills' | 'due' | 'overdue' | 'recurring' | 'paid' | 'document-scan' | 'savings' | 'goal' | 'registered-account' | 'maintenance-fund' | 'forecast' | 'insights' | 'trends' | 'categories' | 'budget-health' | 'search' | 'filter' | 'sort' | 'edit' | 'add' | 'delete' | 'share' | 'settings' | 'profile' | 'notifications' | 'sync' | 'complete' | 'in-progress' | 'pending' | 'overdue-status' | 'skipped' | 'housing' | 'utilities' | 'food' | 'transport' | 'health' | 'shopping' | 'subscriptions' | 'debt' | 'income-category' | 'other';
export type SymplyBudgetIconProps = {
  name: SymplyBudgetIconName;
  selected?: boolean;
  theme?: 'light' | 'dark';
  size?: number;
  disabled?: boolean;
  accessibilityLabel?: string;
};

const ICONS: Record<SymplyBudgetIconName, string> = {
  "budget": "<path d=\"M4 7.5h13.5A2.5 2.5 0 0 1 20 10v8a2.5 2.5 0 0 1-2.5 2.5H4A2 2 0 0 1 2 18.5v-11A2 2 0 0 1 4 5.5h12\"/> <path d=\"M16 12h5v4h-5a2 2 0 0 1 0-4z\"/><path d=\"M6 10h5\"/>",
  "home": "<path d=\"m3 11 9-8 9 8\"/><path d=\"M5.5 9.5V21h13V9.5\"/><path d=\"M9.5 21v-6h5v6\"/>",
  "ai-coach": "<path d=\"m7 3 .9 2.4L10.5 6 8 6.8 7 9 6.2 6.8 3.5 6l2.7-.6z\"/> <path d=\"m16 7 1.4 3.6L21 12l-3.6 1.4L16 17l-1.4-3.6L11 12l3.6-1.4z\"/> <path d=\"m7 15 .9 2.3 2.4.8-2.4.9L7 21.2 6.1 19l-2.4-.9 2.4-.8z\"/>",
  "more": "<circle cx=\"6\" cy=\"12\" r=\"1.35\" fill=\"currentColor\" stroke=\"none\"/> <circle cx=\"12\" cy=\"12\" r=\"1.35\" fill=\"currentColor\" stroke=\"none\"/> <circle cx=\"18\" cy=\"12\" r=\"1.35\" fill=\"currentColor\" stroke=\"none\"/>",
  "planned": "<rect x=\"3.2\" y=\"5\" width=\"17.6\" height=\"16\" rx=\"3\"/> <path d=\"M7.5 3v4M16.5 3v4M3.5 9.5h17\"/> <path d=\"M14.7 13.2c-.5-.7-1.2-1.1-2.2-1.1-1.2 0-2 .6-2 1.5 0 2.3 4.6 1.2 4.6 3.7 0 .9-.9 1.6-2.3 1.6-1 0-1.8-.3-2.5-1M12.8 11v9\"/>",
  "spendings": "<path d=\"M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z\"/> <path d=\"M9 8h6M9 12h4\"/><path d=\"m13.5 15 3 3 3-3M16.5 18v-6\"/>",
  "income": "<path d=\"M4 8h13.5A2.5 2.5 0 0 1 20 10.5v7A2.5 2.5 0 0 1 17.5 20H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12\"/> <path d=\"M16 12h5v4h-5a2 2 0 0 1 0-4z\"/><path d=\"M12 3v8M9 8l3 3 3-3\"/>",
  "expense": "<path d=\"M4 8h13.5A2.5 2.5 0 0 1 20 10.5v7A2.5 2.5 0 0 1 17.5 20H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12\"/> <path d=\"M16 12h5v4h-5a2 2 0 0 1 0-4z\"/><path d=\"M12 11V3M9 6l3-3 3 3\"/>",
  "remaining": "<path d=\"M12 3a9 9 0 1 0 9 9h-9z\"/><path d=\"M14 3.3A8.8 8.8 0 0 1 20.7 10H14z\"/><path d=\"M7 16.5c1.4 1.3 3 2 5 2\"/>",
  "transfer": "<path d=\"M4 8h13l-3-3M17 8l-3 3\"/><path d=\"M20 16H7l3 3M7 16l3-3\"/>",
  "soft-transfer": "<path d=\"m3 10 7-6 7 6\"/><path d=\"M5 8.5V16h10V8.5\"/> <path d=\"M13 17h8v4h-8z\"/><path d=\"M9 13h8M14 10l3 3-3 3\"/>",
  "import": "<path d=\"M4 13h4l1.5 2h5L16 13h4l1 7H3z\"/><path d=\"M12 3v9M9 9l3 3 3-3\"/>",
  "export": "<path d=\"M4 13h4l1.5 2h5L16 13h4l1 7H3z\"/><path d=\"M12 12V3M9 6l3-3 3 3\"/>",
  "review-draft": "<path d=\"M6 3.5h9l3 3V21H6z\"/><path d=\"M15 3.8V7h3\"/> <path d=\"M8.2 14s1.7-2.5 4.3-2.5 4.3 2.5 4.3 2.5-1.7 2.5-4.3 2.5S8.2 14 8.2 14z\"/> <circle cx=\"12.5\" cy=\"14\" r=\"1.2\"/>",
  "bills": "<path d=\"M8 3.5h11v16l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1-1 .6z\"/> <path d=\"M5 6H3v15h10\"/><path d=\"M11 8h5M11 12h5M11 16h3\"/>",
  "due": "<circle cx=\"9\" cy=\"12\" r=\"6\"/><path d=\"M9 8.5V12l2.5 1.5\"/> <path d=\"M17 8.5c.5-.7 1.2-1 2-1 1.1 0 1.8.6 1.8 1.4 0 2.1-4 1.1-4 3.3 0 .9.8 1.5 2 1.5.9 0 1.5-.3 2.1-.9M19 6.5v8.7\"/>",
  "overdue": "<path d=\"M6 3.5h10v16l-2-1.1-2 1.1-2-1.1-2 1.1-2-1.1z\"/><path d=\"M9 8h4M9 12h3\"/> <path d=\"m18 10 4 7h-8z\"/><path d=\"M18 12.8v1.8M18 16.2h.01\"/>",
  "recurring": "<path d=\"M19 8a8 8 0 0 0-13.5-2L3 8.5M5 16a8 8 0 0 0 13.5 2L21 15.5\"/><path d=\"M3 4.5v4h4M21 19.5v-4h-4\"/>",
  "paid": "<path d=\"M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2z\"/> <path d=\"M9 8h6M9 12h4\"/><path d=\"m10 16 1.8 1.8 4-4\"/>",
  "document-scan": "<path d=\"M8 5h8l3 3v11H8z\"/><path d=\"M16 5.5V8h3\"/> <path d=\"M4 8V4h4M16 4h4v4M4 16v4h4M20 16v4h-4\"/> <circle cx=\"13.5\" cy=\"13\" r=\"2.5\"/><path d=\"m11.5 11 1-1h2l1 1\"/>",
  "savings": "<path d=\"M5 13c0-4 3.3-7 8-7 4.5 0 7 2.8 7 6.5 0 2.3-1.1 4-3 5V21h-3v-2H9v2H6v-3.2A5.6 5.6 0 0 1 5 13z\"/> <path d=\"M9 6 7 3M16 7c.8-1.5 2.3-2 4-1.7\"/><circle cx=\"16.5\" cy=\"11\" r=\".8\" fill=\"currentColor\" stroke=\"none\"/><path d=\"M2.5 12H5\"/>",
  "goal": "<circle cx=\"12\" cy=\"12\" r=\"7\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/> <path d=\"M12 2v3M12 19v3M2 12h3M19 12h3\"/> <path d=\"M11 9.5c.4-.5.9-.8 1.6-.8.8 0 1.4.4 1.4 1 0 1.6-3.1.8-3.1 2.5 0 .7.6 1.1 1.5 1.1.7 0 1.2-.2 1.7-.7M12.5 8v6\"/>",
  "registered-account": "<path d=\"m3 9 9-5 9 5z\"/><path d=\"M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 18h16M3 21h18\"/><path d=\"M12 5.2v2.2\"/>",
  "maintenance-fund": "<circle cx=\"17.5\" cy=\"16.5\" r=\"4\"/><path d=\"M17.5 14.5v4M16.2 15.5h2.1\"/> <path d=\"M13.5 4.5a4 4 0 0 0-5 5L3 15l3 3 5.5-5.5a4 4 0 0 0 5-5l-3 3-2-2z\"/>",
  "forecast": "<path d=\"M3 20h18M5 17v-4M10 17V9M15 17V6M20 17V3\"/><path d=\"m5 10 4-3 3 2 7-5\"/>",
  "insights": "<path d=\"M4 20V13M9 20V9M14 20V5M19 20V2.8M2.5 20.5h19\"/>",
  "trends": "<path d=\"m3 18 5-5 3.4 3.3L20 7.5\"/><path d=\"M15 7.5h5v5\"/><path d=\"M3 21h18\"/>",
  "categories": "<rect x=\"3\" y=\"4\" width=\"7\" height=\"6\" rx=\"2\"/><rect x=\"14\" y=\"4\" width=\"7\" height=\"6\" rx=\"2\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"6\" rx=\"2\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"6\" rx=\"2\"/>",
  "budget-health": "<path d=\"M12 20.5 4.5 13A5.2 5.2 0 0 1 12 5.8 5.2 5.2 0 0 1 19.5 13z\"/> <path d=\"M10.5 10.4c.4-.5.9-.8 1.6-.8.9 0 1.5.4 1.5 1 0 1.7-3.2.9-3.2 2.6 0 .7.6 1.2 1.6 1.2.7 0 1.3-.2 1.8-.7M12.1 8.8v6.8\"/>",
  "search": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"m15.5 15.5 5 5\"/>",
  "filter": "<path d=\"M3 4h18l-7 8v6l-4 2v-8z\"/>",
  "sort": "<path d=\"M7 4v16M4 7l3-3 3 3M17 20V4M14 17l3 3 3-3\"/>",
  "edit": "<path d=\"M4 20h4l11-11a2.1 2.1 0 0 0-3-3L5 17z\"/><path d=\"m14 8 3 3M4 20l1-3\"/>",
  "add": "<path d=\"M12 4v16M4 12h16\"/>",
  "delete": "<path d=\"M4 6h16M9 6V3h6v3M7 6l1 15h8l1-15M10 10v7M14 10v7\"/>",
  "share": "<path d=\"M12 16V3M8 7l4-4 4 4\"/><path d=\"M5 12v8h14v-8\"/>",
  "settings": "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1\"/>",
  "profile": "<circle cx=\"12\" cy=\"7\" r=\"3.5\"/><path d=\"M5 21a7 7 0 0 1 14 0\"/>",
  "notifications": "<path d=\"M6 9a6 6 0 0 1 12 0v4.7l2 2.8H4l2-2.8z\"/><path d=\"M9.5 19a2.8 2.8 0 0 0 5 0\"/>",
  "sync": "<path d=\"M19 8a8 8 0 0 0-13.5-2L3 8.5M5 16a8 8 0 0 0 13.5 2L21 15.5\"/><path d=\"M3 4.5v4h4M21 19.5v-4h-4\"/>",
  "complete": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m7.5 12.5 3 3L17 9\"/>",
  "in-progress": "<path d=\"M12 3a9 9 0 0 1 8.3 5.5M21 12a9 9 0 0 1-9 9\"/><path d=\"M12 21a9 9 0 0 1-8.3-5.5M3 12a9 9 0 0 1 9-9\"/>",
  "pending": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7v5l3.5 2\"/>",
  "overdue-status": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 7v6M12 16.5h.01\"/>",
  "skipped": "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"m8 8 8 8M16 8l-8 8\"/>",
  "housing": "<path d=\"m3 11 9-8 9 8\"/><path d=\"M5.5 9.5V21h13V9.5M10 21v-6h4v6\"/>",
  "utilities": "<path d=\"m13 2-6 10h5l-1 10 6-11h-5z\"/><path d=\"M19 4c1 1.4 1.7 2.7 1.7 4.1A2.7 2.7 0 0 1 18 10.8\"/>",
  "food": "<path d=\"M6 3v7M9 3v7M4 7h7M7.5 10v11\"/><path d=\"M16 3v18M16 3c3.5 2.2 4 5.8 0 8\"/>",
  "transport": "<path d=\"m5 16-1 3M19 16l1 3\"/><path d=\"M4 15V10l2-5h12l2 5v5z\"/><path d=\"M6 10h12M7 15h.01M17 15h.01\"/>",
  "health": "<path d=\"M12 20.5 4.5 13A5.2 5.2 0 0 1 12 5.8 5.2 5.2 0 0 1 19.5 13z\"/><path d=\"M12 9v6M9 12h6\"/>",
  "shopping": "<path d=\"M5 8h14l1 13H4z\"/><path d=\"M8 8V6a4 4 0 0 1 8 0v2\"/>",
  "subscriptions": "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"3\"/><path d=\"M3 9h18\"/><path d=\"M8 14a4 4 0 0 1 6.7-2.8M16 11v3h-3M16 15a4 4 0 0 1-6.7 2.8M8 18v-3h3\"/>",
  "debt": "<path d=\"M9.5 7.5 7.3 5.3a3 3 0 0 0-4.2 4.2l3.4 3.4a3 3 0 0 0 4.2 0l1.1-1.1\"/><path d=\"m14.5 16.5 2.2 2.2a3 3 0 0 0 4.2-4.2l-3.4-3.4a3 3 0 0 0-4.2 0l-1.1 1.1\"/><path d=\"m8.5 15.5 7-7\"/>",
  "income-category": "<path d=\"M7 6h8a3 3 0 0 1 3 3v9H6V7a1 1 0 0 1 1-1z\"/><path d=\"M14 12h7M17.5 8.5v7\"/> <path d=\"M9.5 10.2c.4-.5.9-.8 1.6-.8.8 0 1.4.4 1.4 1 0 1.6-3.1.8-3.1 2.5 0 .7.6 1.1 1.5 1.1.7 0 1.2-.2 1.7-.7M11 8v7\"/>",
  "other": "<circle cx=\"6\" cy=\"12\" r=\"1.35\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"12\" cy=\"12\" r=\"1.35\" fill=\"currentColor\" stroke=\"none\"/><circle cx=\"18\" cy=\"12\" r=\"1.35\" fill=\"currentColor\" stroke=\"none\"/>"
};
const STOPS = `<stop offset="0%" stop-color="#5FD49A"/><stop offset="34%" stop-color="#2BB673"/><stop offset="68%" stop-color="#239A61"/><stop offset="100%" stop-color="#1B7A4C"/>`;

export function SymplyBudgetIcon({ name, selected=false, theme='light', size=24, disabled=false, accessibilityLabel }: SymplyBudgetIconProps) {
  const xml = useMemo(() => {
    const inactive = theme === 'dark' ? '#92A6A0' : '#536A63';
    const paint = selected ? 'url(#sbGradient)' : inactive;
    const defs = selected ? `<defs><linearGradient id="sbGradient" x1="5%" y1="5%" x2="95%" y2="95%">${STOPS}</linearGradient></defs>` : '';
    const body = ICONS[name].split('currentColor').join(paint);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${paint}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" opacity="${disabled ? 0.42 : 1}">${defs}${body}</svg>`;
  }, [name, selected, theme, disabled]);
  return <SvgXml xml={xml} width={size} height={size} accessibilityRole="image" accessibilityLabel={accessibilityLabel ?? name} />;
}

export const MiraIcon = (props: Omit<SymplyBudgetIconProps, 'name'>) => <SymplyBudgetIcon name="ai-coach" {...props} />;
