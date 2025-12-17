# -*- coding: utf-8 -*-
"""
Google Sheets (CSV) -> Playbook JSON dönüştürücü (index-temelli Option Info/Pros/Cons)

Beklenen başlıklar (case-insensitive):
StepID, ParentID, Başlık, Açıklama, Seçenekler, Kaynak/Link,
GörünürEğer, Seçenek Info, Seçenek Pros, Seçenek Cons, Terimler

- Seçenekler: "A | B | C" ya da "[A, B, C]"
- Seçenek Info: "infoA || infoB || infoC"
- Seçenek Pros: "p1; p2 || p1; p2 || p1"  (madde ayırıcı ';')
- Seçenek Cons: "c1; c2 || c1; c2 || c1"
- Terimler: "Shopify: ... || WooCommerce: ..."
"""

import argparse, csv, json, sys

# ---------- yardımcılar ----------
def norm(s): return (s or "").strip()

def parse_options_cell(s: str):
    s = norm(s)
    if not s: return []
    if s.startswith("[") and s.endswith("]"):
        s = s[1:-1]
    s = s.replace("|", ",")
    out = []
    for part in [p.strip() for p in s.split(",") if p.strip()]:
        low = part.lower()
        # güvenlik: yanlışlıkla "pros:" / "cons:" gibi önekler options'a düşmüşse at
        if low.startswith(("pros:", "cons:", "info:", "artı:", "arti:", "eksı:", "eksi:")):
            continue
        out.append(part)
    return out

def parse_links_cell(s: str):
    s = norm(s)
    if not s: return []
    s = s.replace("|", ",")
    return [p.strip() for p in s.split(",") if p.strip()]

def split_groups(s: str):
    s = norm(s)
    if not s: return []
    return [g.strip() for g in s.split("||") if g.strip()]

def split_bullets(s: str):
    s = norm(s)
    if not s: return []
    low = s.lower()
    for pref in ("pros:", "cons:", "artılar:", "artilar:", "artı:", "arti:",
                 "eksiler:", "eksi:", "info:", "bilgi:", "nedir:"):
        if low.startswith(pref):
            s = s[len(pref):].strip()
            break
    s = s.replace("|", ";").replace(",", ";")
    return [x.strip(" -•\t") for x in s.split(";") if x.strip(" -•\t")]

def parse_glossary_cell(s: str):
    s = norm(s)
    if not s: return {}
    out = {}
    for seg in [x.strip() for x in s.split("||") if x.strip()]:
        if ":" in seg:
            term, desc = seg.split(":", 1)
            out[norm(term)] = norm(desc)
        else:
            out[norm(seg)] = ""
    return out

# ---------- ana akış ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True)
    ap.add_argument("--model", dest="model_name", required=True)
    ap.add_argument("--out", dest="out_path", default=None)
    args = ap.parse_args()

    with open(args.in_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print("CSV başlıkları okunamadı.", file=sys.stderr); sys.exit(1)

        # case-insensitive başlık haritası
        headers = {h.lower(): h for h in reader.fieldnames}
        def col(*names):
            for n in names:
                if n.lower() in headers: return headers[n.lower()]
            return None

        c_step   = col("StepID","stepid")
        c_parent = col("ParentID","parentid")
        c_title  = col("Başlık","Baslik","title")
        c_desc   = col("Açıklama","Aciklama","desc")
        c_opts   = col("Seçenekler","Secenekler","options")
        c_links  = col("Kaynak/Link","Kaynak","Link")
        c_vis    = col("GörünürEğer","GorunurEger","Görünür","VisibleIf","visibleif")
        c_info   = col("Seçenek Info","Secenek Info","Option Info","Options Info")
        c_pros   = col("Seçenek Pros","Secenek Pros","Option Pros","Options Pros","Seçenek Artılar","Secenek Artilar")
        c_cons   = col("Seçenek Cons","Secenek Cons","Option Cons","Options Cons","Seçenek Eksiler","Secenek Eksiler")
        c_terms  = col("Terimler","Sözlük","Sozluk","Glossary")

        needed = [c_step, c_parent, c_title, c_desc, c_opts, c_links]
        if any(x is None for x in needed):
            print("Eksik zorunlu kolon var.", file=sys.stderr); sys.exit(1)

        steps = []
        for r in reader:
            sid_raw = norm(r.get(c_step, ""))
            if not sid_raw: continue
            try:
                sid = int(sid_raw)
            except:  # StepID başlık satırı/boş satır vs.
                continue

            pid_raw = norm(r.get(c_parent, ""))
            try:
                pid = int(pid_raw) if pid_raw else 0
            except:
                pid = 0

            options = parse_options_cell(r.get(c_opts, ""))
            links   = parse_links_cell(r.get(c_links, ""))
            visible_if = norm(r.get(c_vis, "")) if c_vis else ""
            glossary   = parse_glossary_cell(r.get(c_terms, "")) if c_terms else {}

            # Info/Pros/Cons -> options ile index’e göre eşle
            info_groups = split_groups(r.get(c_info, "")) if c_info else []
            pros_groups = split_groups(r.get(c_pros, "")) if c_pros else []
            cons_groups = split_groups(r.get(c_cons, "")) if c_cons else []

            option_details = {}
            for i, label in enumerate(options):
                info_i = info_groups[i] if i < len(info_groups) else ""
                pros_i = split_bullets(pros_groups[i]) if i < len(pros_groups) else []
                cons_i = split_bullets(cons_groups[i]) if i < len(cons_groups) else []
                if any([info_i, pros_i, cons_i]):
                    option_details[label] = {"info": info_i, "pros": pros_i, "cons": cons_i}

            steps.append({
                "id": sid,
                "parentId": pid,
                "title": norm(r.get(c_title, "")),
                "description": norm(r.get(c_desc, "")),
                "options": options,
                "links": links,
                "visibleIf": visible_if,
                "optionDetails": option_details,
                "glossary": glossary
            })

    steps.sort(key=lambda x: x["id"])
    data = {"model": args.model_name, "steps": steps}
    out = args.out_path or f"public/data/{args.model_name.lower().replace(' ','_')}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print("Yazıldı:", out)

if __name__ == "__main__":
    main()
