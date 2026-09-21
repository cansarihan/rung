import { CompiledContract, type ProvableCircuitId } from "@midnight-ntwrk/compact-js";
import type { ContractAddress } from "@midnight-ntwrk/compact-runtime";
import {
  Transaction,
  type Binding,
  type Proof,
  type SignatureEnabled,
} from "@midnight-ntwrk/ledger-v8";
import {
  findDeployedContract,
  type FoundContract,
} from "@midnight-ntwrk/midnight-js/contracts";
import { fromHex, toHex } from "@midnight-ntwrk/midnight-js/utils";
import {
  createProofProvider,
  type MidnightProviders,
} from "@midnight-ntwrk/midnight-js/types";
import { FetchZkConfigProvider } from "@midnight-ntwrk/midnight-js-fetch-zk-config-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { Rung, witnesses, type RungPrivateState } from "@rung/contract";
import type { WalletHandle } from "./lace";
import { inMemoryPrivateState } from "./private-state";

export const PRIVATE_STATE_ID = "rungPrivateState";

export type RungContract = Rung.Contract<RungPrivateState>;
export type RungCircuits = ProvableCircuitId<RungContract>;
export type RungProviders = MidnightProviders<
  RungCircuits,
  typeof PRIVATE_STATE_ID,
  RungPrivateState
>;

const compiled = CompiledContract.make<RungContract>("rung", Rung.Contract).pipe(
  CompiledContract.withWitnesses(witnesses),
  // The circuits and keys are served from this site, next to the bundle.
  CompiledContract.withCompiledFileAssets(window.location.origin),
);

export type SurveyState = {
  readonly bandWidth: bigint;
  readonly bandCount: bigint;
  readonly surveyNonce: Uint8Array;
  readonly reportCount: bigint;
  readonly totals: ReadonlyMap<bigint, bigint>;
};

const readLedger = (data: Parameters<typeof Rung.ledger>[0]): SurveyState => {
  const state = Rung.ledger(data);
  const totals = new Map<bigint, bigint>();
  for (let band = 0n; band < state.bandCount; band += 1n) {
    totals.set(
      band,
      state.bandTotals.member(band) ? state.bandTotals.lookup(band).read() : 0n,
    );
  }
  return {
    bandWidth: state.bandWidth,
    bandCount: state.bandCount,
    surveyNonce: state.surveyNonce,
    reportCount: state.reportCount,
    totals,
  };
};

/**
 * Reads public state straight from the indexer. No wallet, no keys.
 *
 * The first state comes from a plain query so the page has something to draw
 * immediately even where the subscription socket is blocked; the subscription
 * then keeps it current as reports arrive.
 */
export const watchSurvey = (
  indexer: string,
  indexerWs: string,
  address: ContractAddress,
  onState: (state: SurveyState) => void,
  onError: (message: string) => void,
): (() => void) => {
  const provider = indexerPublicDataProvider(indexer, indexerWs);
  let live = true;

  provider
    .queryContractState(address)
    .then((contractState) => {
      if (!live) return;
      if (contractState === null) {
        onError(`No survey is deployed at ${address.slice(0, 12)}… on this network.`);
        return;
      }
      onState(readLedger(contractState.data));
    })
    .catch((error: unknown) =>
      onError(error instanceof Error ? error.message : String(error)),
    );

  const subscription = provider
    .contractStateObservable(address, { type: "latest" })
    .subscribe({
      next: (contractState) => live && onState(readLedger(contractState.data)),
      error: () => {
        /* The query above already populated the page; updates stop here. */
      },
    });

  return () => {
    live = false;
    subscription.unsubscribe();
  };
};

export const buildProviders = async (
  wallet: WalletHandle,
): Promise<RungProviders> => {
  const config = await wallet.api.getConfiguration();
  const zkConfigProvider = new FetchZkConfigProvider<RungCircuits>(
    window.location.origin,
    fetch.bind(window),
  );

  // Lace either points at a proof server or proves in the wallet itself. The
  // deprecated URI is tried first because wallets that still expose it have
  // not necessarily implemented the newer path.
  const proofProvider = config.proverServerUri
    ? httpClientProofProvider(config.proverServerUri, zkConfigProvider)
    : createProofProvider(await wallet.api.getProvingProvider(zkConfigProvider));

  return {
    privateStateProvider: inMemoryPrivateState(),
    publicDataProvider: indexerPublicDataProvider(
      config.indexerUri,
      config.indexerWsUri,
    ),
    zkConfigProvider,
    proofProvider,
    walletProvider: {
      getCoinPublicKey: () => wallet.coinPublicKey,
      getEncryptionPublicKey: () => wallet.encryptionPublicKey,
      balanceTx: async (tx) => {
        const balanced = await wallet.api.balanceUnsealedTransaction(
          toHex(tx.serialize()),
        );
        return Transaction.deserialize<SignatureEnabled, Proof, Binding>(
          "signature",
          "proof",
          "binding",
          fromHex(balanced.tx),
        );
      },
    },
    midnightProvider: {
      submitTx: async (tx) => {
        await wallet.api.submitTransaction(toHex(tx.serialize()));
        return tx.identifiers()[0];
      },
    },
  };
};

export const joinSurvey = (
  providers: RungProviders,
  contractAddress: ContractAddress,
  initialPrivateState: RungPrivateState,
): Promise<FoundContract<RungContract>> =>
  findDeployedContract(providers, {
    contractAddress,
    compiledContract: compiled,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });

export const report = async (
  survey: FoundContract<RungContract>,
  band: bigint,
): Promise<{ txId: string; blockHeight: number }> => {
  const finalized = await survey.callTx.report(band);
  return {
    txId: finalized.public.txId,
    blockHeight: Number(finalized.public.blockHeight),
  };
};
