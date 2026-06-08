/**
 * Денежная арифметика.
 *
 * Все суммы — целые числа в МИНОРНЫХ единицах валюты (копейки/центы).
 * Никаких float: умножение и деление считаем через BigInt, чтобы не терять
 * точность даже на больших суммах (> 2^53).
 *
 * feePercent хранится в БАЗИСНЫХ ПУНКТАХ (basis points): 1 bps = 0.01%.
 *   2.5%  -> 250 bps
 *   1%    -> 100 bps
 *   0.05% -> 5 bps
 *
 * Округление комиссии — ВНИЗ (floor). Правило зафиксировано и одинаково
 * для всех расчётов; см. README → «Принятые допущения».
 */

const BPS_DENOMINATOR = 10000n;

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (minor units), got: ${value}`);
  }
}

/** Комиссия = floor(amount * feePercentBps / 10000), в минорных единицах. */
export function computeFee(amountMinor: number, feePercentBps: number): number {
  assertNonNegativeInt(amountMinor, 'amount');
  assertNonNegativeInt(feePercentBps, 'feePercentBps');

  const fee = (BigInt(amountMinor) * BigInt(feePercentBps)) / BPS_DENOMINATOR;
  return Number(fee);
}

/** Сумма к зачислению = amount - fee. */
export function computeAmountToReceive(amountMinor: number, feeMinor: number): number {
  assertNonNegativeInt(amountMinor, 'amount');
  assertNonNegativeInt(feeMinor, 'fee');
  if (feeMinor > amountMinor) {
    throw new Error('fee cannot exceed amount');
  }
  return amountMinor - feeMinor;
}
