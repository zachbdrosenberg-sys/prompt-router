# prompt-router

Analyzes every prompt you send and recommends the model (haiku, sonnet or opus) and effort level (low → max) that fits it. A fast, low-effort Haiku call classifies the prompt; if that call fails or takes over 6 seconds, a keyword/length heuristic is used instead.

The recommendation shows in a row above the prompt and in the status line.

Modes (persist across sessions):

- `/route suggest`: show the recommendation only (default)
- `/route auto`: also apply it to the main conversation's requests for that turn
- `/route off`: disable
- `/route`: show the current mode

## Install

At the prompt of a Claude Code session:

```
/plugin install prompt-router --marketplace zachbdrosenberg-sys/prompt-router
```

From a shell:

```bash
claude plugin install prompt-router --marketplace zachbdrosenberg-sys/prompt-router
```

The repository is private, so the computer needs GitHub access to it (for example `gh auth login`).
