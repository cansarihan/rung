import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Ledger } from "./managed/rung/contract/index.js";

/**
 * Everything a participant keeps to themselves. Neither field is ever written
 * to the ledger; the circuit only proves statements about them.
 */
export type RungPrivateState = {
  /** Long lived secret that derives the participant's one-time report tag. */
  readonly secret: Uint8Array;
  /** Annual gross pay, in the same whole currency units as the band width. */
  readonly compensation: bigint;
};

export const createPrivateState = (
  secret: Uint8Array,
  compensation: bigint,
): RungPrivateState => ({ secret, compensation });

export const witnesses = {
  participantSecret: ({
    privateState,
  }: WitnessContext<Ledger, RungPrivateState>): [
    RungPrivateState,
    Uint8Array,
  ] => [privateState, privateState.secret],

  reportedCompensation: ({
    privateState,
  }: WitnessContext<Ledger, RungPrivateState>): [RungPrivateState, bigint] => [
    privateState,
    privateState.compensation,
  ],
};
