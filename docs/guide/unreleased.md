# Not released yet

> **Not in any release.** These features are behind the build's `cloud` switch, which no release
> build turns on (see *Feature switches* in [`docs/architecture/server.md`](../architecture/server.md)).
> Nothing in the user guide links here. When the server ships, this text moves back into
> [Your files](files.md).

## Sync

Sync is optional. To keep a vault in step across your computers, you run a **sync server**
yourself. It is in this repository under [`sync/`](../../sync/), as a small Node service.

Sync is **end-to-end encrypted**: your files are encrypted on your computer with a passphrase only
you know, and the server stores encrypted blobs with no file names. If two computers change the same
file at once, AnyDag keeps both: yours stays in place and the other is saved beside it as a
*conflict* copy.

Set it up from **Settings → Sync**: pair the computer with a one-time code from the server, then link
the vault. The setup is described in [`docs/architecture/sync.md`](../architecture/sync.md).

## Anonymous logs

The first time you open the app it asks whether it may send **anonymous logs** about crashes and
which features are used. They are off until you say yes. They never include what you write, file or
folder names, or anything that identifies you. Change your answer at any time in
**Settings → Privacy**, which also shows exactly what is sent.
