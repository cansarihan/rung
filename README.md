# Rung

A compensation survey that never learns anyone's compensation.

Rung is built on [Midnight](https://midnight.network). Participants prove, in zero
knowledge, that their pay falls inside the band they are reporting and that they
have not reported before. The ledger stores the resulting distribution. It never
stores a salary.

## The idea

Compensation is the textbook case of information that is valuable in aggregate and
unpublishable individually. Employees negotiate against a number they cannot see,
while the surveys that do exist are either self-reported and unverifiable or held
by consultancies that sell the results back to the companies that supplied them.
Rung separates the two halves. The distribution is public and auditable by anyone;
the individual figure never leaves the machine it was typed on. A participant
submits a proof that their pay sits inside a particular band and that the secret
behind the submission has not been used before, and the chain learns exactly one
new fact: that one more distinct person landed in that band. The survey everyone
wants becomes possible precisely because nobody has to disclose anything.

## What the contract enforces

A report is accepted only when all of the following hold inside the circuit:

- The reported band is one the survey published.
- The private amount is at or above that band's floor.
- The private amount is below the next band's floor, unless the band is the
  highest one, which is open ended by design.
- The tag derived from the participant's secret has not been seen before.

Nothing about the amount is revealed by satisfying these constraints beyond the
band itself, which is the fact the survey exists to collect.

## Public state and private witness

Compact treats every value as private until the program says otherwise. A value
becomes public only when it crosses into a public domain — written to the ledger,
returned from an exported circuit, or passed to another contract — and the
compiler refuses to let it cross without an explicit `disclose()`. `disclose()`
does not encrypt or protect anything; it is the developer asserting that this
particular value is safe to publish.

**Private (witnesses).** Supplied by the participant's own process, consumed by
the proof, never transmitted:

| Witness                  | Type        | What it holds                        |
| ------------------------ | ----------- | ------------------------------------ |
| `participantSecret()`    | `Bytes<32>` | The participant's long lived secret  |
| `reportedCompensation()` | `Uint<64>`  | Annual gross pay                     |

**Public (ledger).** Written on chain, readable by anyone:

| Ledger field  | Type                      | What it holds                           |
| ------------- | ------------------------- | --------------------------------------- |
| `bandWidth`   | `Uint<64>`                | Width of one band, so clients agree      |
| `bandCount`   | `Uint<8>`                 | Number of bands; the last is open ended  |
| `bandTotals`  | `Map<Uint<8>, Counter>`   | Reports per band                         |
| `spentTags`   | `Set<Bytes<32>>`          | One tag per participant                  |
| `reportCount` | `Counter`                 | Total accepted reports                   |

The `report` circuit discloses exactly two values, and both are deliberate:

- **The band.** Disclosed on the first line of the circuit, because publishing it
  is the entire purpose of the survey. Everything after that line compares the
  private amount against public band boundaries, so the comparison happens inside
  the proof and only its outcome — accept or reject — is observable.
- **The tag**, `persistentHash(["rung:tag:v1", secret])`. Disclosed because the
  contract has to check set membership against public state to reject a second
  report. It is a preimage-resistant hash under a domain separator, so it
  identifies the *submission* without identifying the participant, and the same
  secret used on a different Rung deployment produces the same tag only within
  the same domain.

The amount is never disclosed. It has no path to the ledger: it is read from a
witness, compared against two public bounds, and discarded when the circuit ends.

### What an observer can still infer

Being explicit about the edges matters more than claiming none exist. An observer
of the chain sees the band of every report, the order reports arrived in, and the
transaction that paid for each one. They do not see who reported or what anyone
earns beyond the band. A survey with very few participants leaks more than a large
one, because a band containing a single report identifies that person's range to
anyone who knows they took part.

Uniqueness is currently per secret, not per human: the contract guarantees that
one secret reports once, and a participant who controls two secrets can report
twice. Binding a secret to an eligible cohort — proving membership without
revealing which member — is the next piece of work, described under Roadmap.

## Repository layout

```
contract/
  src/rung.compact          the contract
  src/bands.ts              band arithmetic shared with clients
  src/witnesses.ts          private state and witness implementations
  src/managed/rung/         compiler output: circuits, proving and verifier keys
  src/test/                 contract tests against a simulated ledger
cli/
  src/main.ts               deploy, report and show commands
  src/wallet.ts             wallet, dust registration, provider wiring
  src/survey.ts             contract operations
deployments/                one record per network
```

## Requirements

| Component         | Version  |
| ----------------- | -------- |
| Node.js           | 22 or newer |
| Compact toolchain | 0.31.1   |
| Compact language  | 0.23.0   |
| Compact runtime   | 0.16.0   |
| Midnight.js       | 4.1.1    |
| Proof server      | 8.1.0    |
| Docker            | any recent version |

These are the versions Preview, Preprod and Mainnet currently run. A newer
toolchain compiles against a newer ledger than the live networks accept, so the
version above is pinned rather than tracked.

`ledger-v8` and `compact-runtime` hand out classes backed by WebAssembly that are
compared by identity. A second copy of either anywhere in the dependency tree
makes a transaction built by one package unusable by another, with errors that
point nowhere near the cause. Both are therefore forced to a single version
through `overrides` in the root `package.json`.

## Running it locally

Install the Compact toolchain:

```bash
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
source ~/.zshrc
compact update 0.31.1
compact compile --version    # 0.31.1
```

Install dependencies, compile the contract and run the tests:

```bash
npm install
npm run compact
npm test
```

`npm run compact` writes the circuits and keys to `contract/src/managed/rung`.

Start the proof server in its own terminal and leave it running:

```bash
npm run proof-server
```

Create a wallet seed and point the CLI at Preprod:

```bash
cp .env.example .env
# put a 32 byte hex seed in RUNG_WALLET_SEED, or leave it unset and the
# CLI will print a fresh one on first run
set -a && . ./.env && set +a
```

Deploy a survey. The CLI prints its unshielded address and waits; fund that
address from the [Preprod faucet](https://midnight-tmnight-preprod.nethermind.dev/),
and it will register the tokens for fee generation and continue on its own.

```bash
npm run deploy
```

Report an amount into the deployed survey and read the distribution back:

```bash
npm run report -- --amount 82000
npm run show
```

`report` sends the band. It does not send `82000`.

## Deployment

See `deployments/preprod.json` for the current record.

## Roadmap

| Stage                | Work                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| Contract and CLI     | Banded reporting, one report per secret, deployed to Preprod          |
| Web client           | Browser client with Lace, so reporting needs no terminal              |
| Eligible cohorts     | Prove membership of a cohort without revealing which member           |
| Richer aggregates    | Percentile boundaries over the distribution, still without amounts    |

## License

MIT. See [LICENSE](LICENSE).
