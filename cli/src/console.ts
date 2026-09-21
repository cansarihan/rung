const RULE = "-".repeat(66);

export const rule = (): void => console.log(RULE);

export const heading = (title: string, note?: string): void => {
  console.log("");
  rule();
  console.log(note ? `${title.padEnd(48)}${note}` : title);
  rule();
};

export const field = (label: string, value: string): void =>
  console.log(`  ${`${label}:`.padEnd(20)}${value}`);

export const note = (text: string): void => console.log(`  ${text}`);

/**
 * Runs a long operation while keeping one line of feedback on the console.
 * Network calls here routinely take tens of seconds, so silence reads as a hang.
 */
export const step = async <T>(
  message: string,
  run: () => Promise<T>,
): Promise<T> => {
  const started = Date.now();
  process.stdout.write(`  ${message} ... `);
  try {
    const result = await run();
    process.stdout.write(`done (${Math.round((Date.now() - started) / 1000)}s)\n`);
    return result;
  } catch (error) {
    process.stdout.write("failed\n");
    throw error;
  }
};

export const amount = (value: bigint): string => value.toLocaleString("en-US");
