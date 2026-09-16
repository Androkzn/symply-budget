#!/usr/bin/env python3
"""Inject a brand-guard BUILD pre-action into each per-brand Xcode scheme (idempotent).

Picking "SymplyBudget-Production" then fails the build with a clear message if the
native tree is prepared for a different brand — instead of silently building the wrong
one. The guard itself is scripts/ios/guard-brand.sh (safe: exits 0 on any ambiguity)."""
import re
import sys
from pathlib import Path

SCHEMES_DIR = Path(__file__).resolve().parents[2] / "ios/SymplyEcosystem.xcodeproj/xcshareddata/xcschemes"

BRANDS = {
    "SymplyHouse": "symply-house",
    "SymplyBudget": "symply-budget",
    "SymplyKaizen": "symply-kaizen",
    "SymplyLanguage": "symply-language",
    "SymplyHealth": "symply-health",
}


def brand_for(name: str):
    for prefix, bid in BRANDS.items():
        if name.startswith(prefix):
            return bid
    return None


def preactions_block(blueprint_id: str, brand_id: str) -> str:
    script = f"&quot;$SRCROOT/../scripts/ios/guard-brand.sh&quot; {brand_id}&#10;"
    return (
        "      <PreActions>\n"
        "         <ExecutionAction\n"
        '            ActionType = "Xcode.IDEStandardExecutionActionsCore.ExecutionActionType.ShellScriptAction">\n'
        "            <ActionContent\n"
        '               title = "Guard: native brand matches scheme"\n'
        f'               scriptText = "{script}">\n'
        "               <EnvironmentBuildable>\n"
        "                  <BuildableReference\n"
        '                     BuildableIdentifier = "primary"\n'
        f'                     BlueprintIdentifier = "{blueprint_id}"\n'
        '                     BuildableName = "SymplyEcosystem.app"\n'
        '                     BlueprintName = "SymplyEcosystem"\n'
        '                     ReferencedContainer = "container:SymplyEcosystem.xcodeproj">\n'
        "                  </BuildableReference>\n"
        "               </EnvironmentBuildable>\n"
        "            </ActionContent>\n"
        "         </ExecutionAction>\n"
        "      </PreActions>\n"
    )


changed, skipped = 0, 0
for scheme in sorted(SCHEMES_DIR.glob("*.xcscheme")):
    brand_id = brand_for(scheme.stem)
    if not brand_id:
        continue  # non-brand schemes (SymplyEcosystem, widget, watch)
    text = scheme.read_text()
    if "guard-brand.sh" in text:
        skipped += 1
        continue
    m = re.search(r'BlueprintIdentifier = "([0-9A-F]+)"\s+BuildableName = "SymplyEcosystem\.app"', text)
    if not m:
        print(f"  ! no SymplyEcosystem.app buildable in {scheme.name} — skipped")
        continue
    blueprint_id = m.group(1)
    # Insert PreActions right after the <BuildAction ...> opening tag.
    new_text, n = re.subn(
        r'(<BuildAction\b[^>]*>\n)',
        r"\1" + preactions_block(blueprint_id, brand_id),
        text,
        count=1,
    )
    if n != 1:
        print(f"  ! could not locate <BuildAction> in {scheme.name}")
        continue
    scheme.write_text(new_text)
    print(f"  ✓ {scheme.name} → guard {brand_id}")
    changed += 1

print(f"\nDone: {changed} scheme(s) guarded, {skipped} already had a guard.")
if changed == 0 and skipped == 0:
    sys.exit("No brand schemes matched — check SCHEMES_DIR")
