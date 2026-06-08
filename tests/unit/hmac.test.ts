import { sign, verify } from '../../src/lib/hmac';

const secret = 'test-secret';

describe('hmac', () => {
  it('подпись детерминирована для одного тела', () => {
    const body = JSON.stringify({ invoiceId: 'abc', status: 'paid' });
    expect(sign(body, secret)).toBe(sign(body, secret));
  });

  it('verify = true для корректной подписи', () => {
    const body = JSON.stringify({ invoiceId: 'abc', status: 'paid' });
    expect(verify(body, secret, sign(body, secret))).toBe(true);
  });

  it('verify = false при изменённом теле', () => {
    const body = JSON.stringify({ invoiceId: 'abc', status: 'paid' });
    const signature = sign(body, secret);
    const tampered = JSON.stringify({ invoiceId: 'abc', status: 'failed' });
    expect(verify(tampered, secret, signature)).toBe(false);
  });

  it('verify = false при чужом секрете', () => {
    const body = 'payload';
    expect(verify(body, secret, sign(body, 'other-secret'))).toBe(false);
  });

  it('verify = false при отсутствующей подписи', () => {
    expect(verify('payload', secret, undefined)).toBe(false);
  });
});
