/**
 * elkjs ships no types for its worker builds.
 *
 * `?worker` is Vite's: it turns the module into a `Worker` constructor at build time. The plain
 * path is what the tests import instead, where elkjs exports the fake worker it uses in Node.
 */
declare module "elkjs/lib/elk-worker.min.js?worker" {
  const WorkerConstructor: new () => Worker;
  export default WorkerConstructor;
}

declare module "elkjs/lib/elk-worker.min.js" {
  export const Worker: new (url?: string) => Worker;
}
