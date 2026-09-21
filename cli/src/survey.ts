import { CompiledContract, type ProvableCircuitId } from "@midnight-ntwrk/compact-js";
import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import {
  deployContract,
  findDeployedContract,
  type DeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js/contracts";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js/types";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { Buffer } from "node:buffer";
import { Rung, witnesses, type RungPrivateState } from "@rung/contract";
import {
  privateStateId,
  privateStateStoreName,
  zkConfigPath,
  type NetworkConfig,
} from "./config.js";
import { walletProvider, type Wallet } from "./wallet.js";

export type RungContract = Rung.Contract<RungPrivateState>;
export type RungCircuits = ProvableCircuitId<RungContract>;
export type RungProviders = MidnightProviders<
  RungCircuits,
  typeof privateStateId,
  RungPrivateState
>;
export type Survey = DeployedContract<RungContract> | FoundContract<RungContract>;

const compiled = CompiledContract.make<RungContract>("rung", Rung.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

export const createProviders = async (
  wallet: Wallet,
  config: NetworkConfig,
): Promise<RungProviders> => {
  const provider = await walletProvider(wallet);
  const zkConfigProvider = new NodeZkConfigProvider<RungCircuits>(zkConfigPath);

  // The private state store is keyed by the wallet that owns it and encrypted
  // with a password derived from the same key, so two wallets on one machine
  // never read each other's secrets.
  const accountId = provider.getCoinPublicKey();
  const password = `${Buffer.from(accountId, "hex").toString("base64")}!`;

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName,
      accountId,
      privateStoragePasswordProvider: () => password,
    }),
    publicDataProvider: indexerPublicDataProvider(config.indexer, config.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(config.proofServer, zkConfigProvider),
    walletProvider: provider,
    midnightProvider: provider,
  };
};

export const deploySurvey = (
  providers: RungProviders,
  initialPrivateState: RungPrivateState,
  width: bigint,
  count: bigint,
): Promise<Survey> =>
  deployContract(providers, {
    compiledContract: compiled,
    privateStateId,
    initialPrivateState,
    args: [width, count],
  });

export const joinSurvey = (
  providers: RungProviders,
  contractAddress: ContractAddress,
  initialPrivateState: RungPrivateState,
): Promise<Survey> =>
  findDeployedContract(providers, {
    contractAddress,
    compiledContract: compiled,
    privateStateId,
    initialPrivateState,
  });

export type SurveyState = {
  readonly bandWidth: bigint;
  readonly bandCount: bigint;
  readonly reportCount: bigint;
  /** Report count per band index, including bands nobody reported into. */
  readonly totals: ReadonlyMap<bigint, bigint>;
};

export const readSurvey = async (
  providers: RungProviders,
  contractAddress: ContractAddress,
): Promise<SurveyState | null> => {
  const contractState = await providers.publicDataProvider.queryContractState(
    contractAddress,
  );
  if (contractState === null) return null;

  const state = Rung.ledger(contractState.data);
  const totals = new Map<bigint, bigint>();
  for (let band = 0n; band < state.bandCount; band += 1n) {
    totals.set(band, state.bandTotals.member(band) ? state.bandTotals.lookup(band).read() : 0n);
  }

  return {
    bandWidth: state.bandWidth,
    bandCount: state.bandCount,
    reportCount: state.reportCount,
    totals,
  };
};

export const submitReport = async (survey: Survey, band: bigint) => {
  const finalized = await survey.callTx.report(band);
  return finalized.public;
};
