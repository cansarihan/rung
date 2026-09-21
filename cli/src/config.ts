import path from "node:path";
import { fileURLToPath } from "node:url";
import { setNetworkId } from "@midnight-ntwrk/midnight-js/network-id";

const here = path.dirname(fileURLToPath(import.meta.url));

export const zkConfigPath = path.resolve(
  here,
  "..",
  "..",
  "contract",
  "src",
  "managed",
  "rung",
);

export const deploymentDir = path.resolve(here, "..", "..", "deployments");

export const privateStateStoreName = "rung-private-state";
export const privateStateId = "rungPrivateState";

export type NetworkName = "preprod" | "preview";

export type NetworkConfig = {
  readonly name: NetworkName;
  readonly indexer: string;
  readonly indexerWS: string;
  readonly node: string;
  readonly proofServer: string;
  readonly faucet: string;
};

const networks: Record<NetworkName, Omit<NetworkConfig, "proofServer">> = {
  preprod: {
    name: "preprod",
    indexer: "https://indexer.preprod.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.preprod.midnight.network",
    faucet: "https://midnight-tmnight-preprod.nethermind.dev/",
  },
  preview: {
    name: "preview",
    indexer: "https://indexer.preview.midnight.network/api/v4/graphql",
    indexerWS: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
    node: "https://rpc.preview.midnight.network",
    faucet: "https://midnight-tmnight-preview.nethermind.dev/",
  },
};

const isNetworkName = (value: string): value is NetworkName =>
  value === "preprod" || value === "preview";

/**
 * Resolves the target network and registers it with midnight-js. Every address
 * encoding in the process depends on this, so it has to run before any wallet
 * or provider is built.
 */
export const selectNetwork = (): NetworkConfig => {
  const requested = process.env.RUNG_NETWORK ?? "preprod";
  if (!isNetworkName(requested)) {
    throw new Error(
      `Unknown network "${requested}". Use preprod or preview.`,
    );
  }

  const base = networks[requested];
  setNetworkId(requested);

  return {
    ...base,
    indexer: process.env.RUNG_INDEXER ?? base.indexer,
    indexerWS: process.env.RUNG_INDEXER_WS ?? base.indexerWS,
    node: process.env.RUNG_NODE ?? base.node,
    proofServer: process.env.RUNG_PROOF_SERVER ?? "http://127.0.0.1:6300",
  };
};

/** Band scale a freshly deployed survey is created with. */
export const surveyScale = () => ({
  width: BigInt(process.env.RUNG_BAND_WIDTH ?? 10_000),
  count: BigInt(process.env.RUNG_BAND_COUNT ?? 12),
  currency: process.env.RUNG_CURRENCY ?? "$",
});
