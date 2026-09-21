import { Buffer } from "node:buffer";
import * as ledger from "@midnight-ntwrk/ledger-v8";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v8";
import { getNetworkId } from "@midnight-ntwrk/midnight-js/network-id";
import type {
  MidnightProvider,
  WalletProvider,
} from "@midnight-ntwrk/midnight-js/types";
import {
  MidnightBech32m,
  ShieldedAddress,
  ShieldedCoinPublicKey,
  ShieldedEncryptionPublicKey,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { HDWallet, Roles, generateRandomSeed } from "@midnight-ntwrk/wallet-sdk-hd";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
  type UnshieldedKeystore,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import * as Rx from "rxjs";
import { WebSocket } from "ws";
import type { NetworkConfig } from "./config.js";
import { amount, field, heading, note, step } from "./console.js";

// The indexer subscription transport resolves WebSocket off the global scope.
globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;

export type Wallet = {
  readonly facade: WalletFacade;
  readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
  readonly dustSecretKey: ledger.DustSecretKey;
  readonly keystore: UnshieldedKeystore;
};

export const newSeed = (): string =>
  Buffer.from(generateRandomSeed()).toString("hex");

const deriveKeys = (seed: string) => {
  const hd = HDWallet.fromSeed(Buffer.from(seed, "hex"));
  if (hd.type !== "seedOk") {
    throw new Error("RUNG_WALLET_SEED is not a valid 32 byte hex seed");
  }

  const derived = hd.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);
  hd.hdWallet.clear();

  if (derived.type !== "keysDerived") {
    throw new Error("Could not derive the Zswap, Night and Dust keys");
  }
  return derived.keys;
};

const syncedState = (facade: WalletFacade) =>
  Rx.firstValueFrom(facade.state().pipe(Rx.filter((state) => state.isSynced)));

const nightBalance = (state: { unshielded: { balances: Record<string, bigint> } }) =>
  state.unshielded.balances[unshieldedToken().raw] ?? 0n;

/**
 * Signs the unshielded inputs of every intent in a transaction.
 *
 * The facade's own `signRecipe` always deserialises intents with the
 * `pre-proof` marker, which rejects an already proven transaction. Signing
 * here lets the caller pass the marker that matches the transaction at hand.
 */
const signIntents = (
  tx: { intents?: Map<number, ledger.Intent<ledger.SignatureEnabled, ledger.Proofish, ledger.PreBinding>> },
  sign: (payload: Uint8Array) => ledger.Signature,
  marker: "proof" | "pre-proof",
): void => {
  for (const segment of tx.intents?.keys() ?? []) {
    const intent = tx.intents?.get(segment);
    if (!intent) continue;

    const clone = ledger.Intent.deserialize<
      ledger.SignatureEnabled,
      ledger.Proofish,
      ledger.PreBinding
    >("signature", marker, "pre-binding", intent.serialize());

    const signature = sign(clone.signatureData(segment));
    for (const offer of [clone.guaranteedUnshieldedOffer, clone.fallibleUnshieldedOffer]) {
      if (!offer) continue;
      const signatures = offer.inputs.map(
        (_: ledger.UtxoSpend, index: number) => offer.signatures.at(index) ?? signature,
      );
      if (offer === clone.guaranteedUnshieldedOffer) {
        clone.guaranteedUnshieldedOffer = offer.addSignatures(signatures);
      } else {
        clone.fallibleUnshieldedOffer = offer.addSignatures(signatures);
      }
    }

    tx.intents?.set(segment, clone);
  }
};

/**
 * NIGHT held on Preprod does not pay fees on its own. Each UTXO has to be
 * designated for DUST generation once, after which DUST accrues over time.
 */
const ensureDust = async (wallet: Wallet): Promise<void> => {
  const state = await syncedState(wallet.facade);
  if (state.dust.balance(new Date()) > 0n) {
    field("Dust", `${amount(state.dust.balance(new Date()))} available`);
    return;
  }

  const undesignated = state.unshielded.availableCoins.filter(
    (coin) => coin.meta?.registeredForDustGeneration !== true,
  );

  if (undesignated.length > 0) {
    await step(`Registering ${undesignated.length} NIGHT output(s) for dust`, async () => {
      const recipe = await wallet.facade.registerNightUtxosForDustGeneration(
        undesignated,
        wallet.keystore.getPublicKey(),
        (payload) => wallet.keystore.signData(payload),
      );
      await wallet.facade.submitTransaction(await wallet.facade.finalizeRecipe(recipe));
    });
  }

  await step("Waiting for dust to accrue", () =>
    Rx.firstValueFrom(
      wallet.facade.state().pipe(
        Rx.throttleTime(5_000),
        Rx.filter((s) => s.isSynced && s.dust.balance(new Date()) > 0n),
      ),
    ),
  );
};

/** Builds the wallet, funds it if needed, and leaves it able to pay fees. */
export const openWallet = async (
  config: NetworkConfig,
  seed: string,
): Promise<Wallet> => {
  const shared = {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: config.indexer,
      indexerWsUrl: config.indexerWS,
    },
    provingServerUrl: new URL(config.proofServer),
    relayURL: new URL(config.node.replace(/^http/, "ws")),
  };

  const wallet = await step("Opening wallet", async () => {
    const keys = deriveKeys(seed);
    const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
    const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
    const keystore = createKeystore(keys[Roles.NightExternal], getNetworkId());

    const facade = await WalletFacade.init({
      configuration: {
        ...shared,
        txHistoryStorage: new InMemoryTransactionHistoryStorage(),
        costParameters: {
          additionalFeeOverhead: 300_000_000_000_000n,
          feeBlocksMargin: 5,
        },
      },
      shielded: (cfg) => ShieldedWallet(cfg).startWithSecretKeys(shieldedSecretKeys),
      unshielded: (cfg) =>
        UnshieldedWallet(cfg).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
      dust: (cfg) =>
        DustWallet(cfg).startWithSecretKey(
          dustSecretKey,
          ledger.LedgerParameters.initialParameters().dust,
        ),
    });
    await facade.start(shieldedSecretKeys, dustSecretKey);

    return { facade, shieldedSecretKeys, dustSecretKey, keystore };
  });

  field("Address", wallet.keystore.getBech32Address().toString());

  const state = await step("Syncing with the indexer", () => syncedState(wallet.facade));

  if (nightBalance(state) === 0n) {
    note(`Fund the address above from ${config.faucet} to continue.`);
    const funded = await step("Waiting for funds", () =>
      Rx.firstValueFrom(
        wallet.facade.state().pipe(
          Rx.throttleTime(10_000),
          Rx.filter((s) => s.isSynced),
          Rx.map(nightBalance),
          Rx.filter((balance) => balance > 0n),
        ),
      ),
    );
    field("Balance", `${amount(funded)} tNIGHT`);
  } else {
    field("Balance", `${amount(nightBalance(state))} tNIGHT`);
  }

  await ensureDust(wallet);
  return wallet;
};

export const describeWallet = async (wallet: Wallet): Promise<void> => {
  const state = await syncedState(wallet.facade);
  const networkId = getNetworkId();
  const shielded = MidnightBech32m.encode(
    networkId,
    new ShieldedAddress(
      ShieldedCoinPublicKey.fromHexString(state.shielded.coinPublicKey.toHexString()),
      ShieldedEncryptionPublicKey.fromHexString(
        state.shielded.encryptionPublicKey.toHexString(),
      ),
    ),
  ).toString();

  heading("Wallet", `network: ${networkId}`);
  field("Unshielded", wallet.keystore.getBech32Address().toString());
  field("Shielded", shielded);
  field("Night", `${amount(nightBalance(state))} tNIGHT`);
  field("Dust", amount(state.dust.balance(new Date())));
};

/** Bridges the wallet facade to the provider interface midnight-js expects. */
export const walletProvider = async (
  wallet: Wallet,
): Promise<WalletProvider & MidnightProvider> => {
  const state = await syncedState(wallet.facade);

  return {
    getCoinPublicKey: () => state.shielded.coinPublicKey.toHexString(),
    getEncryptionPublicKey: () => state.shielded.encryptionPublicKey.toHexString(),
    async balanceTx(tx, ttl) {
      const recipe = await wallet.facade.balanceUnboundTransaction(
        tx,
        {
          shieldedSecretKeys: wallet.shieldedSecretKeys,
          dustSecretKey: wallet.dustSecretKey,
        },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );

      const sign = (payload: Uint8Array) => wallet.keystore.signData(payload);
      signIntents(recipe.baseTransaction, sign, "proof");
      if (recipe.balancingTransaction) {
        signIntents(recipe.balancingTransaction, sign, "pre-proof");
      }

      return wallet.facade.finalizeRecipe(recipe);
    },
    submitTx: (tx) => wallet.facade.submitTransaction(tx),
  };
};
