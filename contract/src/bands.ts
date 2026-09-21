/**
 * Band arithmetic shared by the client and the tests. The contract enforces
 * the same boundaries inside the circuit, so a client that uses these helpers
 * produces a report the contract will accept.
 */

export type Band = {
  readonly index: bigint;
  readonly floor: bigint;
  /** Absent for the highest band, which is open ended. */
  readonly ceiling: bigint | null;
};

export const bandOf = (
  compensation: bigint,
  width: bigint,
  count: bigint,
): bigint => {
  const index = compensation / width;
  const top = count - 1n;
  return index > top ? top : index;
};

export const bandAt = (index: bigint, width: bigint, count: bigint): Band => ({
  index,
  floor: index * width,
  ceiling: index === count - 1n ? null : (index + 1n) * width,
});

export const allBands = (width: bigint, count: bigint): Band[] =>
  Array.from({ length: Number(count) }, (_, i) => bandAt(BigInt(i), width, count));

export const formatBand = (band: Band, currency: string): string => {
  const amount = (value: bigint) => `${currency}${value.toLocaleString("en-US")}`;
  return band.ceiling === null
    ? `${amount(band.floor)} and above`
    : `${amount(band.floor)} to ${amount(band.ceiling - 1n)}`;
};
