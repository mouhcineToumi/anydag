# Security policy

AnyDag runs on your machine and edits the files in your folders, so we take reports about it
seriously. Thank you for taking the trouble to send one.

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately with GitHub's private vulnerability reporting:

**<https://github.com/mouhcineToumi/anydag/security/advisories/new>**

Only the maintainer ([@mouhcineToumi](https://github.com/mouhcineToumi)) can see the report. If that
form is not available to you, contact @mouhcineToumi privately on GitHub and ask for a private way to
send the details; do not put them in the message itself.

### What to include

The more of this you can give, the faster it can be fixed:

- what is affected and the **version** (Settings → About, or `anydag --version`), and the OS;
- how it runs: the desktop app, `anydag serve`, `anydag mcp`, or the sync server;
- **steps to reproduce**, or a proof of concept, and what an attacker gains (read or write files,
  run code, reach the token, leak notes or keys);
- what the attacker must already have or do (a malicious note or board someone opens, a web page
  open in the browser, a hostile sync server, another local user);
- any suggested fix, if you have one.

Please do not include real secrets, a person's vault, or anything you are not allowed to share.

## What to expect

AnyDag is maintained by one person, so these are intentions and not a contract:

- the report is acknowledged, usually within a few days;
- it is assessed and you hear whether it is accepted, and if not, why;
- a fix is prepared privately, released, and then disclosed in a GitHub security advisory, crediting
  you unless you would rather not be named;
- please give a reasonable time to ship a fix before you publish your own write-up, and we will say
  if we need longer than you expected.

We do not run a bug bounty.

## Supported versions

Only the **latest stable release** receives security fixes. Nightly builds
(`X.Y.Z-nightly.…`) are previews of `develop` and are not supported; if a problem exists in `main`
or the latest stable release, say so and it will be fixed there first.

| Version | Supported |
|---|---|
| the latest stable release | yes |
| older stable releases | no — please update |
| nightly pre-releases | no |

## Scope

In scope — anything that lets someone who is not the person at the keyboard read, change or run
something they should not:

- **The local server's gate.** Every request must carry the per-launch token *and* a `Host` of
  `127.0.0.1`, `localhost` or `[::1]`. A bypass (a request that reaches a route without both, DNS
  rebinding, a cross-site request that writes into a vault, a token written to a log or into page
  script, `/?token=` handling) is in scope.
- **The desktop shell.** The `anydag://` scheme and its page key for writes, window isolation and
  sandboxing, what is allowed to open in the OS (`shell.openExternal`), deep links, the `anydag` shim,
  key storage through `safeStorage`, and the updater.
- **File handling.** Path traversal or escape from a vault, serving an attachment in a way that runs
  script on the app's origin, the trash, the unpack of an export or import.
- **The sync server and client.** Anything that lets the server, or another account, read plaintext
  or learn paths; weakening of the end-to-end encryption or the pairing flow; quota and
  rate-limit bypasses that cause real harm; the open `/v1/logs` endpoint.
- **The MCP server and the Assistant.** An agent reaching beyond the tools, vault or mode it was
  given: the Assistant's request guard, approvals and grants, and chat Undo and Redo confinement to
  the vault.
- **Logs.** Anything that makes the opt-in logs carry more than their documented vocabulary, or send
  without a yes.

Out of scope:

- an attacker who already has your user account, your unlocked machine or the contents of your app
  home (the token is a per-launch secret on your own machine, not a defence against local malware);
- problems in a model provider, Claude Code, OpenCode, or another tool that AnyDag only calls;
- a note, board or attachment that is *only* ugly, broken or crashes the page when opened (a bug —
  please file an issue);
- denial of service by a huge file on a machine the attacker already controls;
- reports from automated scanners with no demonstrated impact, and missing hardening headers on a
  server that is bound to loopback;
- the unsigned state of the desktop builds, which is known and documented in the README.

If you are unsure whether something is in scope, report it privately anyway.
