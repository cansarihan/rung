import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { allBands, bandOf, formatBand, type RungPrivateState } from "@rung/contract";
import {
  deploymentDir,
  selectNetwork,
  surveyScale,
  type NetworkConfig,
} from "./config.js";
import { amount, field, heading, note, rule, step } from "./console.js";
import {
  createProviders,
  deploySurvey,
  joinSurvey,
  readSurvey,
  submitReport,
  type RungProviders,
  type SurveyState,
} from "./survey.js";
import { describeWallet, newSeed, openWallet } from "./wallet.js";

type Deployment = {
  readonly network: string;
  readonly address: string;
  readonly bandWidth: string;
  readonly bandCount: string;
  readonly surveyNonce: string;
  readonly deployedAt: string;
};

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const deploymentFile = (network: string) =>
  path.join(deploymentDir, `${network}.json`);

const saveDeployment = async (record: Deployment): Promise<void> => {
  await mkdir(deploymentDir, { recursive: true });
  await writeFile(
    deploymentFile(record.network),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8",
  );
};

const loadAddress = async (config: NetworkConfig): Promise<string> => {
  const override = flag("address") ?? process.env.RUNG_CONTRACT_ADDRESS;
  if (override) return override;

  try {
    const record = JSON.parse(
      await readFile(deploymentFile(config.name), "utf8"),
    ) as Deployment;
    return record.address;
  } catch {
    throw new Error(
      `No deployment recorded for ${config.name}. Pass --address or run deploy first.`,
    );
  }
};

/**
 * The participant secret is derived from the wallet seed, so the same wallet
 * always produces the same report tag and the contract can recognise a repeat
 * report even after the private state store is cleared.
 */
const participantSecret = (seed: string): Uint8Array =>
  createHash("sha256")
    .update("rung:participant:v1")
    .update(Buffer.from(seed, "hex"))
    .digest();

const resolveSeed = (): string => {
  const existing = process.env.RUNG_WALLET_SEED;
  if (existing) return existing;

  const seed = newSeed();
  heading("New wallet seed", "save it before continuing");
  note(seed);
  note("Set RUNG_WALLET_SEED to reuse this wallet on the next run.");
  rule();
  return seed;
};

const printDistribution = (state: SurveyState, currency: string): void => {
  heading("Survey", `${amount(state.reportCount)} report(s)`);
  const bands = allBands(state.bandWidth, state.bandCount);
  const highest = bands.reduce(
    (max, band) => {
      const total = state.totals.get(band.index) ?? 0n;
      return total > max ? total : max;
    },
    0n,
  );

  for (const band of bands) {
    const total = state.totals.get(band.index) ?? 0n;
    const width = highest === 0n ? 0 : Number((total * 24n) / highest);
    console.log(
      `  ${formatBand(band, currency).padEnd(28)}${"#".repeat(width).padEnd(25)}${total}`,
    );
  }
  rule();
};

const withSession = async (
  run: (providers: RungProviders, config: NetworkConfig, seed: string) => Promise<void>,
): Promise<void> => {
  const config = selectNetwork();
  const seed = resolveSeed();

  heading("Rung", `network: ${config.name}`);
  const wallet = await openWallet(config, seed);
  const providers = await createProviders(wallet, config);
  await describeWallet(wallet);
  await run(providers, config, seed);
};

const commands: Record<string, () => Promise<void>> = {
  async deploy() {
    await withSession(async (providers, config, seed) => {
      const scale = surveyScale();
      const privateState: RungPrivateState = {
        secret: participantSecret(seed),
        compensation: 0n,
      };

      // A fresh nonce per survey keeps its report tags unrelated to the tags
      // the same participants produce in any other survey.
      const nonce = randomBytes(32);

      const survey = await step("Deploying survey", () =>
        deploySurvey(providers, privateState, scale.width, scale.count, nonce),
      );
      const address = survey.deployTxData.public.contractAddress;

      await saveDeployment({
        network: config.name,
        address,
        bandWidth: scale.width.toString(),
        bandCount: scale.count.toString(),
        surveyNonce: nonce.toString("hex"),
        deployedAt: new Date().toISOString(),
      });

      heading("Deployed");
      field("Network", config.name);
      field("Address", address);
      field("Band width", `${scale.currency}${amount(scale.width)}`);
      field("Bands", scale.count.toString());
      rule();
    });
  },

  async report() {
    const input = flag("amount") ?? process.env.RUNG_AMOUNT;
    if (!input) {
      throw new Error("Pass the annual gross amount with --amount <number>.");
    }
    const compensation = BigInt(input);

    await withSession(async (providers, config, seed) => {
      const address = await loadAddress(config);
      const state = await readSurvey(providers, address);
      if (!state) throw new Error(`No survey found at ${address}.`);

      const band = bandOf(compensation, state.bandWidth, state.bandCount);
      const privateState: RungPrivateState = {
        secret: participantSecret(seed),
        compensation,
      };

      const survey = await step("Joining survey", () =>
        joinSurvey(providers, address, privateState),
      );
      const tx = await step(`Proving and submitting a report in band ${band}`, () =>
        submitReport(survey, band),
      );

      heading("Reported");
      field("Band", band.toString());
      field("Transaction", tx.txId);
      field("Block", tx.blockHeight.toString());
      note("The amount stayed on this machine. Only the band was published.");
      rule();
    });
  },

  async show() {
    const config = selectNetwork();
    const seed = resolveSeed();
    const wallet = await openWallet(config, seed);
    const providers = await createProviders(wallet, config);
    const address = await loadAddress(config);

    const state = await readSurvey(providers, address);
    if (!state) throw new Error(`No survey found at ${address}.`);

    field("Address", address);
    printDistribution(state, surveyScale().currency);
  },
};

const command = process.argv[2] ?? "";
const run = commands[command];

if (!run) {
  console.error(`Usage: rung <${Object.keys(commands).join(" | ")}> [options]`);
  process.exit(1);
}

try {
  await run();
  process.exit(0);
} catch (error) {
  console.error(`\n  ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
