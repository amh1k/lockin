# LockIn

LockIn is a Chrome extension for focus sessions that need context. It uses local Gemma through Ollama to distinguish useful research from distractions on the same site. For example, a coding tutorial can stay available while unrelated videos are paused behind a recoverable focus dialog.

The MVP supports desktop Chrome on `www.youtube.com` and `www.reddit.com`. It does not read video or audio, inspect embedded frames, or block network access. The overlay is a cooperative focus aid, not a security boundary.

## Requirements

- Node.js 24 or newer to build and test.
- Desktop Chrome 106 or newer.
- Ollama with `gemma3:1b` downloaded.

Install and start Ollama, then download the model:

```sh
ollama pull gemma3:1b
```

Keep Ollama bound to loopback. After loading the extension once, open `chrome://extensions`, copy its ID, and allow that exact extension origin in Ollama:

```text
OLLAMA_ORIGINS=chrome-extension://<your-extension-id>
```

Set `OLLAMA_ORIGINS` to that exact value and fully restart Ollama. For the desktop app on macOS, use `launchctl setenv OLLAMA_ORIGINS "chrome-extension://<your-extension-id>"`; on Linux with the systemd service, add `Environment="OLLAMA_ORIGINS=chrome-extension://<your-extension-id>"` under `[Service]`, then run `systemctl daemon-reload` and `systemctl restart ollama`; on Windows, set a user environment variable, quit Ollama from the taskbar, and relaunch it. See Ollama's FAQ for [macOS](https://docs.ollama.com/faq#setting-environment-variables-on-mac), [Linux](https://docs.ollama.com/faq#setting-environment-variables-on-linux), [Windows](https://docs.ollama.com/faq#setting-environment-variables-on-windows), and [extension origins](https://docs.ollama.com/faq#how-can-i-allow-additional-web-origins-to-access-ollama). Do not use `*` or expose port `11434` to your network.

## Build and load

```sh
npm ci
npm run build
```

In Chrome, open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select this repository's `dist/` directory. If you move or copy the repository and load a different path, Chrome can assign a different extension ID; update `OLLAMA_ORIGINS` with that ID and restart Ollama.

Open the LockIn popup, expand **First time here? Set up local AI**, and choose **Check local Gemma**. You can copy the installed extension origin directly from this panel. Start a session only after Gemma reports ready. A session can last 25 or 50 minutes and can protect YouTube, Reddit, or both. Uncertain or unavailable model results keep the page available. An active dialog always offers a page-specific override and an end-session action.

After changing the code, run `npm run build`, click **Reload** on the LockIn card in `chrome://extensions`, and refresh any YouTube/Reddit tabs. The rebuilt files in `dist/` are the installable extension; no development server is required.

## Troubleshooting

- **The Linux Ollama installer requires zstd:** on Ubuntu/Debian run `sudo apt-get install zstd`, then rerun the installer.
- **Missing model:** run `ollama pull gemma3:1b` and use **Check local Gemma** again.
- **Cannot connect:** keep Ollama running, use the origin shown in the popup for `OLLAMA_ORIGINS`, and restart Ollama after changing it.
- **Check timed out:** the model may still be loading; give it a moment and retry. The first request can be slower than later checks.
- **Extension reloaded while a site was open:** refresh that tab to reconnect its content script.

## Development

```sh
npm test
npm run typecheck
npm run build
```

`npm run eval -- dev` and `npm run eval -- holdout` call the local model against the synthetic fixtures. Results depend on the installed model and hardware; the repository's `eval/results.md` records whether a live run has been completed. Page snapshots and prompts are sent only to the loopback Ollama endpoint at `http://127.0.0.1:11434` and are not written to extension storage.

The deterministic suite covers the model adapter, session policy, extraction, worker races, content reinjection, popup flow and barrier recovery. Run the real-browser cases in [the manual checklist](docs/testing/manual-checklist.md) before treating the build as browser-verified. Live Gemma accuracy/latency is still pending and is not established by mocked tests.

## Model and license

LockIn's extension code is MIT-licensed. Gemma is an open-weight model governed by Google's [Gemma Terms of Use](https://ai.google.dev/gemma/terms); its weights are downloaded separately through Ollama and are not bundled here. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and third-party details.
