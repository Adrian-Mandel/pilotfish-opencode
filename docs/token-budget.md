# Token budget

Every request re-sends the whole system prompt and tool schemas. That block is the **prefix**, and for
a delegating orchestrator it is most of the bill. On a real install the `pilotfish` primary prefix
measured **51,426 tokens** — a session where the user typed `test` and got back "Hello!" billed 51,403.

Two things decide what that costs you: how many tool schemas ride along, and whether the provider
caches the prefix between turns. This document covers both, and marks what is measured versus inferred.

## Operating principles

Five facts that explain most of what you will observe. Everything else in this document follows from
them.

**An agent you never invoke costs nothing.** A prefix only exists once a request is sent. Nine
configured roles do not mean nine prefixes being paid for — they mean nine prefixes are *available* to
be paid for, and you are charged only for the ones you actually use. Adding a role to a profile is free
until something delegates to it.

**Caching works inside a session and mostly not across sessions.** Measured over 4,525 requests here:
the first request of a session is warm 18% of the time, later requests in the same session are warm
**93%** of the time, serving an average of 98,234 tokens from cache. There is no gap short enough to
rely on a fresh session starting warm — 20% warm under five minutes, 5% beyond an hour.

**Therefore every *fresh* delegation pays a cold start.** A new subagent invocation is a new session, so
it begins with a full-price prefix and only benefits from caching on its remaining turns. A subagent
that runs two turns pays roughly half its input at full price; one that runs nine turns pays an eighth.
Fewer, longer delegations are cheaper than many short ones — and a delegation continued through the
Task tool's `task_id` parameter is not a new session at all, so it lands in the warm 93% instead of the
cold 82%. The primary prompt now says when to continue a worker and when a fresh context is worth its
cold start; the router already authorized resumed Tasks, but no prompt had ever mentioned the parameter,
so effective policy was to start fresh every time.

**The provider decides whether any of this matters.** On OpenAI, 90% of context is served from cache.
On the OpenRouter endpoints price-routing selected, 19%. On a local LM Studio endpoint, 0%. The same
conversation costs about 5x more input on a non-caching endpoint, and no amount of prompt tuning
recovers that.

**Roles cannot share each other's cache.** Caching matches on prefix, and OpenCode assembles the system
message as `[agent prompt][shared boilerplate]`, so two roles diverge within the first few characters
and share nothing — despite the boilerplate behind them being identical. Nine roles on one model is
nine independent caches.

## How the numbers here were produced

Anything labelled **measured** was captured off the wire: OpenCode v1.18.16 pointed at a local
OpenAI-compatible endpoint that records the exact request body, in a sandbox
(`XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_STATE_HOME` isolated), with a stdio MCP server serving the real
44-tool GitHub MCP schemas. Reproduce it the same way if you want to re-check any figure.

Two methods that look authoritative but are **not**, both of which produced wrong answers here:

- `opencode debug agent <name>` prints a `tools` map, but **does not connect MCP servers**. It reports
  zero MCP tools for every agent, including agents that demonstrably call them. It cannot verify MCP
  scope in either direction.
- Reading the compiled binary's minified source. It got the mechanism right and the consequences wrong.

---

## 1. Tool scope

### The mechanism (measured)

Permission config is flattened into an ordered rule list, then matching tools are **removed from the
request schema entirely** — not blocked at call time. You can see the flattening with
`opencode debug agent build`:

```
"github_*": "deny"           ->  { permission: "github_*", pattern: "*",    action: "deny"  }
"read": { "*.env": "deny" }  ->  { permission: "read",     pattern: "*.env", action: "deny" }
```

A tool is dropped when the **last** rule matching its name has `pattern: "*"` and `action: "deny"`.
Four consequences, all confirmed on the wire:

1. **Only a bare string value can strip a tool.** `"github_*": "deny"` removes the schema.
   `"read": { "*.env": "deny" }` yields a rule whose pattern is not `"*"`, so `read` stays resident and
   is merely blocked when called. Nested rules restrict behaviour; string rules save money.
2. **Last match wins, so order matters.** Broad `deny` first, specific `allow` after.
3. **The key is glob-matched against the tool name**, and MCP tools are always `<server>_<tool>`.
   A server named `github` exposing `search_code` becomes `github_search_code`; `"github_*"` catches it.
   An exact-name rule must match the full doubled name — a rule for `search_code` alone matches nothing.
4. **Some tools are aliased.** A single `"edit": "allow"` puts both `edit` and `write` on the wire.
   `apply_patch` shares the same alias; `read_mcp_resource` and friends are governed by `read`.

Two smaller findings: `todowrite` is denied to subagents automatically unless their permission block
names it, so adding `"todowrite": "allow"` *costs* tokens rather than saving them. And denying `skill`
also shrinks the system prompt (702 chars in the sandbox), because the skill tool injects its catalogue.

### What it is worth (measured)

Four permission blocks, identical except as noted, each with the real 44-tool GitHub MCP attached:

| Config | Tools on wire | Tool-schema chars | Saving vs current |
|---|---|---|---|
| Current executor (`doom_loop`/`task` deny only) | 53 (44 MCP) | 69,551 | — |
| Closed scope, no MCP grant | 8 (0 MCP) | 14,559 | **13,748 tokens/request** |
| Closed scope + `"github_*": "allow"` | 52 (44 MCP) | 66,821 | 682 tokens/request |
| Open scope, GitHub narrowed to 8 tools | 17 (8 MCP) | 31,157 | **9,598 tokens/request** |

The third row is the escape hatch working exactly as intended: all 44 tools come back. The fourth is the
compromise — on the install measured, 8 of 44 GitHub tools accounted for 91% of ~899 calls.

### What Pilotfish ships

All eight **workers** now carry a closed scope. Previously only the four read-only ones did; the four
executors inherited everything, including whatever MCP servers the user happened to have, at
`steps: 250` for `security-executor`.

The `pilotfish` primary stays open on purpose — it is the agent you drive interactively, and silently
removing your MCP servers from your own session is not a token optimisation worth making. It is also
where most interactive MCP use happens (306 GitHub calls on the install measured).

```json
"executor": {
  "permission": {
    "*": "deny",
    "doom_loop": "deny",
    "task": "deny",
    "bash": "allow",
    "edit": "allow",
    "read": { "*": "allow", "*.env": "deny", "*.env.*": "deny", "*.env.example": "allow" },
    "glob": "allow",
    "grep": "allow",
    "list": "allow",
    "skill": "allow",
    "webfetch": "allow"
  }
}
```

This changes nothing outside Pilotfish. `build`, `plan`, `general` and your own agents are untouched,
because the scope lives inside the nine Pilotfish agent entries and nowhere else.

**It does change what Pilotfish workers can reach.** Do not assume a role is read-only on paper and
therefore MCP-free in practice — on the install measured, `verifier` made 289 GitHub calls, more than
`executor`, `mech-executor` and `security-executor` combined. The installer asks per server per role
rather than guessing; see `install/OPENCODE-INSTALL.md` Step 1.6 and Step 2.

Grant a server back by appending after the deny — whole server or named tools:

```json
"verifier": { "permission": { "github_search_code": "allow", "github_get_file_contents": "allow" } }
```

Check your own usage before choosing:

```bash
sqlite3 ~/.local/share/opencode/opencode.db "
SELECT s.agent, json_extract(p.data,'\$.tool') tool, COUNT(*) n
FROM part p JOIN session s ON s.id=p.session_id
WHERE json_extract(p.data,'\$.tool') LIKE 'github_%'
GROUP BY s.agent, tool ORDER BY n DESC;"
```

### Measuring your prefix

`debug agent` cannot do this. Use real traffic — one short turn, then:

```bash
sqlite3 ~/.local/share/opencode/opencode.db "SELECT data FROM message WHERE session_id='<id>' ORDER BY time_created LIMIT 2;" | python3 -c "import sys,json;[print((json.loads(l).get('tokens') or {})) for l in sys.stdin if l.strip()]"
```

On the first assistant message, `input + cache.read` is the prefix.

### Prefix as a portability constraint, not a cost one (measured)

Everything above prices the prefix in money, which is the right frame for a paid seat and the wrong
one for a free local worker. On a local seat the prefix costs no money at all. It costs three other
things, and two of them decide whether a configuration runs.

**Measured on this install, 2026-08-25.** First-message prefix per role, `input + cache.read`:

| role | prefix | note |
|---|---:|---|
| `pilotfish` (primary) | 39,245 | avg of 49 sessions, max 66,892 |
| `executor` | 34,024 | **pre-scope-closing; not re-measured since** |
| `verifier` | 33,549 | pre-scope-closing |
| `mech-executor` | 28,830 | **pre-scope-closing; not re-measured since** |
| `verifier` (after scope closing, bambi) | **20,907** | |
| `verifier` (after scope closing, gpt-5.6-sol) | 14,758-18,041 | |
| `Explore` | 5,800 -> 4,816 | before -> after |
| `plan-verifier` | 5,778 -> 4,491 | before -> after |
| `scout` | 5,006 -> 3,834 | before -> after |

Closing worker tool scope roughly halved the verifier, 33,549 -> ~21,000. `executor`,
`mech-executor` and `security-executor` have not run since that change, so their numbers above are
stale and the current values are unknown.

The gap between `verifier` (~21,000) and `plan-verifier` (~4,500) is the thing to look at. Both are
read-oriented verification roles on the same host. The difference is that `verifier` carries `bash`,
`skill`, and a whole-server `github_*` grant; the bash and skill schemas are small, so the MCP server
is most of a ~16,000-token gap — consistent with the 13,748 measured in §1.

**1. Portability — the constraint that decides whether a role runs at all.** A prefix is fixed
overhead subtracted from working memory before any work begins. What is left has to hold the diff,
the test output, and the files.

| verifier prefix | of a 204k model | of a 100k model | of a 32k model |
|---|---:|---:|---:|
| 33,549 (before) | 16% | 34% | **does not fit usefully** |
| 20,907 (now) | 10% | 21% | 65% |
| ~11,000 (narrowed MCP) | 5% | 11% | 34% |

Free local workers are this project's premise, and most local quants people actually run are 32k or
100k, not 200k. So prefix size decides which hardware can host a role — a premise-level constraint,
not an optimization. Nominal context is also generous: a 27B does not attend reliably across its
whole window, so the usable remainder is smaller than the arithmetic suggests.

**2. Cold-start latency.** Measured against `bambi/qwen3.8-27b-mtp-pure` on 2026-08-25: a 7,496-token
prefix on an already-warm model took 11.74s, and a 6,056-token one took 9.06s — **~640 tokens/sec of
prefill**. An identical prefix re-sent took 0.67s, so the KV cache is reused and repeat turns are
~17x cheaper in time.

At 640 tok/s a cold dispatch pays, before doing anything:

| prefix | cold prefill |
|---|---:|
| 4,500 (`plan-verifier`) | 7s |
| 13,748 (one MCP server) | 21s |
| 20,907 (`verifier` now) | 33s |
| 40,000 | 62s |

This is why session reuse matters more on a local seat than the cost argument in §1 implies: the
saving is seconds of wall clock per avoided cold start, not fractions of a cent.

**3. LM Studio does not report cache hits, and this is a reporting gap, not a caching failure.** Its
OpenAI-compatible response omits `prompt_tokens_details` entirely, so `tokens.cache.read` is recorded
as 0 for every bambi session and a naive read of the database says "0% cached". The 17x timing above
proves the cache is working. `omlx` does emit the field and shows an 87% hit rate. Do not conclude a
local server is uncached from the database alone — time two identical requests instead.

### Proposed budgets, and where this install actually stands

Stated as a target because nothing currently measures or enforces it, and because the numbers below
are a proposal rather than a finding:

- **read-only roles: under 6,000.** `scout` (3,834) and `plan-verifier` (4,491) are already there.
- **write and verify roles: under 12,000.** Nothing is there yet. `verifier` is at ~21,000, and
  `executor`, `mech-executor` and `security-executor` are unmeasured since scope closing.

The basis for 12,000 is portability, not taste: it is ~12% of a 100k model and ~37% of a 32k one,
which leaves a working majority of the window for the actual task. 6,000 is the same test applied to
roles that only read. Both should be re-derived if the target hardware changes.

Measure with the snippet above, per role, after a restart. It is one number, it is cheap, and right
now nothing reports it — so a configuration can quietly stop fitting the hardware it was chosen for.

---

## 2. OpenRouter caching

Not an install step — Pilotfish never writes your `provider` block. This is yours, and for a
large-prefix agent it matters more than tool trimming.

### Why it currently fails

**OpenCode sends no cache markers for these models.** The captured OpenRouter request body contains no
`cache_control` anywhere. Caching therefore depends entirely on the upstream provider doing automatic
prefix caching — and **OpenRouter routes by price by default, where the cheapest endpoints are
frequently the ones that do not cache at all.**

Verified from `openrouter.ai/api/v1/models/<id>/endpoints`, 2026-08-11:

| `qwen/qwen3.6-27b` | $/M in | cached | discount |
|---|---|---|---|
| Morph | 0.289 | — | **none** |
| **Chutes** | 0.300 | 0.030 | **10x** |
| SiliconFlow | 0.300 | — | **none** |
| Io Net | 0.310 | 0.190 | 1.6x |
| DeepInfra | 0.320 | — | **none** |
| Phala | 0.320 | 0.150 | 2.1x |
| Venice | 0.325 | — | **none** |

The four cheapest do not cache; Chutes does, at 10x off, and price-sorting skips it. Same story on
`qwen3.6-35b-a3b`, where Venice (0.098) and DeepInfra (0.100) have no cache, and AtlasCloud and
CoreWeave list a cached price **identical to their uncached rate** — a listed cache price is not
automatically a discount.

DeepSeek is the opposite: every `v4-pro` endpoint and 26 of 27 `v4-flash-0731` endpoints price cached
input, and the first-party endpoint is by far the best of them.

| Model | Pin to | $/M in | cached | discount |
|---|---|---|---|---|
| `qwen/qwen3.6-27b` | `chutes`, `phala` | 0.300 | 0.030 | 10x |
| `qwen/qwen3.6-35b-a3b` | `akashml`, `parasail` | 0.140 | 0.050 | 2.8x |
| `deepseek/deepseek-v4-pro` | `deepseek`, `streamlake` | 0.435 | 0.0036 | **120x** |
| `deepseek/deepseek-v4-flash-0731` | `deepseek`, `decart` | 0.140 | 0.0028 | **50x** |

### The config (measured working)

OpenCode forwards this block verbatim as the `provider` field of the OpenRouter request body —
confirmed by capturing the wire payload. In your own `opencode.json`:

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
        "options": { "provider": { "order": ["deepseek", "streamlake"], "allow_fallbacks": false } }
      },
      "deepseek/deepseek-v4-flash-0731": {
        "options": { "provider": { "order": ["deepseek", "decart"], "allow_fallbacks": false } }
      }
    }
  }
}
```

Use the **plain provider slug**, not the endpoint tag. The endpoints API reports tags like `chutes/fp8`,
but `order` takes slugs; all of the above are confirmed against the 102-entry list at
`openrouter.ai/api/v1/providers`. Quantization is a separate `quantizations` field, not a slug suffix.

`allow_fallbacks: false` is the point — `true` lets OpenRouter drop back to a cheap uncached endpoint,
which is the failure being fixed. Two entries keep one outage from hard-failing the request.

Account-wide defaults live at `openrouter.ai/settings/privacy` if you would rather not per-model it.

### Verify it

Re-check the endpoint economics before trusting any of the tables above — pricing moves:

```bash
curl -s https://openrouter.ai/api/v1/models/qwen/qwen3.6-27b/endpoints | python3 -c "
import sys,json
for e in json.load(sys.stdin)['data']['endpoints']:
    p=e['pricing']; cr=p.get('input_cache_read')
    print(f\"{e['provider_name']:16} {float(p['prompt'])*1e6:>8.4f}/M  cached={float(cr)*1e6 if cr else None}\")"
```

Then confirm cache reads are actually landing: run several turns on one session and check that
`cache.read` is non-zero on turns after the first. **This last step is the one thing here I have not
verified for you** — the pricing tables prove these providers *bill* for cached input, not that a 50K
prefix will hit their cache across turns. Measure before believing it.

---

## Not worth doing

- **Reverting the all-profiles preset.** 24 -> 64 clones is roughly +1,700 tokens/request, and a
  pre-change session already measured a 54,813 prefix. ~3% of the problem.
- **Chasing `tokens_cache_write == 0`.** It is 0 on an OpenAI session hitting cache 97.2% of the time.
  Implicit caches carry no write charge; the field proves nothing.
- **Treating fan-out resend as a bug.** A scout climbing 4,957 -> 16,023 over 8 turns, or jumping 46K
  after reading 143KB of files, is the agent working. Quadratic resend is inherent to delegation;
  caching is what makes it affordable.
