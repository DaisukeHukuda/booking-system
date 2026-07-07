import { describe, it, expect } from 'vitest';
import { signSession, verifySession, passwordMatches } from '../src/auth/session';

const SECRET = 'test-secret';

describe('session', () => {
  it('署名したトークンは検証に通る', async () => {
    const token = await signSession(SECRET, Date.now() + 60_000);
    expect(await verifySession(SECRET, token)).toBe(true);
  });

  it('期限切れトークンは無効', async () => {
    const token = await signSession(SECRET, Date.now() - 1_000);
    expect(await verifySession(SECRET, token)).toBe(false);
  });

  it('改ざんされたトークンは無効', async () => {
    const token = await signSession(SECRET, Date.now() + 60_000);
    const [exp, sig] = token.split('.');
    const forged = `${Number(exp) + 999_999_999}.${sig}`;
    expect(await verifySession(SECRET, forged)).toBe(false);
  });

  it('別のシークレットで署名されたトークンは無効', async () => {
    const token = await signSession('other-secret', Date.now() + 60_000);
    expect(await verifySession(SECRET, token)).toBe(false);
  });

  it('undefined・不正形式は無効', async () => {
    expect(await verifySession(SECRET, undefined)).toBe(false);
    expect(await verifySession(SECRET, 'garbage')).toBe(false);
    expect(await verifySession(SECRET, '123.')).toBe(false);
  });

  it('passwordMatches はパスワードの一致を判定する', async () => {
    expect(await passwordMatches(SECRET, 'abc', 'abc')).toBe(true);
    expect(await passwordMatches(SECRET, 'abc', 'abd')).toBe(false);
  });
});
