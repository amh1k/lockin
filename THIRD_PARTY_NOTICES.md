# Third-party notices

## Gemma 3 1B

LockIn uses the `gemma3:1b` open-weight model through a separately installed Ollama runtime. Gemma is subject to Google's [Gemma Terms of Use](https://ai.google.dev/gemma/terms) and [prohibited-use policy](https://ai.google.dev/gemma/prohibited_use_policy). The model weights are not included in this repository. “Open-weight” describes the model distribution; it does not change the model's license or terms.

## Ollama

Ollama is a separately installed local inference runtime. LockIn sends classification requests to its loopback API at `http://127.0.0.1:11434`; it does not bundle Ollama or expose an inference server.

## JavaScript dependencies

The project uses the dependencies and pinned versions listed in `package.json` and `package-lock.json`. Their licenses are distributed with their respective packages.
