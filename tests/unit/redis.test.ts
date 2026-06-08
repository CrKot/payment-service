import { acquireLock, releaseLock, getRedis } from '../../src/lib/redis';

describe('redis distributed lock (TQA-5)', () => {
  afterEach(async () => {
    await getRedis().flushall();
  });

  it('повторный захват занятого лока не проходит', async () => {
    const token = await acquireLock('inv-1', 10);
    expect(token).toBeTruthy();
    expect(await acquireLock('inv-1', 10)).toBeNull();
  });

  it('releaseLock с чужим токеном НЕ снимает лок (атомарная проверка)', async () => {
    const token = await acquireLock('inv-2', 10);
    expect(token).toBeTruthy();

    await releaseLock('inv-2', 'someone-elses-token');
    // лок всё ещё занят — чужой токен не должен был его снять
    expect(await acquireLock('inv-2', 10)).toBeNull();

    // свой токен освобождает
    await releaseLock('inv-2', token as string);
    expect(await acquireLock('inv-2', 10)).toBeTruthy();
  });
});
