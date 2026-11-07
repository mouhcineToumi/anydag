/**
 * What logs hold and what they never hold, in the words the first-run card and the Privacy tab
 * both say — one list, so the two cannot describe different things. It follows
 * `sync/protocol/logs.ts`'s `EVENTS`; a prop added there wants a line here.
 */

export const SENT = [
  "Errors and crashes: the message and where in the code, with every name, path and quoted text taken out",
  "Which features and pages are used, and how many of each diagram type a board holds",
  "How long pages take to draw, and how the local server answers",
  "The app's version, desktop or browser, the system, the language, and a random install id",
] as const;

export const NEVER = [
  "What you write: no document, title, file name, folder, or text you typed",
  "Who you are: no account, email, name, or address",
  "Your keys, tokens, and vault or sync passphrases",
] as const;
