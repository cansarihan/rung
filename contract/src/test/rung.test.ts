import { setNetworkId } from "@midnight-ntwrk/midnight-js-network-id";
import { describe, expect, it } from "vitest";
import { bandOf } from "../bands.js";
import { pureCircuits } from "../managed/rung/contract/index.js";
import { createPrivateState, type RungPrivateState } from "../witnesses.js";
import { RungSimulator } from "./rung-simulator.js";

setNetworkId("undeployed");

const WIDTH = 10_000n;
const COUNT = 12n;
const TOP_BAND = COUNT - 1n;
const NONCE = new Uint8Array(32).fill(42);

const participant = (seed: number, compensation: bigint): RungPrivateState =>
  createPrivateState(new Uint8Array(32).fill(seed), compensation);

const surveyWith = (first: RungPrivateState) =>
  new RungSimulator(WIDTH, COUNT, NONCE, first);

describe("survey setup", () => {
  it("publishes the band scale and starts empty", () => {
    const survey = surveyWith(participant(1, 55_000n));
    const state = survey.getLedger();

    expect(state.bandWidth).toEqual(WIDTH);
    expect(state.bandCount).toEqual(COUNT);
    expect(state.surveyNonce).toEqual(NONCE);
    expect(state.reportCount).toEqual(0n);
    expect(state.spentTags.isEmpty()).toBe(true);
    expect(state.bandTotals.isEmpty()).toBe(true);
  });

  it("refuses a scale that cannot classify anything", () => {
    expect(
      () => new RungSimulator(0n, COUNT, NONCE, participant(1, 55_000n)),
    ).toThrow(/band width must be positive/);
    expect(
      () => new RungSimulator(WIDTH, 1n, NONCE, participant(1, 55_000n)),
    ).toThrow(/at least two bands/);
  });
});

describe("reporting", () => {
  it("records the band and never the amount", () => {
    const survey = surveyWith(participant(1, 55_000n));
    const state = survey.report(5n);

    expect(state.reportCount).toEqual(1n);
    expect(state.bandTotals.lookup(5n).read()).toEqual(1n);
    expect(state.spentTags.size()).toEqual(1n);

    const published = JSON.stringify(state, (_, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(published).not.toContain("55000");
  });

  it("accepts the open ended top band for any amount above its floor", () => {
    const survey = surveyWith(participant(1, 4_800_000n));
    const state = survey.report(TOP_BAND);

    expect(state.bandTotals.lookup(TOP_BAND).read()).toEqual(1n);
  });

  it("rejects a band the amount is too small for", () => {
    const survey = surveyWith(participant(1, 25_000n));

    expect(() => survey.report(3n)).toThrow(
      /amount falls below the reported band/,
    );
    expect(survey.getLedger().reportCount).toEqual(0n);
  });

  it("rejects a band the amount is too large for", () => {
    const survey = surveyWith(participant(1, 25_000n));

    expect(() => survey.report(1n)).toThrow(
      /amount falls above the reported band/,
    );
    expect(survey.getLedger().reportCount).toEqual(0n);
  });

  it("rejects a band outside the published scale", () => {
    const survey = surveyWith(participant(1, 55_000n));

    expect(() => survey.report(COUNT)).toThrow(
      /band is outside the survey range/,
    );
  });
});

describe("one report per participant", () => {
  it("rejects a second report from the same secret", () => {
    const survey = surveyWith(participant(1, 55_000n));
    survey.report(5n);

    survey.switchTo(participant(1, 95_000n));
    expect(() => survey.report(9n)).toThrow(/already reported/);

    const state = survey.getLedger();
    expect(state.reportCount).toEqual(1n);
    expect(state.bandTotals.member(9n)).toBe(false);
  });

  it("aggregates distinct participants that land in the same band", () => {
    const survey = surveyWith(participant(1, 52_000n));
    survey.report(5n);

    survey.switchTo(participant(2, 59_999n));
    const state = survey.report(5n);

    expect(state.reportCount).toEqual(2n);
    expect(state.bandTotals.lookup(5n).read()).toEqual(2n);
    expect(state.spentTags.size()).toEqual(2n);
  });

  it("derives a stable tag that does not leak the secret", () => {
    const secret = new Uint8Array(32).fill(7);
    const tag = pureCircuits.participantTag(NONCE, secret);

    expect(tag).toEqual(pureCircuits.participantTag(NONCE, secret));
    expect(tag).not.toEqual(
      pureCircuits.participantTag(NONCE, new Uint8Array(32).fill(8)),
    );
    expect(Buffer.from(tag).toString("hex")).not.toContain(
      Buffer.from(secret).toString("hex"),
    );
  });

  it("gives one secret unrelated tags in different surveys", () => {
    const secret = new Uint8Array(32).fill(7);
    const other = new Uint8Array(32).fill(43);

    expect(pureCircuits.participantTag(NONCE, secret)).not.toEqual(
      pureCircuits.participantTag(other, secret),
    );
  });

  it("lets a participant report once in each of two surveys", () => {
    const person = participant(1, 52_000n);
    const first = surveyWith(person);
    first.report(5n);

    const second = new RungSimulator(WIDTH, COUNT, new Uint8Array(32).fill(43), person);
    expect(second.report(5n).reportCount).toEqual(1n);
  });
});

describe("client and circuit agree on the band scale", () => {
  const cases: bigint[] = [0n, 1n, 9_999n, 10_000n, 55_000n, 109_999n, 110_000n, 3_000_000n];

  it.each(cases)("classifies %s the same way on both sides", (compensation) => {
    const band = bandOf(compensation, WIDTH, COUNT);
    const floor = pureCircuits.bandFloor(WIDTH, band);

    expect(compensation >= floor).toBe(true);
    if (band < TOP_BAND) {
      expect(compensation < pureCircuits.bandFloor(WIDTH, band + 1n)).toBe(true);
    }

    const survey = surveyWith(participant(1, compensation));
    expect(survey.report(band).bandTotals.lookup(band).read()).toEqual(1n);
  });
});
