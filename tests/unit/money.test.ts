import { computeFee, computeAmountToReceive } from '../../src/lib/money';

describe('money', () => {
  describe('computeFee', () => {
    it('считает 2.5% от 100.00 (10000 минорных) = 250', () => {
      expect(computeFee(10000, 250)).toBe(250);
    });

    it('округляет вниз (floor)', () => {
      // 1001 * 250 / 10000 = 25.025 -> 25
      expect(computeFee(1001, 250)).toBe(25);
    });

    it('feePercent = 0 -> комиссия 0', () => {
      expect(computeFee(99999, 0)).toBe(0);
    });

    it('точен на больших суммах (без потери точности float)', () => {
      // 10_000_000_000_00 минорных (10 млрд денежных) * 1% = 100_000_000_00
      expect(computeFee(1_000_000_000_000, 100)).toBe(10_000_000_000);
    });

    it('бросает на нецелых/отрицательных входах', () => {
      expect(() => computeFee(100.5, 250)).toThrow();
      expect(() => computeFee(-1, 250)).toThrow();
      expect(() => computeFee(100, -5)).toThrow();
    });
  });

  describe('computeAmountToReceive', () => {
    it('amount - fee', () => {
      expect(computeAmountToReceive(10000, 250)).toBe(9750);
    });

    it('бросает, если комиссия больше суммы', () => {
      expect(() => computeAmountToReceive(100, 200)).toThrow();
    });
  });
});
