# Codex Activity Card

A self-updating SVG card for a GitHub profile README. It reads aggregate Codex usage from the local Codex app-server and refreshes the lifetime token count, current streak, and peak daily token count.

<p align="center">
  <img src="./assets/codex-activity.svg" alt="Example Codex activity card showing lifetime tokens, current streak, and peak daily tokens." width="880" />
</p>

## Requirements

- Node.js 18 or later
- The Codex CLI installed locally and signed in
- An account whose local Codex app-server exposes aggregate usage

## Use it in your profile

1. Copy this repository's `assets` and `scripts` folders into your special GitHub profile repository, which has the same name as your GitHub username.
2. Add the card to your `README.md`:

   ```html
   <img src="./assets/codex-activity.svg" alt="Codex activity" width="880" />
   ```

3. Run the updater from a machine signed in to Codex:

   ```bash
   npm run update
   ```

   To refresh an SVG stored in another repository, pass its path explicitly:

   ```bash
   npm run update -- --output /absolute/path/to/assets/codex-activity.svg
   ```

4. Commit and push the updated SVG.

The script intentionally updates only `assets/codex-activity.svg`. Schedule the command with cron, Task Scheduler, or your preferred runner.

## Security

This repository has no environment variables, API keys, or credential files. The updater asks the locally installed Codex CLI for aggregate usage through its app-server; it never reads or writes authentication material. Keep any scheduler wrapper, Git credential helper, and deployment tokens outside the repository.

## Data it uses

The generated SVG contains only three aggregate figures:

- Lifetime tokens
- Current streak in days
- Peak daily tokens

## License

[MIT](./LICENSE)
