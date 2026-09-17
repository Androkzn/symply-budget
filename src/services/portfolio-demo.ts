export type PortfolioDemoCredentials = {
  email: string;
  password: string;
};

const portfolioGuestCredentials: Record<string, PortfolioDemoCredentials> = {
  'symply-house': { email: 'guest@house.com', password: 'Guest123!' },
  'symply-budget': { email: 'guest@budget.com', password: 'Guest123!' },
};

type PortfolioDemoMessage = PortfolioDemoCredentials & {
  type: 'portfolio:demo-credentials';
  projectId: string;
};

type PortfolioMessageEvent = {
  data: unknown;
  origin: string;
  source: unknown;
};

const trustedPortfolioOrigins = new Set([
  'https://andreitekhtelev.dev',
  'https://www.andreitekhtelev.dev',
  'https://interactive-portfolio-ai-guide.pages.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);
type PortfolioWindow = {
  parent: PortfolioWindow;
  postMessage(message: unknown, targetOrigin: string): void;
};
declare const window: PortfolioWindow;
declare const document: { referrer?: string };

export function isTrustedPortfolioOrigin(origin: string): boolean {
  if (trustedPortfolioOrigins.has(origin)) return true;
  return /^https:\/\/(?:[a-z0-9-]+\.)?interactive-portfolio-ai-guide\.pages\.dev$/.test(origin)
    || /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin);
}

export function portfolioDemoCredentialsFromLocation(
  projectId: string,
  search: string
): PortfolioDemoCredentials | null {
  if (!/(?:^|[?&])portfolioDemo=1(?:&|$)/.test(search)) return null;
  return portfolioGuestCredentials[projectId] ?? null;
}

function portfolioParentOrigin(): string {
  const referrer = typeof document !== 'undefined' ? document.referrer ?? '' : '';
  return referrer.match(/^https?:\/\/[^/]+/)?.[0] ?? '*';
}

/** Ask the embedded portfolio host to replay demo credentials immediately. */
export function requestPortfolioDemo(projectId: string): void {
  if (
    typeof window === 'undefined' ||
    !window.parent?.postMessage ||
    window.parent === window
  ) {
    return;
  }
  window.parent.postMessage({ type: 'portfolio:demo-ready', projectId }, portfolioParentOrigin());
}

export function readPortfolioDemoCredentials(
  event: PortfolioMessageEvent,
  expectedProjectId: string,
  parentWindow: unknown
): PortfolioDemoCredentials | null {
  if (!parentWindow || event.source !== parentWindow || !isTrustedPortfolioOrigin(event.origin)) {
    return null;
  }
  if (!event.data || typeof event.data !== 'object') return null;
  const message = event.data as Partial<PortfolioDemoMessage>;
  if (
    message.type !== 'portfolio:demo-credentials' ||
    message.projectId !== expectedProjectId ||
    typeof message.email !== 'string' ||
    typeof message.password !== 'string'
  ) {
    return null;
  }
  return { email: message.email, password: message.password };
}

export function portfolioNavigationMessage(projectId: string, pathname: string) {
  return {
    type: 'portfolio:navigation' as const,
    projectId,
    pathname,
  };
}

export function notifyPortfolioNavigation(projectId: string, pathname: string): void {
  if (
    typeof window === 'undefined' ||
    !window.parent?.postMessage ||
    window.parent === window
  ) {
    return;
  }
  window.parent.postMessage(portfolioNavigationMessage(projectId, pathname), portfolioParentOrigin());
}
