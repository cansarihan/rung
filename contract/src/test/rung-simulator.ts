import {
  type CircuitContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import {
  Contract,
  type Ledger,
  ledger,
} from "../managed/rung/contract/index.js";
import { type RungPrivateState, witnesses } from "../witnesses.js";

/**
 * Drives the contract off chain. A single instance owns one ledger, and
 * `switchTo` swaps the private state so that several participants can report
 * into the same survey.
 */
export class RungSimulator {
  readonly contract: Contract<RungPrivateState>;
  circuitContext: CircuitContext<RungPrivateState>;

  constructor(
    width: bigint,
    count: bigint,
    nonce: Uint8Array,
    initialParticipant: RungPrivateState,
  ) {
    this.contract = new Contract<RungPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(initialParticipant, "0".repeat(64)),
        width,
        count,
        nonce,
      );
    this.circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState,
      currentContractState,
      currentPrivateState,
    );
  }

  public getLedger(): Ledger {
    return ledger(this.circuitContext.currentQueryContext.state);
  }

  public switchTo(participant: RungPrivateState): void {
    this.circuitContext = {
      ...this.circuitContext,
      currentPrivateState: participant,
    };
  }

  public report(band: bigint): Ledger {
    this.circuitContext = this.contract.impureCircuits.report(
      this.circuitContext,
      band,
    ).context;
    return this.getLedger();
  }
}
