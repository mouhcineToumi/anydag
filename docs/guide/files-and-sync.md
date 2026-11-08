# Your files, sync and privacy

## Your files are yours

There is no account and no cloud. Everything you make is a plain text file in the folder you
opened. The app keeps only a search index and its settings outside that folder, and can rebuild the
index from your files at any time. **Opening a folder never changes a file in it.**

That means you can:

- back up your vault like any other folder;
- keep it in git, Dropbox or a USB stick;
- edit any file in another editor while AnyDag is open: the app picks up the change;
- stop using AnyDag and keep everything, readable as Markdown.

## The trash

Nothing is deleted at once. A deleted file or folder goes to the **Trash** (at the foot of the
sidebar) and stays for thirty days. The notice that appears after a delete has an **Undo** button.
From the Trash page you can restore anything, or delete it for good.

## The lock

`ctrl+shift+L`, or the switch at the end of the top bar, makes the app **read-only**. Pages still
open, search still works and boards still pan, but nothing can be changed by accident. It applies to
this window only, so you can lock a tablet while editing on a laptop.

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

---

[← AI and agents](ai.md) · [Guide](README.md)
