type Network = "preview" | "preprod";

const network = (import.meta.env.VITE_NETWORK_ID ?? "preview") as Network;

const indexers: Record<Network, { http: string; ws: string }> = {
  preview: {
    http: "https://indexer.preview.midnight.network/api/v4/graphql",
    ws: "wss://indexer.preview.midnight.network/api/v4/graphql/ws",
  },
  preprod: {
    http: "https://indexer.preprod.midnight.network/api/v4/graphql",
    ws: "wss://indexer.preprod.midnight.network/api/v4/graphql/ws",
  },
};

/** Surveys this client knows about, so a clone runs with no configuration. */
const deployed: Record<Network, string> = {
  preview: "a563d76997b5fe6882602b0b7a772b6eca4dd2a9aff07a0492239bba2345d4c6",
  preprod: "",
};

export const config = {
  network,
  contractAddress:
    import.meta.env.VITE_CONTRACT_ADDRESS ?? deployed[network],
  /**
   * Used only to read public state before a wallet is connected. Once Lace is
   * connected the client uses the indexer the wallet itself reports, so the two
   * always agree on which chain is being read.
   */
  indexer: import.meta.env.VITE_INDEXER ?? indexers[network].http,
  indexerWs: import.meta.env.VITE_INDEXER_WS ?? indexers[network].ws,
  currency: import.meta.env.VITE_CURRENCY ?? "$",
} as const;
