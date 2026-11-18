/**
 * Every answer an app the unit suite makes (`createApp`) gives is held to the OpenAPI document
 * (`spec.ts`): a route that answers what its row does not say fails the test that asked it, with the
 * difference. A `setupFiles` entry of `vitest.config.ts`, so no test has to opt in — and none can
 * forget to.
 */

import { vi } from "vitest";

import { answerProblem } from "./spec";

vi.mock("../../server/app", async (actual) => {
  const mod = (await actual()) as typeof import("../../server/app");
  const { cloudOn } = await import("../../server/features");
  return {
    ...mod,
    createApp(opts: Parameters<typeof mod.createApp>[0]) {
      const app = mod.createApp(opts);
      const cloud = cloudOn(opts.session.env);
      const fetch = app.fetch;
      app.fetch = async (req: Request, ...rest: unknown[]) => {
        const res = await (fetch as (...a: unknown[]) => Response | Promise<Response>)(req, ...rest);
        const problem = await answerProblem(cloud, req.method, req.url, res);
        if (problem) throw new Error(`the answer is not the one the OpenAPI document gives: ${problem}`);
        return res;
      };
      return app;
    },
  };
});
