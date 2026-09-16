/**
 * Health migrate must refuse while 0092 exists in shared migrations/.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

describe('Health 0092 migrate gate', () => {
  it('exits non-zero when 0092 is present and HEALTH_ALLOW_0092 unset', () => {
    const root = path.resolve(__dirname, '../../..');
    const script = path.join(root, 'backend/scripts/refuse-health-0092.sh');
    expect(fs.existsSync(script)).toBe(true);
    expect(fs.existsSync(path.join(root, 'backend/migrations'))).toBe(true);

    let code = 0;
    let stderr = '';
    try {
      execFileSync('bash', [script, 'staging'], {
        cwd: root,
        env: { ...process.env, HEALTH_ALLOW_0092: '' },
        encoding: 'utf8',
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: string };
      code = e.status ?? 1;
      stderr = e.stderr ?? '';
    }
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/0092|Health D1 migrate blocked/i);
  });
});
