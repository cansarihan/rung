import type {
  ContractAddress,
  SigningKey,
} from "@midnight-ntwrk/midnight-js-protocol/compact-runtime";
import type {
  PrivateStateId,
  PrivateStateProvider,
} from "@midnight-ntwrk/midnight-js-types";

const unsupported = (what: string) => (): never => {
  throw new Error(
    `${what} is not available in the browser client: private state lives in memory for one session only.`,
  );
};

/**
 * Keeps private state in memory for the lifetime of the tab. Nothing a
 * participant types is written to disk, and a reload starts clean.
 */
export const inMemoryPrivateState = <
  PSI extends PrivateStateId,
  PS = unknown,
>(): PrivateStateProvider<PSI, PS> => {
  const states = new Map<ContractAddress, Map<PSI, PS>>();
  const signingKeys = new Map<ContractAddress, SigningKey>();
  let current: ContractAddress | null = null;

  const scope = (): Map<PSI, PS> => {
    if (current === null) {
      throw new Error("setContractAddress must be called before private state is used.");
    }
    let scoped = states.get(current);
    if (!scoped) {
      scoped = new Map<PSI, PS>();
      states.set(current, scoped);
    }
    return scoped;
  };

  return {
    setContractAddress(address: ContractAddress): void {
      current = address;
    },
    async set(id: PSI, state: PS): Promise<void> {
      scope().set(id, state);
    },
    async get(id: PSI): Promise<PS | null> {
      return scope().get(id) ?? null;
    },
    async remove(id: PSI): Promise<void> {
      scope().delete(id);
    },
    async clear(): Promise<void> {
      states.clear();
    },
    async setSigningKey(address: ContractAddress, key: SigningKey): Promise<void> {
      signingKeys.set(address, key);
    },
    async getSigningKey(address: ContractAddress): Promise<SigningKey | null> {
      return signingKeys.get(address) ?? null;
    },
    async removeSigningKey(address: ContractAddress): Promise<void> {
      signingKeys.delete(address);
    },
    async clearSigningKeys(): Promise<void> {
      signingKeys.clear();
    },
    exportPrivateStates: unsupported("Exporting private state"),
    importPrivateStates: unsupported("Importing private state"),
    exportSigningKeys: unsupported("Exporting signing keys"),
    importSigningKeys: unsupported("Importing signing keys"),
  };
};

const SECRET_KEY = "rung:secret:v1";

/**
 * The report tag is `hash(surveyNonce, secret)`, so the secret has to be
 * something only the participant holds. Deriving it from a public key would
 * let anyone recompute a tag and check it against the ledger, which would undo
 * the anonymity the tag is there to provide.
 *
 * The secret is random, kept per wallet address, and never sent anywhere.
 * Clearing site data forgets it, which means the contract would accept a second
 * report from the same person: uniqueness here is per secret, not per human.
 */
export const participantSecret = (walletAddress: string): Uint8Array => {
  const key = `${SECRET_KEY}:${walletAddress}`;
  const stored = localStorage.getItem(key);
  if (stored) {
    return Uint8Array.from(stored.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  }

  const secret = crypto.getRandomValues(new Uint8Array(32));
  localStorage.setItem(
    key,
    Array.from(secret, (b) => b.toString(16).padStart(2, "0")).join(""),
  );
  return secret;
};

export const forgetSecret = (walletAddress: string): void =>
  localStorage.removeItem(`${SECRET_KEY}:${walletAddress}`);
