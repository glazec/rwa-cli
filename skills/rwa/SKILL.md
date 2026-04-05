---
name: rwa
description: "User-invoked /rwa command for quick tokenized asset lookups"
argument-hint: <command> [query] [--venue <venue>]
allowed-tools: [Bash, Read]
---

# /rwa - Tokenized RWA Quick Lookup

Parse the user's arguments and run the corresponding `rwa` CLI command.

## Arguments

The user invoked: $ARGUMENTS

## Argument Parsing

Map the first word to a CLI command:

| Input | CLI Command |
|---|---|
| `discover <query>` | `node src/cli.js discover <query> --json` |
| `quote <symbol>` | `node src/cli.js quote <symbol> --json` |
| `resolve <query>` | `node src/cli.js resolve <query> --json` |
| `assets [--venue <v>]` | `node src/cli.js assets --json [--venue <v>]` |
| `venues` | `node src/cli.js venues --json` |
| `snapshot <query>` | `node src/cli.js discover-snapshot <query> --json` |
| `<bare query>` (no command) | First try `node src/cli.js quote <query> --json`. If it returns `ASSET_AMBIGUOUS` or `ASSET_NOT_FOUND`, fall back to `node src/cli.js discover <query> --json` |

## Instructions

1. Parse `$ARGUMENTS` according to the table above
2. Run the CLI command via Bash from the rwa-cli project root
3. Parse the JSON output
4. Present a concise summary to the user:
   - For `quote`: show a comparison table with venue, price, deviation, bid/ask spread, and liquidity
   - For `discover`: show matched assets grouped by source (CMC, CoinGecko, Dinari)
   - For `resolve`: show canonical symbol, venue coverage, and available market types
   - For `assets`/`venues`: show the listing in a readable table
5. Highlight notable findings: largest price deviations, deepest liquidity, missing venues

## Example Usage

```
/rwa quote tsla
/rwa discover gold
/rwa resolve nvda
/rwa assets --venue ondo
/rwa venues
/rwa tsla          (bare query - auto-detects)
```
