import type {
  ConnectedAPI,
  InitialAPI,
} from "@midnight-ntwrk/dapp-connector-api";

/** Connector API generation this client is written against. */
const SUPPORTED_API_MAJOR = "4.";

export type WalletHandle = {
  readonly name: string;
  readonly api: ConnectedAPI;
  readonly address: string;
  readonly coinPublicKey: string;
  readonly encryptionPublicKey: string;
};

export class WalletError extends Error {}

const candidates = (): InitialAPI[] =>
  Object.values(window.midnight ?? {}).filter(
    (wallet): wallet is InitialAPI =>
      !!wallet &&
      typeof wallet === "object" &&
      "apiVersion" in wallet &&
      typeof wallet.apiVersion === "string",
  );

/**
 * Lace injects itself after the page scripts run, so a wallet that is present
 * can still be missing on first paint. This polls briefly before giving up.
 */
const findWallet = async (timeoutMs = 2_000): Promise<InitialAPI> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = candidates();
    const compatible = found.find((w) =>
      w.apiVersion.startsWith(SUPPORTED_API_MAJOR),
    );
    if (compatible) return compatible;

    if (Date.now() > deadline) {
      if (found.length > 0) {
        throw new WalletError(
          `This wallet speaks connector API ${found[0].apiVersion}; Rung needs ${SUPPORTED_API_MAJOR}x.`,
        );
      }
      throw new WalletError(
        "No Midnight wallet found. Install the Lace extension and reload.",
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const isWalletInstalled = (): boolean => candidates().length > 0;

export const connect = async (networkId: string): Promise<WalletHandle> => {
  const wallet = await findWallet();

  let api: ConnectedAPI;
  try {
    api = await wallet.connect(networkId);
  } catch {
    throw new WalletError(
      "Lace refused the connection. Approve it in the extension and try again.",
    );
  }

  const status = await api.getConnectionStatus();
  if (status.status !== "connected") {
    throw new WalletError("Lace reported the connection as closed. Try again.");
  }
  if (status.networkId !== networkId) {
    throw new WalletError(
      `Lace is on ${status.networkId}; switch it to ${networkId} to use this survey.`,
    );
  }

  const shielded = await api.getShieldedAddresses();
  const unshielded = await api.getUnshieldedAddress();

  return {
    name: wallet.name,
    api,
    address: unshielded.unshieldedAddress,
    coinPublicKey: shielded.shieldedCoinPublicKey,
    encryptionPublicKey: shielded.shieldedEncryptionPublicKey,
  };
};
