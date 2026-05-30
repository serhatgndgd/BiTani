"""
Normalize Turkish casing artifacts in medicationsV2 names.

Default mode is dry-run and never writes to the database.

Rules:
  - Only uppercase stuck-lowercase Turkish letters in ilac_adi and etkin_madde_adi.
  - ö->Ö, ü->Ü, ç->Ç, ş->Ş, ğ->Ğ, ı->I
  - Token must otherwise look uppercase; Title Case words like "Kaplı" are left alone.
  - Do not touch raw_text or any other columns.
  - Do not try to resolve ASCII I/İ ambiguity.

Apply:
  .venv/bin/python normalize_drug_names.py --apply --confirm-i-understand
"""
from __future__ import annotations

import argparse
import os
import time
import warnings
from typing import Any

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client

HERE = os.path.dirname(__file__)
PAGE = 1000
BATCH = 100
TARGET_COLUMNS = ("ilac_adi", "etkin_madde_adi")
LOWER_TR_CHARS = "öüçşğı"
TRANSLATION = str.maketrans({
    "ö": "Ö",
    "ü": "Ü",
    "ç": "Ç",
    "ş": "Ş",
    "ğ": "Ğ",
    "ı": "I",
})


def normalize_token(token: str) -> str:
    if not any(char in token for char in LOWER_TR_CHARS):
        return token
    without_target_chars = token.translate(str.maketrans("", "", LOWER_TR_CHARS))
    # "KAPSüL" and "ÇöZELTI" are artifacts; "Kaplı" is normal title casing.
    if any("a" <= char <= "z" for char in without_target_chars):
        return token
    return token.translate(TRANSLATION)


def normalize_name(value: str | None) -> str | None:
    if value is None:
        return None
    return " ".join(normalize_token(token) for token in value.split(" "))


def fetch_medications(sb: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        batch = (
            sb.table("medicationsV2")
            .select("id,ilac_adi,etkin_madde_adi")
            .order("id")
            .range(offset, offset + PAGE - 1)
            .execute()
            .data
            or []
        )
        rows.extend(batch)
        if len(batch) < PAGE:
            break
        offset += PAGE
    return rows


def build_changes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for row in rows:
        patch: dict[str, str | None] = {}
        before: dict[str, str | None] = {}
        after: dict[str, str | None] = {}
        for column in TARGET_COLUMNS:
            original = row.get(column)
            normalized = normalize_name(original)
            if normalized != original:
                before[column] = original
                after[column] = normalized
                patch[column] = normalized
        if patch:
            changes.append({
                "id": row["id"],
                "before": before,
                "after": after,
                "patch": patch,
            })
    return changes


def print_examples(changes: list[dict[str, Any]], limit: int = 20) -> None:
    print(f"\nÖrnek diff (ilk {min(limit, len(changes))}):")
    for index, change in enumerate(changes[:limit], 1):
        print(f"\n[{index}] id={change['id']}")
        before = change["before"]
        after = change["after"]
        for column in TARGET_COLUMNS:
            if column in before:
                print(f"  {column}:")
                print(f"    - {before[column]}")
                print(f"    + {after[column]}")


def apply_changes(sb: Any, changes: list[dict[str, Any]]) -> int:
    updated = 0
    for offset in range(0, len(changes), BATCH):
        batch = changes[offset:offset + BATCH]
        for change in batch:
            sb.table("medicationsV2").update(change["patch"]).eq("id", change["id"]).execute()
            updated += 1
        print(f"  Güncellendi: {updated}/{len(changes)}", end="\r", flush=True)
    if changes:
        print()
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize medicationsV2 Turkish casing artifacts.")
    parser.add_argument("--apply", action="store_true", help="Write normalized names to medicationsV2.")
    parser.add_argument(
        "--confirm-i-understand",
        action="store_true",
        help="Required together with --apply.",
    )
    args = parser.parse_args()

    if args.apply and not args.confirm_i_understand:
        raise SystemExit("GÜVENLİK: Yazmak için --apply --confirm-i-understand birlikte kullanılmalı.")

    load_dotenv(os.path.join(HERE, ".env"))
    sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

    started = time.time()
    mode = "APPLY" if args.apply else "DRY-RUN"
    print("=" * 60)
    print(f"{mode} — medicationsV2 ad casing normalizasyonu")
    print("=" * 60)
    print("Kural: ö→Ö ü→Ü ç→Ç ş→Ş ğ→Ğ ı→I")
    print("Dokunulan kolonlar: ilac_adi, etkin_madde_adi")
    print("raw_text ve diğer kolonlar okunmaz/yazılmaz.")

    rows = fetch_medications(sb)
    changes = build_changes(rows)
    print(f"\nTaranan satır: {len(rows)}")
    print(f"Değişecek satır: {len(changes)}")
    print_examples(changes)

    if not args.apply:
        print("\nDRY-RUN tamamlandı. Yazmak için:")
        print("  .venv/bin/python normalize_drug_names.py --apply --confirm-i-understand")
        print(f"Süre: {time.time() - started:.1f}s")
        return

    print("\nDB update başlıyor...")
    updated = apply_changes(sb, changes)
    print("=" * 60)
    print(f"TAMAMLANDI — güncellenen satır: {updated}")
    print(f"Süre: {time.time() - started:.1f}s")
    print("=" * 60)


if __name__ == "__main__":
    main()
