/**
 * Setup for the scale phases. Runs before any phase imports projection.ts.
 * See lib/dev-global.ts for why `__DEV__` is true rather than false.
 */
import { enableDevAssertions } from './lib/dev-global';

enableDevAssertions();
