# T5 A-segment: credential wiring conclusion (read-only probe, Issue #1459)

| item | conclusion | evidence |
|---|---|---|
| consuming route | provider ``deepseek-official`` = `@deepseek-ai/dsh-llm-deepseek-api-key` | rc.5 dsh-llm-deepseek-api-key/lib/index.js:47,101-107 |
| credential reference | `DEEPSEEK_API_KEY` (config default `apiKeyEnv`) | dsh-llm-deepseek-api-key/lib/index.js:12,36 |
| record kind | NO `records:` kind needed; the key is a credential REF, not a plugin record | dsh-credentials/lib/index.js:13-24; dsh-llm-deepseek/lib/index.js:24-30 (`credentials.resolve(ref)`) |
| payload fields | one ref value: `refs.DEEPSEEK_API_KEY: <secret>` (string, non-empty) | dsh-credentials-local/lib/index.js:194-203,492-500 |
| baseUrl | not needed (default PUBLIC_BASE_URL = https://api.deepseek.com/anthropic) | dsh-llm-deepseek/lib/index.js:397 |
| isolated path | `<dsh-home>/.credentials.yaml` | dsh-credentials-local/lib/index.js:56-62 |
| account login required? | NO 鈥?api-key route resolves the ref; `llm-deepseek-account` is a separate provider (`deepseek-account`) and the default model uses `deepseek-official` | dsh-llm-deepseek-account/lib/index.js:70; T0-dump-config-patched.txt:406-408, agent-default-model provider=deepseek-official |
| env fallback | process env / .env also works but profile.ts STRIPS `DEEPSEEK_API_KEY` from the sidecar child env 鈬?the file is the only path | src/runtime/dsh/profile.ts:78-83,455 |
