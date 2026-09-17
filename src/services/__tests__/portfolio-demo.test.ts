import {
  isTrustedPortfolioOrigin,
  portfolioDemoCredentialsFromLocation,
  portfolioNavigationMessage,
  requestPortfolioDemo,
  readPortfolioDemoCredentials,
} from '../portfolio-demo';

describe('portfolio demo credentials', () => {
  const parent = {};
  const message = {
    source: parent,
    origin: 'https://andreitekhtelev.dev',
    data: {
      type: 'portfolio:demo-credentials',
      projectId: 'symply-house',
      email: 'guest@house.com',
      password: 'Guest123!',
    },
  };

  it('accepts the production domain and deployment previews', () => {
    expect(isTrustedPortfolioOrigin('https://andreitekhtelev.dev')).toBe(true);
    expect(
      isTrustedPortfolioOrigin(
        'https://abc123.interactive-portfolio-ai-guide.pages.dev'
      )
    ).toBe(true);
  });

  it('returns credentials only from the parent, trusted origin and matching project', () => {
    expect(readPortfolioDemoCredentials(message, 'symply-house', parent)).toEqual({
      email: 'guest@house.com',
      password: 'Guest123!',
    });
    expect(readPortfolioDemoCredentials(message, 'symply-budget', parent)).toBeNull();
    expect(
      readPortfolioDemoCredentials(
        { ...message, origin: 'https://andreitekhtelev.dev.example.com' },
        'symply-house',
        parent
      )
    ).toBeNull();
    expect(readPortfolioDemoCredentials(message, 'symply-house', {})).toBeNull();
  });

  it('provides public guest credentials only for explicit portfolio demo URLs', () => {
    expect(portfolioDemoCredentialsFromLocation('symply-budget', '?portfolioDemo=1')).toEqual({
      email: 'guest@budget.com',
      password: 'Guest123!',
    });
    expect(portfolioDemoCredentialsFromLocation('symply-budget', '')).toBeNull();
  });

  it('creates a minimal navigation event for the guide', () => {
    expect(portfolioNavigationMessage('symply-house', '/projects')).toEqual({
      type: 'portfolio:navigation',
      projectId: 'symply-house',
      pathname: '/projects',
    });
  });

  it('exports a demo-ready request helper', () => {
    expect(requestPortfolioDemo).toEqual(expect.any(Function));
  });
});
