# OpenClaw Subagents Dashboard

A plugin for [OpenClaw](https://openclaw.io) that adds a **Subagents** tab to the Control UI, showing all spawned sub-agents with their prompts, status, and token usage.

## Features

- Live dashboard showing all spawned sub-agents
- Per-agent details: prompt, model, status, duration, last activity
- Summary cards: total, running, done, error counts
- Auto-refreshes every 5 seconds
- Dark theme matching the OpenClaw UI
- Gateway RPC methods (`subagents.list`, `subagents.summary`)

## Installation

```bash
# Clone the repo
git clone https://github.com/Soulz-io/Office.git openclaw-subagents

# Add to your openclaw.json
```

Add the plugin to your `~/.openclaw/openclaw.json`:

```json
{
  "gateway": {
    "controlUi": {
      "root": "/path/to/openclaw-subagents/control-ui-patched"
    }
  },
  "plugins": {
    "allow": ["openclaw-subagents"],
    "load": {
      "paths": ["/path/to/openclaw-subagents"]
    },
    "entries": {
      "openclaw-subagents": {
        "enabled": true
      }
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## How it works

The plugin:

1. **Patches the Control UI** at startup — copies the original control-ui assets and injects a `<script>` tag for the dashboard tab
2. **Registers HTTP routes** — serves the dashboard UI and API endpoints at `/plugins/openclaw-subagents/`
3. **Tracks subagents** via plugin hooks (`subagent_spawned`, `subagent_ended`) and the persisted registry on disk
4. **Provides RPC methods** — `subagents.list` and `subagents.summary` for WebSocket clients

## API

| Endpoint | Description |
|----------|-------------|
| `GET /plugins/openclaw-subagents/api/subagents` | List all subagent run records |
| `GET /plugins/openclaw-subagents/api/summary` | Aggregate stats (total/running/done/error) |

## File structure

```
├── index.ts                 # Plugin entry point
├── openclaw.plugin.json     # Plugin manifest
├── package.json             # npm package metadata
├── src/
│   ├── store.ts             # Data layer: reads runs.json + hook events
│   ├── http-handler.ts      # HTTP API + static file serving
│   ├── gateway-methods.ts   # Gateway RPC methods
│   └── tab-injector.ts      # Patches control-ui HTML
└── ui/
    ├── injector.js           # Shadow DOM tab injection
    ├── index.html            # Dashboard shell
    ├── app.js                # Dashboard logic
    └── app.css               # Dark theme styles
```

## License

MIT
