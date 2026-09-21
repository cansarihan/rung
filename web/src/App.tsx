import { allBands, bandOf, formatBand, Rung } from "@rung/contract";
import { useEffect, useMemo, useState } from "react";
import { config } from "./config";
import { connect, isWalletInstalled, WalletError, type WalletHandle } from "./lace";
import { forgetSecret, participantSecret } from "./private-state";
import {
  buildProviders,
  joinSurvey,
  report,
  watchSurvey,
  type SurveyState,
} from "./survey";

type Stage = "idle" | "joining" | "proving" | "done";

const hex = (bytes: Uint8Array, cut = 8): string => {
  const full = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${full.slice(0, cut)}…${full.slice(-4)}`;
};

/**
 * The mark: a ladder whose rungs light in sequence. Decorative, so it is
 * hidden from assistive technology and stops animating when the visitor has
 * asked for reduced motion.
 */
const HeroMark = () => (
  <div className="mark" aria-hidden="true">
    <div className="mark-glow" />
    {Array.from({ length: 7 }, (_, i) => (
      <div className="mark-rung" key={i} style={{ "--i": i } as React.CSSProperties}>
        <span className="mark-bar" />
      </div>
    ))}
  </div>
);

const STEPS = [
  {
    n: "01",
    title: "Type the amount",
    body: "It goes into the page and no further. Nothing is posted anywhere while you type.",
  },
  {
    n: "02",
    title: "Prove the band",
    body: "A zero knowledge proof shows the amount sits between two published bounds, without carrying the amount.",
  },
  {
    n: "03",
    title: "The ladder moves",
    body: "One band count goes up. Nobody, including this site, ends up holding a salary.",
  },
];

const Ladder = ({
  survey,
  mine,
}: {
  survey: SurveyState | null;
  mine: bigint | null;
}) => {
  if (!survey) {
    return <p className="hint">Reading the survey from the indexer…</p>;
  }

  const bands = allBands(survey.bandWidth, survey.bandCount);
  const peak = bands.reduce(
    (max, b) => {
      const total = survey.totals.get(b.index) ?? 0n;
      return total > max ? total : max;
    },
    1n,
  );

  return (
    <div>
      {[...bands].reverse().map((band) => {
        const total = survey.totals.get(band.index) ?? 0n;
        const width = Number((total * 100n) / peak);
        const isMine = mine === band.index;
        return (
          <div
            key={String(band.index)}
            className={`rung${isMine ? " mine" : ""}${total === 0n ? " empty" : ""}`}
          >
            <span className="range">{formatBand(band, config.currency)}</span>
            <span className="track">
              <span
                className="fill"
                style={{ width: `${total === 0n ? 0 : Math.max(width, 4)}%` }}
              />
            </span>
            <span className="count">{String(total)}</span>
          </div>
        );
      })}
    </div>
  );
};

export const App = () => {
  const [survey, setSurvey] = useState<SurveyState | null>(null);
  const [surveyError, setSurveyError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletHandle | null>(null);
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ txId: string; band: bigint } | null>(null);
  // Assume a wallet is there until the poll below says otherwise, so the
  // install hint never flashes at someone who does have Lace.
  const [walletPresent, setWalletPresent] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const deadline = Date.now() + 2_500;
    const look = () => {
      if (cancelled) return;
      if (isWalletInstalled()) return setWalletPresent(true);
      if (Date.now() > deadline) return setWalletPresent(false);
      setTimeout(look, 200);
    };
    look();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config.contractAddress) return;
    return watchSurvey(
      config.indexer,
      config.indexerWs,
      config.contractAddress,
      setSurvey,
      setSurveyError,
    );
  }, []);

  const parsed = useMemo(() => {
    const digits = amount.replace(/[^0-9]/g, "");
    return digits === "" ? null : BigInt(digits);
  }, [amount]);

  const band = useMemo(
    () =>
      parsed === null || !survey
        ? null
        : bandOf(parsed, survey.bandWidth, survey.bandCount),
    [parsed, survey],
  );

  const tag = useMemo(() => {
    if (!wallet || !survey) return null;
    return Rung.pureCircuits.participantTag(
      survey.surveyNonce,
      participantSecret(wallet.address),
    );
  }, [wallet, survey]);

  const onConnect = async () => {
    setError(null);
    try {
      setWallet(await connect(config.network));
    } catch (e) {
      setError(
        e instanceof WalletError ? e.message : "Could not connect to the wallet.",
      );
    }
  };

  const onDisconnect = () => {
    if (wallet) forgetSecret(wallet.address);
    setWallet(null);
    setResult(null);
    setStage("idle");
    setAmount("");
  };

  const onReport = async () => {
    if (!wallet || parsed === null || band === null) return;
    setError(null);

    try {
      setStage("joining");
      const providers = await buildProviders(wallet);
      const survey = await joinSurvey(providers, config.contractAddress, {
        secret: participantSecret(wallet.address),
        compensation: parsed,
      });

      setStage("proving");
      const submitted = await report(survey, band);

      setStage("done");
      setResult({ txId: submitted.txId, band });
    } catch (e) {
      setStage("idle");
      const message = e instanceof Error ? e.message : String(e);
      setError(
        message.includes("already reported")
          ? "This wallet has already reported into the survey. One report per participant."
          : message,
      );
    }
  };

  const busy = stage === "joining" || stage === "proving";

  return (
    <>
      <header>
        <div className="shell">
          <span className="wordmark">RUNG</span>
          <span className="badge">
            <span className="dot" />
            {config.network}
          </span>
          <span className="spacer" />
          {wallet ? (
            <button className="ghost" onClick={onDisconnect}>
              Disconnect
            </button>
          ) : (
            <button className="primary" onClick={onConnect}>
              Connect Lace
            </button>
          )}
        </div>
      </header>

      <main className="shell">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">Zero knowledge compensation survey</span>
            <h1>
              Nobody here learns <em>what you earn</em>.
            </h1>
            <p>
              Rung collects a compensation survey without collecting
              compensation. You prove which band your pay falls in; the amount
              stays on this device and never reaches the chain.
            </p>
          </div>
          <HeroMark />
        </section>

        <section className="stats-row">
          <div className="stats">
            <div className="stat">
              <div className="value">{survey ? String(survey.reportCount) : "—"}</div>
              <div className="label">Reports</div>
            </div>
            <div className="stat">
              <div className="value">0</div>
              <div className="label">Salaries stored</div>
            </div>
            <div className="stat">
              <div className="value">
                {survey ? String(survey.bandCount) : "—"}
              </div>
              <div className="label">Bands</div>
            </div>
          </div>
        </section>

        <section className="how">
          {STEPS.map((step) => (
            <article className="step" key={step.n}>
              <span className="step-n">{step.n}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </article>
          ))}
        </section>

        <section className="columns">
          <div className="panel">
            <header>
              <h2>Where the ladder stands</h2>
              <span className="hint">live from the indexer</span>
            </header>
            <div className="body">
              {surveyError ? (
                <div className="notice error">{surveyError}</div>
              ) : (
                <Ladder survey={survey} mine={result?.band ?? null} />
              )}
            </div>
          </div>

          <div className="panel">
            <header>
              <h2>Report your band</h2>
            </header>
            <div className="body">
              <label htmlFor="amount">Annual gross pay</label>
              <div className="amount">
                <span>{config.currency}</span>
                <input
                  id="amount"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="82000"
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              {band !== null && survey && (
                <p className="landing">
                  Lands in{" "}
                  <b>
                    {formatBand(
                      allBands(survey.bandWidth, survey.bandCount)[Number(band)],
                      config.currency,
                    )}
                  </b>
                </p>
              )}

              <div className="actions">
                {wallet ? (
                  <button
                    className="primary"
                    disabled={band === null || busy || stage === "done"}
                    onClick={onReport}
                  >
                    {busy ? "Working…" : "Prove and submit"}
                  </button>
                ) : (
                  <button className="primary" onClick={onConnect}>
                    Connect Lace to report
                  </button>
                )}
              </div>

              {busy && (
                <ul className="steps">
                  <li className={stage === "joining" ? "active" : "done"}>
                    Loading the survey and its circuit
                  </li>
                  <li className={stage === "proving" ? "active" : ""}>
                    Proving the band, then submitting through Lace
                  </li>
                </ul>
              )}

              {!wallet && !walletPresent && (
                <p className="install-hint">
                  No Midnight wallet detected.{" "}
                  <a
                    href="https://chromewebstore.google.com/detail/lace-beta/hgeekaiplokcnmakghbdfbgnlfheichg"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install Lace
                  </a>{" "}
                  and set it to {config.network}.
                </p>
              )}

              {error && <div className="notice error">{error}</div>}

              {result && (
                <div className="notice done">
                  <div>Published band {String(result.band)}. The amount was not sent.</div>
                  <code className="txid">{result.txId}</code>
                </div>
              )}

              <div className="split" style={{ marginTop: 20 }}>
                <div className="kept">
                  <div className="caption">Stays on this device</div>
                  <div className="pair">
                    <span className="k">amount</span>
                    <span className="v">
                      {parsed === null ? "—" : `${config.currency}${parsed}`}
                    </span>
                  </div>
                  <div className="pair">
                    <span className="k">secret</span>
                    <span className="v">
                      {wallet ? "••••••••••••" : "—"}
                    </span>
                  </div>
                </div>
                <div className="sent">
                  <div className="caption">Goes to the chain</div>
                  <div className="pair">
                    <span className="k">band</span>
                    <span className="v">{band === null ? "—" : String(band)}</span>
                  </div>
                  <div className="pair">
                    <span className="k">tag</span>
                    <span className="v">{tag ? hex(tag) : "—"}</span>
                  </div>
                  <div className="pair">
                    <span className="k">proof</span>
                    <span className="v">4575 rows</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div className="shell">
          <div className="foot-block">
            <div className="foot-label">Contract</div>
            <code>{config.contractAddress || "not configured"}</code>
          </div>
          <div className="foot-block">
            <div className="foot-label">Network</div>
            <span>{config.network}</span>
          </div>
          <span className="spacer" />
          <a href="https://github.com/cansarihan/rung">Source</a>
        </div>
      </footer>
    </>
  );
};
