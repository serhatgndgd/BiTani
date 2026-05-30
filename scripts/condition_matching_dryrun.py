"""
ADIM 2 — KURAL BAZLI EŞLEŞTİRME DRY-RUN.  DB'YE YAZMAZ, sadece rapor.

Akış:
  1) medication_kub.therapeutic_indications + medication_kt.section_1_nedir
     tüm tablo çekilir, medication_id ile eşlenir.
  2) condition_matcher.Matcher ile 71 hastalık × sinonim aranır.
  3) Rapor: toplam eşleşme, hastalık dağılımı, kapsanan hastalık sayısı,
     10 örnek eşleşme, en şüpheli 5 eşleşme.

Çalıştır:  .venv/bin/python condition_matching_dryrun.py
Çıktı:     stdout + scripts/condition_matching_dryrun.txt
"""
from __future__ import annotations
import os, time, warnings
from collections import defaultdict

warnings.filterwarnings("ignore")
from dotenv import load_dotenv
from supabase import create_client
from condition_matcher import Matcher

HERE = os.path.dirname(__file__)
load_dotenv(os.path.join(HERE, ".env"))
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

OUTPUT = os.path.join(HERE, "condition_matching_dryrun.txt")
PAGE = 1000

lines_out: list[str] = []
def out(s: str = "") -> None:
    print(s)
    lines_out.append(s)


def fetch_all(table: str, col: str) -> dict[str, str]:
    """{medication_id: text} — sadece dolu kayıtlar."""
    acc: dict[str, str] = {}
    offset = 0
    while True:
        r = (sb.table(table).select(f"medication_id,{col}")
             .not_.is_(col, "null").order("medication_id")
             .range(offset, offset + PAGE - 1).execute())
        rows = r.data or []
        if not rows:
            break
        for row in rows:
            mid = row["medication_id"]
            val = row.get(col)
            if mid and val:
                acc[mid] = val
        offset += PAGE
        print(f"  {table}.{col}: {len(acc)}", end="\r", flush=True)
    print()
    return acc


t0 = time.time()
out("=" * 76)
out("ADIM 2 — İLAÇ ↔ HASTALIK KURAL BAZLI EŞLEŞTİRME (DRY-RUN)")
out("=" * 76)
out(f"Tarih: {time.strftime('%Y-%m-%d %H:%M:%S')}  |  DB'ye YAZMA YOK")
out()

# ── Kaynak metinler ──────────────────────────────────────────────────
out("Kaynak metinler çekiliyor…")
kub = fetch_all("medication_kub", "therapeutic_indications")
kt  = fetch_all("medication_kt", "section_1_nedir")
all_mids = set(kub) | set(kt)
out(f"  KÜB therapeutic_indications dolu : {len(kub):>6}")
out(f"  KT  section_1_nedir dolu         : {len(kt):>6}")
out(f"  Birleşik benzersiz ilaç          : {len(all_mids):>6}")
out()

# ── ilac_adi (örnekler için) ─────────────────────────────────────────
name_map: dict[str, str] = {}
offset = 0
while True:
    r = sb.table("medicationsV2").select("id,ilac_adi").order("id").range(offset, offset + PAGE - 1).execute()
    rows = r.data or []
    if not rows:
        break
    for row in rows:
        name_map[row["id"]] = row.get("ilac_adi") or ""
    offset += PAGE

# ── Eşleştirme ───────────────────────────────────────────────────────
matcher = Matcher()
cond_name = {cid: matcher.conditions[cid]["name"] for cid in matcher.conditions}

out("Eşleştiriliyor…")
matches: list[dict] = []          # {cid, mid, conf, evidence}
per_condition: dict[str, int] = defaultdict(int)
t1 = time.time()
done = 0
for mid in all_mids:
    res = matcher.match(kt.get(mid), kub.get(mid))
    for cid, (conf, ev) in res.items():
        matches.append({"cid": cid, "mid": mid, "conf": conf, "evidence": ev})
        per_condition[cid] += 1
    done += 1
    if done % 1000 == 0:
        print(f"  {done}/{len(all_mids)}  ({time.time()-t1:.0f}s)", end="\r", flush=True)
print()

total = len(matches)
covered = sum(1 for cid in matcher.conditions if per_condition.get(cid, 0) > 0)

# ── A) Genel ─────────────────────────────────────────────────────────
out()
out("=" * 76)
out("A) GENEL İSTATİSTİK")
out("=" * 76)
out(f"  Toplam (hastalık, ilaç) eşleşmesi : {total:>7}")
out(f"  Eşleşmesi olan benzersiz ilaç     : {len({m['mid'] for m in matches}):>7}")
out(f"  En az 1 eşleşmesi olan hastalık   : {covered} / 71")
zero = [cond_name[cid] for cid in matcher.conditions if per_condition.get(cid, 0) == 0]
out(f"  SIFIR eşleşme hastalık ({len(zero)}): {', '.join(zero) if zero else '—'}")
if total:
    confs = [m["conf"] for m in matches]
    out(f"  confidence  min/ort/max          : {min(confs):.2f} / {sum(confs)/len(confs):.2f} / {max(confs):.2f}")

# ── B) Hastalık dağılımı ─────────────────────────────────────────────
out()
out("=" * 76)
out("B) HASTALIK BAZINDA DAĞILIM (tümü, çoktan aza)")
out("=" * 76)
ranked = sorted(matcher.conditions, key=lambda c: per_condition.get(c, 0), reverse=True)
out(f"  {'#':>3}  {'Eşleşme':>8}  Hastalık")
out("  " + "-" * 60)
for i, cid in enumerate(ranked, 1):
    out(f"  {i:>3}  {per_condition.get(cid,0):>8}  {cond_name[cid]}")

# ── C) En çok / en az ────────────────────────────────────────────────
out()
out("=" * 76)
out("C) UÇLAR")
out("=" * 76)
out("  ── En çok eşleşen 5 ──")
for cid in ranked[:5]:
    out(f"     {per_condition.get(cid,0):>6}  {cond_name[cid]}")
nonzero_ranked = [c for c in ranked if per_condition.get(c, 0) > 0]
out("  ── En az eşleşen 5 (sıfır hariç) ──")
for cid in nonzero_ranked[-5:]:
    out(f"     {per_condition.get(cid,0):>6}  {cond_name[cid]}")

# ── D) 10 örnek eşleşme (gözle kontrol) ──────────────────────────────
out()
out("=" * 76)
out("D) 10 ÖRNEK EŞLEŞME (çeşitli hastalıklardan, gözle kontrol)")
out("=" * 76)
# çeşitlilik için farklı hastalıklardan örnek topla
seen_cond: set[str] = set()
samples: list[dict] = []
for m in matches:
    if m["cid"] not in seen_cond:
        seen_cond.add(m["cid"])
        samples.append(m)
    if len(samples) >= 10:
        break
for m in samples:
    out(f"\n  ▸ {cond_name[m['cid']]}  (conf={m['conf']})")
    out(f"    İlaç : {name_map.get(m['mid'], m['mid'])[:60]}")
    out(f"    Kanıt: {m['evidence'][:240]}")

# ── E) En şüpheli 5 ──────────────────────────────────────────────────
out()
out("=" * 76)
out("E) EN ŞÜPHELİ 5 EŞLEŞME (düşük conf + kısa/muğlak kanıt)")
out("=" * 76)
def suspicion(m: dict) -> float:
    # düşük confidence + kısa kanıt → yüksek şüphe
    ev_len = len(m["evidence"])
    return (1 - m["conf"]) * 100 + max(0, 120 - ev_len) * 0.5
suspicious = sorted(matches, key=suspicion, reverse=True)[:5]
for m in suspicious:
    out(f"\n  ⚠ {cond_name[m['cid']]}  (conf={m['conf']})")
    out(f"    İlaç : {name_map.get(m['mid'], m['mid'])[:60]}")
    out(f"    Kanıt: {m['evidence'][:240]}")

out()
out("=" * 76)
out(f"DRY-RUN tamamlandı  ({time.time()-t0:.1f}s)  —  DB'ye HİÇBİR yazma yapılmadı.")
out("Apply için: condition_matching_apply.py (ayrı onay gerekir).")
out("=" * 76)

with open(OUTPUT, "w", encoding="utf-8") as f:
    f.write("\n".join(lines_out) + "\n")
print(f"\nRapor: {OUTPUT}")
