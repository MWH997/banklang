import { prepareRuntime } from "../tools/conformance";

/**
 * Runs once before the suite, in its own process, ahead of every worker.
 *
 * The only thing it does is build the reference runtime in `runtime/`, whose
 * six modules every executed conformance test calls into. They are the same for
 * the whole run, so building them per test was six `cobc` invocations of
 * repeated work each — most of what those tests spent their time on, and enough
 * that a loaded runner pushed them past the default timeout. A suite that
 * reports a compiler defect because the machine was busy is worse than a slow
 * suite.
 *
 * Here rather than in a `beforeAll`: a `beforeAll` runs per file and inside the
 * timed region, so the first test in each worker would still pay for it on a
 * cold cache.
 */
export default function setup(): void {
  prepareRuntime();
}
