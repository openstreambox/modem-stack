import fc, { type Parameters } from 'fast-check';

/**
 * Run budget for the property tests.
 *
 * `bun test` runs each property for a few hundred cases, which keeps the suite quick.
 * A longer, time-bounded run is `FUZZ_SECONDS=8 bun test --timeout 60000 src/fuzz`: every property gets
 * that many seconds with the case count lifted, and each property reports its case count as a `fuzz-runs` line
 * (`FUZZ_SECONDS=8` across this directory is about five minutes). An interrupted run is
 * not a failure; a counterexample still is.
 */
export function budget(): Parameters<unknown> {
	const seconds = Number(process.env.FUZZ_SECONDS ?? 0);
	const timed = Number.isFinite(seconds) && seconds > 0;
	return {
		...(timed
			? {
					numRuns: 1_000_000_000,
					interruptAfterTimeLimit: seconds * 1000,
					markInterruptAsFailure: false,
				}
			: { numRuns: 300 }),
		reporter: (details) => {
			if (timed) console.log(`fuzz-runs ${details.numRuns}`);
			if (details.failed) throw new Error(fc.defaultReportMessage(details));
		},
	};
}
