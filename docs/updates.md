# Automatic updates for the desktop app (optional, free)

The desktop app can update itself: it checks GitHub for a newer release at start-up (and from
**Settings → Desktop → Check for updates**), downloads it, **verifies its signature**, installs it
and restarts.

Updates are signed with a key pair you create yourself. This is **not** the paid Apple/Windows
code signing: it's a free key that only Page Aura uses, so the app can prove an update really
came from you. Builds made without the key simply have no updater; nothing else changes.

## Set it up (once, about 5 minutes)

1. **Create the key pair** on your own computer (not in a shared or cloud environment):

   ```bash
   cd desktop
   ```

   ```bash
   npx tauri signer generate -w ~/.tauri/page-aura.key
   ```

   Choose a password when asked. This creates `~/.tauri/page-aura.key` (private: keep it safe and
   never commit it) and `~/.tauri/page-aura.key.pub` (public).

2. **Add the private key to GitHub** (repository → **Settings → Secrets and variables → Actions →
   Secrets**):
   - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/page-aura.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the password you chose

3. **Add the public key** in the same place, under the **Variables** tab:
   - `PAGE_AURA_UPDATER_PUBKEY`: the contents of `~/.tauri/page-aura.key.pub`

4. **Make a release** (Actions → *Desktop app* → Run workflow → version). From that release on,
   the installers include the updater, and the release carries a `latest.json` the app checks.

People need to install that first updater-enabled release by hand once. After that, updates arrive
on their own.

## If the private key is ever lost or leaked

Generate a new pair, replace the secret and the variable, and publish a release. Installs signed
with the old key can't verify updates signed with the new one, so tell people to download the new
version manually once.
