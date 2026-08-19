# Building a profile that caches

A Pilotfish profile assigns a model to each of the nine roles. This document is about the part that is
easy to get wrong: making sure the model you picked is served by an upstream that will cache your
prefix, so you are not paying full price for the same 30–50K tokens on every request.

It matters most on OpenRouter, where you choose the upstream. On ChatGPT and AntiGravity the provider
caches automatically and there is nothing to configure — the shipped `chatgpt` and `antigravity`
presets need no provider block at all.

## Why this matters more than model choice

Every request re-sends the agent's system prompt and tool schemas. That block is the **prefix**, and it
is 30–50K tokens depending on the role. Providers that cache it charge a fraction; providers that do not
charge full price, every single turn.

Caching works inside a session and mostly not across them. Measured over 4,525 requests on this install:

| Position | Requests | % warm | Avg input paid | Avg served from cache |
|---|---|---|---|---|
| First request in a session | 316 | 18% | 20,548 | 4,415 |
| Later requests in the same session | 4,209 | **93%** | 11,990 | **98,234** |

What this shows is that once a session is running, caching carries almost the whole prefix — 98,234
tokens on average, at a 93% hit rate. A new session gets almost none of that, and no timing trick
changes it: bucketing first requests by how recently the same agent and model were last used gives 20%
warm under five minutes, 29% at 5–15 minutes, 13% at 15–60 minutes, and 5% beyond an hour.

Two consequences follow, and they drive everything else in this document. Every new session pays a
full-price cold start, so **every delegation costs a cold start** — a subagent that runs two turns pays
about half its input at full rate, one that runs nine turns pays an eighth. And model count is not what
multiplies your caches: roles are. Nine roles on one model is nine prefixes and nine caches, and nine
roles across three models is still nine, because each role has its own prompt and therefore its own
prefix. Adding models changes which endpoint each cache lives on, not how many there are.

## The one rule for OpenRouter profiles

**Check that your model's cheap endpoints actually cache before you commit to it, and pin the ones that
do.** OpenRouter routes by price by default, and for several popular models the cheapest endpoints are
precisely the ones with no prompt cache. Cheap-per-token routing then buys you the expensive outcome.

Check any model like this:

```bash
curl -s https://openrouter.ai/api/v1/models/<author>/<slug>/endpoints | python3 -c "
import sys,json
for e in json.load(sys.stdin)['data']['endpoints']:
    p=e['pricing']; cr=p.get('input_cache_read')
    base=float(p['prompt'])*1e6; cache=float(cr)*1e6 if cr else None
    disc=f'{base/cache:.1f}x' if cache else 'NO CACHE'
    print(f\"{e['provider_name']:16} {base:>8.4f}/M  cached={cache if cache is not None else '--'}  {disc}\")"
```

Read the output for two traps. A missing cached price means that endpoint has no prompt cache, so it
can never help you. A cached price *equal to* the base price is not a discount — AtlasCloud and
CoreWeave both do this on `qwen3.6-35b-a3b`.

Then pin the good ones in your own `opencode.json`:

```json
"provider": {
  "openrouter": {
    "models": {
      "<author>/<slug>": {
        "options": { "provider": { "order": ["<slug1>", "<slug2>"], "allow_fallbacks": false } }
      }
    }
  }
}
```

Use the plain provider slug, not the endpoint tag: `chutes`, never `chutes/fp8`. Validate slugs against
`https://openrouter.ai/api/v1/providers`. Quantization is a separate `quantizations` field.

Keep `allow_fallbacks` at `false`. Set to `true`, OpenRouter is free to fall back to a cheap uncached
endpoint, which is the exact problem you are solving. List two or three slugs so one provider outage
does not hard-fail the request.

There is no shortcut for this in the OpenRouter web portal. Account settings let you set default
provider preferences and ignore lists, but caching support is not something you can route on. It also
could not work as a global setting even if it existed, because **caching support is a property of the
model-and-provider pair, not the provider**: DeepInfra does not cache `qwen3.6-27b` but does cache
`deepseek-v4-flash-0731` at a 5x discount. A global ignore list cannot express that.

## Verified pins for the shipped OpenRouter models

Snapshot taken 2026-08-11 from the endpoints API. Re-run the check above before trusting it; pricing
moves and endpoints come and go.

| Model | Pin to | $/M in | cached | effective | Avoid |
|---|---|---|---|---|---|
| `qwen/qwen3.6-27b` | `chutes`, `phala` | 0.300 | 0.030 | **0.057** | morph, siliconflow, deepinfra, venice, alibaba — none cache |
| `qwen/qwen3.6-35b-a3b` | `akashml`, `parasail` | 0.140 | 0.050 | **0.059** | venice, deepinfra, siliconflow — none cache; atlas-cloud, coreweave — cached price equals base |
| `deepseek/deepseek-v4-pro` | `deepseek`, `baidu` | 0.435 | 0.0036 | **0.047** | nothing; every endpoint caches |
| `deepseek/deepseek-v4-flash-0731` | `deepseek`, `deepinfra` | 0.140 | 0.0028 | **0.017** | mancer only |

"Effective" is what you actually pay per million at a 90% cache hit rate, and it is the column to rank
on. Headline price is misleading in both directions: `venice` looks like the cheapest `35b-a3b` endpoint
at 0.098 but never caches, so it stays at 0.098 while `akashml` lands at 0.059. In the other direction
`deepseek` has the *highest* base price for `v4-flash-0731` at 0.140 and is still the cheapest endpoint
to actually run, at 0.017.

These figures moved measurably in a single day — `streamlake` went 0.609 to 0.522 on `v4-pro`, `decart`
0.072 to 0.081 on `v4-flash`, and `baidu` appeared as a new endpoint. Treat the table as an example of
the output, and the audit script above as the source of truth.

The DeepSeek rows are why the `deepseek` profile is the better OpenRouter choice for a large-prefix
orchestrator. Every DeepSeek endpoint prices cached input, and the first-party endpoint discounts it
120x while sitting at the cheapest base rate for `v4-flash`. Qwen is cheaper per raw token and more
expensive in practice.

Ready-made block covering all four:

```json
"provider": {
  "openrouter": {
    "models": {
      "qwen/qwen3.6-27b": {
        "options": { "provider": { "order": ["chutes", "phala"], "allow_fallbacks": false } }
      },
      "qwen/qwen3.6-35b-a3b": {
        "options": { "provider": { "order": ["akashml", "parasail"], "allow_fallbacks": false } }
      },
      "deepseek/deepseek-v4-pro": {
        "options": { "provider": { "order": ["deepseek", "baidu"], "allow_fallbacks": false } }
      },
      "deepseek/deepseek-v4-flash-0731": {
        "options": { "provider": { "order": ["deepseek", "deepinfra"], "allow_fallbacks": false } }
      }
    }
  }
}
```

## Auditing a whole profile at once

Rather than maintaining tables by hand, audit every model in a profile against live OpenRouter data.
This ranks each model's endpoints by whether they cache at all, then by effective cost, and prints the
`order` array to paste. Re-run it whenever you change models or suspect pricing has moved.

```bash
python3 - <<'PY'
import json, urllib.request
MODELS = [  # every OpenRouter model in your profile, primary and workers
    "qwen/qwen3.6-27b", "qwen/qwen3.6-35b-a3b",
    "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash-0731",
]
for m in MODELS:
    url = f"https://openrouter.ai/api/v1/models/{m}/endpoints"
    eps = json.load(urllib.request.urlopen(url))["data"]["endpoints"]
    HIT = 0.90          # measured share of context served from cache on a caching provider
    rows = []
    for e in eps:
        p = e["pricing"]; base = float(p["prompt"]) * 1e6
        cr = p.get("input_cache_read")
        cached = float(cr) * 1e6 if cr not in (None, "") else None
        # a cached price equal to base is not a discount
        useful = cached is not None and cached < base * 0.9
        # rank on what you actually pay, not the headline rate
        expected = base * (1 - HIT) + cached * HIT if useful else base
        slug = (e.get("tag") or "").split("/")[0] or e.get("provider_name", "?").lower()
        rows.append((expected, slug, base, cached, useful))
    rows.sort()
    good = [r for r in rows if r[4]]
    print(f"\n{m}")
    for expected, slug, base, cached, useful in rows[:6]:
        disc = f"{base/cached:.1f}x" if useful else "NO CACHE"
        print(f"   {slug:16} ${base:>8.4f}/M  cached={('$%.4f' % cached) if cached else '--':>9}"
              f"  eff=${expected:>7.4f}/M  {disc}")
    if good:
        print(f'   -> "order": {json.dumps([g[1] for g in good[:2]])}, "allow_fallbacks": false')
    else:
        print("   -> NO CACHING ENDPOINT EXISTS. This model pays full price on every request.")
PY
```

Read the output as a selection rule in three tiers. Prefer an endpoint that caches with a meaningful
discount. Among those, take the cheapest base price, since you still pay it on every cache miss. If the
last line says no caching endpoint exists, that model is a poor fit for any role with a large prefix —
either accept the cost deliberately or pick a different model.

## Rolling your own profile

Pick models by capability first — a profile is only useful if the workers can do the job. Then apply
this checklist before you commit to it.

**Run the endpoint check on every OpenRouter model in the profile.** If a model has no cached-input
pricing on any endpoint, you are choosing to pay full price on every request forever. That may still be
right for a cheap model doing short tasks, but decide it deliberately rather than discovering it later.

**Pin every OpenRouter model you use, not just the primary's.** The worker models are where the request
volume actually is. A profile that pins `qwen3.6-27b` and leaves `qwen3.6-35b-a3b` unpinned has fixed the
smaller half of the problem.

**Prefer fewer distinct models when your traffic is light.** Not because models multiply caches — they
do not, roles do — but because splitting light traffic across more endpoints means each combination is
exercised less often and is more likely to be cold when you come back to it. If you use Pilotfish all
day, this barely matters. If you use it twice a week, consolidate.

**Keep the prefix stable.** Anything that changes the system prompt or tool schemas invalidates every
cache built on it. Editing global `AGENTS.md`, granting or revoking an MCP server, or changing which
profiles are active all reset your caches. Batch such changes rather than fiddling daily.

**Verify with real traffic afterwards.** Run a few turns, then check that `cache.read` is non-zero after
the first request:

```bash
sqlite3 ~/.local/share/opencode/opencode.db "SELECT data FROM message WHERE session_id='<id>' ORDER BY time_created;" \
  | python3 -c "import sys,json;[print((json.loads(l).get('tokens') or {})) for l in sys.stdin if l.strip()]"
```

If `cache.read` stays at zero across turns, the pin is not doing what you think. Check the slug spelling
against the providers list, confirm `allow_fallbacks` is `false`, and confirm the endpoint you pinned
still publishes a cached price.

## Local providers: what changes

A locally served model inverts most of this document. Nothing is billed, so there is no cached-input
price to check and no endpoint to pin, and the caching verification above will mislead you: llama.cpp
and LM Studio reuse the KV cache internally but do not report `cached_tokens` back over the
OpenAI-compatible API, so `cache.read` stays at zero even when prompt reuse is working perfectly. A
measured local profile showed 79 requests at 0% reported cache hits while follow-up turns were plainly
reusing the prefix. Judge a local profile on wall time, not on `cache.read`.

What does need care is the provider block, because a local model is user-defined rather than supplied by
OpenCode:

```jsonc
"myserver": {
  "npm": "@ai-sdk/openai-compatible",
  "name": "My Server",
  "options": { "baseURL": "http://192.168.1.10:1234/v1", "timeout": 3000000, "chunkTimeout": 3000000 },
  "models": {
    "the-exact-model-id-the-server-reports": {
      "name": "Display name",
      "limit": { "context": 204850, "output": 32768 },
      "modalities": { "input": ["text"], "output": ["text"] },
      "reasoning": true,
      "temperature": false,
      "tool_call": true
    }
  }
}
```

**`limit.context` must match what the server actually allocated, not the model's native maximum.** These
are different numbers. A 256K-native model loaded with a 200K context window will truncate or error near
the top if OpenCode believes it has 256K. Read the figure off the server's load settings and copy it
exactly. Confirm the model id against `curl http://<host>/v1/models` rather than the Hugging Face repo
name; they often differ.

**`temperature: false` hands sampling to the server**, which is usually what you want with a local model
whose recommended samplers are model-specific and set once at load time. Qwen3.8 in thinking mode wants
`temp 1.0 / top_p 0.95 / top_k 20 / min_p 0`, and greedy decoding is explicitly warned against; set that
on the server and let OpenCode stay out of it.

**A quantized GGUF may not honor graded `reasoning_effort` even when the upstream model does.** The chat
template ships inside the quant, and quantizers sometimes package an older binary `enable_thinking`
template instead. The symptom is a server log line like `Reasoning setting 'medium' is not supported by
model ...  Supported settings: 'on', 'off'. Falling back to reasoning setting 'on'.` Verify before you
declare variants: send `reasoning_effort` at two levels and compare `usage.completion_tokens_details.
reasoning_tokens`. Use several samples — run-to-run variance on the same setting can exceed 2x, which is
enough to fake a gradient that is not there. If the template is binary, declare only the variants that
exist (a `none` variant for thinking off) and let the absence of a variant mean thinking on; OpenCode
sends no `reasoning_effort` field at all when no variant is selected.

**Name the profile by the rule in the router contract** — `<providerID>/<final segment of the primary
modelID>`. For a local model the whole id is usually the final segment, so a quant suffix is part of the
name: `myserver/qwen3.8-27b-mtp-pure`, not `myserver/qwen3.8-27b`. The truncated form is especially
dangerous locally because servers commonly host several quants of the same base model, so the short name
may silently look like a different model that also exists. Nothing enforces this on an installed config
(see #30).

**Save the load settings as the model's default, not just for the running instance.** A JIT reload uses
the saved defaults, so a mismatch surfaces only when the model is evicted and cannot come back — for
example a KV-cache quantization that requires flash attention while the saved default has it off.

Local worker viability has now been measured rather than assumed; see
[Issue #16 evidence](./issue-16-evidence.md) and the results under `tests/bench/results/`.

## What is not yet proven

That pinning to a caching endpoint actually produces cache hits on a 50K prefix across turns. The
pricing data proves those providers *bill* for cached input, and the wire capture proves the routing
config reaches them. Neither proves their cache holds a prefix that large between your requests. The
verification step above is how you find out; treat the discounts in the table as the best case until you
have measured your own.
