import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export type Witnesses<PS> = {
  participantSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  reportedCompensation(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
}

export type ImpureCircuits<PS> = {
  report(context: __compactRuntime.CircuitContext<PS>, band_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  report(context: __compactRuntime.CircuitContext<PS>, band_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  bandFloor(width_0: bigint, band_0: bigint): bigint;
  participantTag(secret_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  bandFloor(context: __compactRuntime.CircuitContext<PS>,
            width_0: bigint,
            band_0: bigint): __compactRuntime.CircuitResults<PS, bigint>;
  participantTag(context: __compactRuntime.CircuitContext<PS>,
                 secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  report(context: __compactRuntime.CircuitContext<PS>, band_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  readonly bandWidth: bigint;
  readonly bandCount: bigint;
  bandTotals: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): { read(): bigint }
  };
  spentTags: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  readonly reportCount: bigint;
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               width_0: bigint,
               count_0: bigint): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
