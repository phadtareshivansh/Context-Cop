# Context Cop

Context Cop is a single-page AI chat interface with a polished landing page and an app experience for long AI conversations. It shows a live token estimate, tracks how much context is active or compressed, and can summarize older turns before the chat runs out of room.

The app is split into markup, styles, and JavaScript files, and can run in demo mode or connect to Gemini/OpenAI-compatible chat APIs.

## Features

- Live context-window meter with active and compressed token counts
- Premium landing page that opens the real app or starts demo mode
- Auto-compression threshold slider from 40% to 95%
- Manual "Summarise Now" action for forcing a context snapshot
- Gemini and OpenAI/Codex provider selection
- OpenAI-compatible custom base URL support
- Demo mode with simulated assistant replies
- Stats for total turns, compressions, and estimated tokens saved
- Activity log for connection, compression, model, and threshold events
- Responsive single-page layout with no build step

## Quick Start

Open the app directly in a browser:

```bash
open index.html
```

Or serve it from a local web server:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then visit:

```text
http://127.0.0.1:8765
```

## Build

Create a deployable Sites artifact:

```bash
npm run build
```

This writes a Cloudflare Worker-compatible package to `dist/`.

## Usage

1. Open `index.html` in a browser.
2. Choose Gemini or OpenAI / Codex in the provider modal.
3. Enter an API key, or choose demo mode.
4. Select a model from the sidebar.
5. Start chatting.
6. Adjust the auto-compress threshold if you want summaries to trigger earlier or later.

When the estimated active context passes the selected threshold, Context Cop asks whether to compress older messages. If the active context reaches the model limit, it compresses automatically.

## Provider Notes

### Gemini

Uses the Google Gemini API endpoint:

```text
https://generativelanguage.googleapis.com/v1beta/models
```

The default model list includes Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Flash, and Gemini 1.5 Pro.

### OpenAI / Codex

Uses the Chat Completions endpoint on:

```text
https://api.openai.com/v1
```

You can provide a custom base URL for an OpenAI-compatible proxy, Azure-style gateway, or local backend.

## Security Notes

API keys are kept in browser memory only and are not saved to local storage by this app. However, this is still a client-side prototype: any key entered into a browser page can be inspected by that page's runtime.

For production use, route model calls through a backend service and keep provider keys on the server.

## Project Structure

```text
.
|-- assets/
|   `-- context-layers-hero.png
|-- .openai/
|   `-- hosting.json
|-- css/
|   `-- styles.css
|-- js/
|   `-- app.js
|-- scripts/
|   `-- build-sites.mjs
|-- index.html
|-- package.json
`-- README.md
```

## Customization

- Edit the model catalogs in `js/app.js` through `GEMINI_MODELS` and `OPENAI_MODELS`.
- Change the default compression threshold in `js/app.js` and the slider default in `index.html`.
- Adjust token estimation in `js/app.js` through `estimateTokens()`.
- Tune the compression behavior in `js/app.js` through `runSummarization()` and `buildSummaryPrompt()`.
- Adjust the visual system in `css/styles.css`.

## Limitations

- Token counts are estimates based on character length, not tokenizer-exact counts.
- Direct browser API calls may be affected by provider CORS policies.
- Summaries depend on the selected model unless demo mode is enabled.
- Chat history is in memory and resets when the page reloads.
