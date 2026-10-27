# Fine-tuning a local model on your own conversations

Array does not train models. It exports an agent's history in a format that the common open-source
trainers read, and it runs the result through Ollama or LM Studio like any other local model.

## 1. Export

```bash
bun scripts/export-conversations.ts --list
bun scripts/export-conversations.ts --agent=research --max-messages=40
```

The script opens this checkout's dev `openbot.db` read-only (pass `--db=<path>` for another profile,
such as `~/Library/Application Support/Array/openbot.db` for a packaged build). It writes
`.openbot-build/exports/<agent>.jsonl`, one conversation window per line:

```json
{"messages":[{"role":"user","content":"…"},{"role":"assistant","content":"…"}]}
```

Only what you typed and what the agent answered are kept; tool steps, question cards, images and
agent-to-agent messages are left out. Roles alternate (consecutive messages of one role are joined),
and long threads are split into windows of at most `--max-messages`. Every message goes through the
same secret redaction as the logs, but read the file before you share it: redaction catches known
patterns and saved secrets, not every private detail.

## 2. Train a LoRA adapter

Use [Unsloth](https://github.com/unslothai/unsloth) on one GPU, or
[Axolotl](https://github.com/axolotl-ai-cloud/axolotl) for more control. Both read this `messages`
format as a chat dataset (Axolotl: `type: chat_template`, `field_messages: messages`). Start from the
base model you already run locally (for example Llama 3.2 3B Instruct), a LoRA rank of 16, two or
three epochs, and hold out a tenth of the lines to check that the loss on unseen conversations falls.
A few hundred good conversations teach tone and habits; they do not teach new facts reliably.

## 3. Convert to GGUF

Merge the adapter into the base weights, then convert with llama.cpp (`convert_hf_to_gguf.py`) and
quantize (`llama-quantize … Q4_K_M`). Unsloth can do both with `save_pretrained_gguf`.

## 4. Run it in Ollama, then in Array

```bash
cat > Modelfile <<'EOF'
FROM ./my-analyst.Q4_K_M.gguf
EOF
ollama create my-analyst -f Modelfile
```

In Array, open Settings → Providers → the "Ollama (this computer)" endpoint (the Local Analyst seed
saves it on first run), add `my-analyst`, and pick it in the agent's model menu. A plain chat
("New chat") works the same way.
