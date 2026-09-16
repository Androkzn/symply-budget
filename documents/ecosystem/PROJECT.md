# Symply Ecosystem — what this project is

| Term | Meaning |
|------|---------|
| **Symply Ecosystem** | The **project / platform** (this Cursor repo). One codebase for all Symply apps. |
| **Symply House** | **Parent / template app** — reference brand + shared screens others inherit from |
| **Sibling apps** | Symply Budget, Life, Language, Health — same platform, own brand pack + features |
| **`apps/_ecosystem/`** | Docs for **shared** contracts (Shared User, Smart Engine, Worker) — not a storefront app |
| **Legacy donors** | Old Swift / RN repos kept **beside** this repo for reference only — never Cursor platform roots |

```text
Symply Ecosystem          ← project (this Cursor repo)
│
├── shared code             src/, backend/, ios/ Widget+Watch
├── shared contracts docs   documents/apps/_ecosystem/
│
└── apps (storefront)
    ├── Symply House        ← PARENT / TEMPLATE (brands/symply-house/)
    ├── Symply Budget
    ├── Symply Kaizen
    ├── Symply Language
    └── Symply Health
```

**Not** “the SimpleHouse project with other apps bolted on.”  
**Yes** “Symply Ecosystem, with Symply House as the template member.”

Local Xcode (House / Budget / Kaizen): [XCODE_LOCAL.md](./XCODE_LOCAL.md)

---

## Disk layout (umbrella folder)

Legacy apps live next to the platform repo for convenience. Product brand spelling is **Symply**; some Desktop folder names still say **Simply** — that is fine; do not rename mid-migration unless you update every path below.

```text
~/Desktop/Symply Ecosystem/                 ← umbrella (not a git root)
├── Simply Ecosystem/                       ← PLATFORM — open this in Cursor
│   ├── src/  backend/  brands/  documents/
│   └── …                                   (this repo)
├── Simply Health/                          ← legacy donor (Swift) → simple-health
├── Simply Language/                        ← legacy donor (Swift) → simple-language
└── Simply Kaizen/                          ← legacy donor (RN) → symply-kaizen
    └── symply-kaizen/
```

| Role | Open in Cursor? | Path |
|------|-----------------|------|
| Platform / all ecosystem work | **Yes — only this** | `…/Symply Ecosystem/Simply Ecosystem/` |
| Health donor | Reference / read-only | `…/Simply Health/` |
| Language donor | Reference / read-only | `…/Simply Language/` |
| Life / Kaizen donor | Reference / read-only | `…/Simply Kaizen/symply-kaizen/` |

**Rules**

1. Implement features **in the platform repo** (`brands/<id>/` + `src/features/…`), not inside donor trees.
2. Donors are inventories + design/token reference until sunset — see [MIGRATION.md](./MIGRATION.md).
3. Do not add a mega multi-root Cursor workspace for shared edits; one platform root keeps AI context clean.
4. Long-running app programmes (`house-v2`, `budget-v2`, `health-v2`, …) each live in **their own clone** of this repo. That is still the platform — not a donor. Git and deploy rules: [BRANCHING.md](./BRANCHING.md). Only the `main` checkout deploys.

**GitHub:** [`Androkzn/symply-ecosystem`](https://github.com/Androkzn/symply-ecosystem)  
**Agent access / deploy:** [SERVICES.md](./SERVICES.md) · **Git:** [BRANCHING.md](./BRANCHING.md) (`main` is the only deploy source; `<app>-v2` clones never deploy) · root [AGENTS.md](../../AGENTS.md) / [CLAUDE.md](../../CLAUDE.md) / [CODEX.md](../../CODEX.md)  
Registry: [FLEET.md](./FLEET.md) · Join order: [MIGRATION.md](./MIGRATION.md)

**Ignore in-repo:** `_archive/` (legacy Expo scaffold + sample PDFs) — not product code.
