from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pypdf

ROOT = Path(__file__).resolve().parent.parent
GOALS_PATH = ROOT / "data" / "goals.json"
OUT_PATH = ROOT / "data" / "suggestions.json"

PDF_GROUPS = {
    "Nederlands en communicatie": [
        "Opstap_visie-Ned_com.pdf",
        "Ned_com_Bijlage_1 (1).pdf",
        "Ned_com_Bijlage_2.pdf",
    ],
    "Wetenschap en techniek": [
        "Opstap_visie-W_T.pdf",
        "W_T_Bijlage_1.pdf",
        "W_T_Bijlage_2.pdf",
        "W_T_Bijlage_3.pdf",
    ],
    "Wiskunde": [
        "Opstap_visie-wiskunde.pdf",
        "Wiskunde_Bijlage_1.pdf",
        "Wiskunde_Bijlage_2.pdf",
    ],
}

STOPWORDS = {
    "de",
    "het",
    "een",
    "en",
    "of",
    "in",
    "op",
    "te",
    "met",
    "van",
    "voor",
    "door",
    "bij",
    "aan",
    "als",
    "dat",
    "die",
    "dit",
    "deze",
    "zijn",
    "haar",
    "hun",
    "kan",
    "kunnen",
    "wordt",
    "worden",
    "ook",
    "nog",
    "niet",
    "wel",
    "dan",
    "naar",
    "uit",
    "onder",
    "tussen",
    "rond",
    "hier",
    "nu",
    "leerling",
    "leerlingen",
    "discipline",
    "doel",
    "doelen",
    "fase",
}

NOISY_PATTERNS = (
    "katholiek onderwijs vlaanderen",
    "projectteam nieuw leerplan",
    "2026-01-30",
    "inhoud",
    "inhoudsopgave",
    "bijlage",
    "visietekst",
)


@dataclass
class Fragment:
    text: str
    source_pdf: str
    terms: set[str]



def norm_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()



def text_terms(text: str) -> set[str]:
    words = re.findall(r"[a-zà-ÿ0-9-]+", text.lower())
    return {
        w
        for w in words
        if len(w) >= 4
        and w not in STOPWORDS
        and not w.isdigit()
        and not re.search(r"\d", w)
    }



def child_word_ok(word: str) -> bool:
    w = word.lower().strip()
    if len(w) < 3 or len(w) > 12:
        return False
    if w in STOPWORDS:
        return False
    if re.search(r"\d", w):
        return False
    if w.endswith(("heid", "atie", "ering", "isme", "schap", "lijk")):
        return False
    if w in {"modeling", "transfer", "expliciet", "didactisch", "concepten", "ondersteuning"}:
        return False
    return True



def parse_vocab_list(text: str) -> list[str]:
    parts = []
    for part in re.split(r"[,;\n]", text or ""):
        p = part.strip().lower()
        p = re.sub(r"\s+", " ", p)
        if not p:
            continue
        words = p.split()
        if len(words) > 3:
            continue
        if all(child_word_ok(w) for w in words):
            parts.append(p)
    return parts



def split_sentences(text: str) -> list[str]:
    text = text.replace("•", ". ")
    text = text.replace("…", ". ")
    chunks = re.split(r"(?<=[.!?])\s+", norm_ws(text))
    out = []
    for c in chunks:
        s = c.strip(" -")
        if len(s) < 40 or len(s) > 260:
            continue
        lower = s.lower()
        if any(p in lower for p in NOISY_PATTERNS):
            continue
        if lower.count(".") > 4:
            continue
        if re.fullmatch(r"[0-9 .-]+", s):
            continue
        out.append(s)
    return out



def load_pdf_fragments() -> dict[str, list[Fragment]]:
    out: dict[str, list[Fragment]] = {}
    for vak, pdfs in PDF_GROUPS.items():
        fragments: list[Fragment] = []
        for pdf in pdfs:
            path = ROOT / pdf
            reader = pypdf.PdfReader(str(path))
            for page in reader.pages:
                text = page.extract_text() or ""
                for sentence in split_sentences(text):
                    terms = text_terms(sentence)
                    if len(terms) < 3:
                        continue
                    fragments.append(Fragment(text=sentence, source_pdf=pdf, terms=terms))
        out[vak] = fragments
    return out



def load_goals() -> list[dict]:
    with GOALS_PATH.open(encoding="utf-8") as f:
        payload = json.load(f)
    return payload["doelen"]



def query_terms(goal: dict) -> set[str]:
    q = " ".join(
        [
            goal.get("leerplandoel", ""),
            goal.get("domein", ""),
            goal.get("subdomein", ""),
            goal.get("cluster", ""),
            goal.get("voorbeelden", ""),
        ]
    )
    return text_terms(q)



def best_fragments(goal: dict, fragments: list[Fragment], n: int = 3) -> list[Fragment]:
    q = query_terms(goal)
    if not q:
        return []
    scored: list[tuple[float, Fragment]] = []
    for fr in fragments:
        overlap = q & fr.terms
        if not overlap:
            continue
        score = float(len(overlap))
        low = fr.text.lower()
        if "leer" in low or "didact" in low or "ondersteun" in low:
            score += 0.3
        if goal.get("cluster", "").lower() and goal["cluster"].lower() in low:
            score += 0.4
        if goal.get("subdomein", "").lower() and goal["subdomein"].lower() in low:
            score += 0.4
        scored.append((score, fr))

    scored.sort(key=lambda x: x[0], reverse=True)
    picked: list[Fragment] = []
    seen = set()
    for _, fr in scored:
        key = fr.text[:120]
        if key in seen:
            continue
        seen.add(key)
        picked.append(fr)
        if len(picked) >= n:
            break
    return picked



def build_vocab_indices(goals: list[dict]):
    by_vak: dict[str, Counter[str]] = defaultdict(Counter)
    by_nrmd: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    by_md: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    by_sub_cluster: dict[tuple[str, str, str], Counter[str]] = defaultdict(Counter)
    by_sub: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    by_cluster: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)

    for g in goals:
        vocab = parse_vocab_list(g.get("woordenschat", ""))
        if not vocab:
            continue
        vak = g.get("vak", "")
        for term in vocab:
            by_vak[vak][term] += 1
            if g.get("nrmd"):
                by_nrmd[(vak, g["nrmd"])][term] += 1
            if g.get("md"):
                by_md[(vak, g["md"])][term] += 1
            by_sub_cluster[(vak, g.get("subdomein", ""), g.get("cluster", ""))][term] += 1
            by_sub[(vak, g.get("subdomein", ""))][term] += 1
            by_cluster[(vak, g.get("cluster", ""))][term] += 1

    return {
        "by_vak": by_vak,
        "by_nrmd": by_nrmd,
        "by_md": by_md,
        "by_sub_cluster": by_sub_cluster,
        "by_sub": by_sub,
        "by_cluster": by_cluster,
    }



def related_vocab(goal: dict, vocab_index: dict) -> list[str]:
    own = parse_vocab_list(goal.get("woordenschat", ""))
    if own:
        return list(dict.fromkeys(own))[:12]

    vak = goal.get("vak", "")
    candidates = Counter()

    nrmd = goal.get("nrmd", "")
    md = goal.get("md", "")
    sub = goal.get("subdomein", "")
    cluster = goal.get("cluster", "")

    weights = [
        (vocab_index["by_nrmd"].get((vak, nrmd), Counter()), 1.00),
        (vocab_index["by_md"].get((vak, md), Counter()), 0.90),
        (vocab_index["by_sub_cluster"].get((vak, sub, cluster), Counter()), 0.80),
        (vocab_index["by_sub"].get((vak, sub), Counter()), 0.55),
        (vocab_index["by_cluster"].get((vak, cluster), Counter()), 0.55),
        (vocab_index["by_vak"].get(vak, Counter()), 0.15),
    ]
    for cnt, weight in weights:
        for term, freq in cnt.items():
            candidates[term] += freq * weight

    # Term moet inhoudelijk passen bij het leerdoel (woordoverlap op stamniveau)
    q_terms = query_terms(goal)

    def stem(w: str) -> str:
        s = w.lower().strip()
        for suf in ("en", "s", "e"):
            if len(s) > 4 and s.endswith(suf):
                return s[: -len(suf)]
        return s

    q_stems = {stem(w) for w in q_terms}

    ranked = []
    for term, score in candidates.items():
        words = [w for w in term.split() if child_word_ok(w)]
        if not words:
            continue
        if q_stems:
            if not any(stem(w) in q_stems or any(stem(w) in qs or qs in stem(w) for qs in q_stems) for w in words):
                # Als er geen duidelijke relatie is, skip.
                continue
        ranked.append((score, term))

    ranked.sort(reverse=True)
    unique = []
    seen = set()
    for _, term in ranked:
        if term in seen:
            continue
        seen.add(term)
        unique.append(term)
        if len(unique) >= 10:
            break
    return unique



def suggest_examples(goal: dict, frags: list[Fragment]) -> str:
    original = (goal.get("voorbeelden") or "").strip()
    base = f"Originele voorbeelden:\n{original}" if original else "Originele voorbeelden:\n(geen voorbeeld in bronbestand)"

    extra_lines = []
    if goal.get("cluster"):
        extra_lines.append(
            f"Werk doelgericht rond het cluster '{goal['cluster']}' in dagelijkse klas- en speelsituaties."
        )
    if goal.get("fase"):
        extra_lines.append(
            f"Plan korte oefenmomenten op maat van {goal['fase'].replace('.', '')}, met herhaling verspreid over de week."
        )

    if frags:
        extra_lines.append(f"Gebruik ook dit principe uit de visietekst: {frags[0].text}")
    if len(frags) > 1:
        extra_lines.append(f"Aanvullend: {frags[1].text}")

    if not extra_lines:
        extra_lines = [
            "Voorzie herhaalde oefenkansen in herkenbare contexten en bouw de ondersteuning stapsgewijs af.",
        ]

    bullets = "\n".join(f"- {line}" for line in extra_lines)
    return f"{base}\n\nAangevulde suggesties (gebaseerd op visieteksten):\n{bullets}"



def suggest_teacher_note(goal: dict, frags: list[Fragment]) -> str:
    lines = [
        "Bouw dit doel op van sterk ondersteund naar meer zelfstandig handelen, met expliciete observatie van groei.",
        "Koppel evaluatie aan concrete gedragsindicatoren in klasactiviteiten en plan doelgerichte herhaling.",
    ]

    if goal.get("domein"):
        lines.append(f"Veranker het doel in het domein '{goal['domein']}' en maak de samenhang met verwante doelen zichtbaar.")

    if frags:
        lines.append(f"Relevante richtlijn uit de visietekst: {frags[0].text}")

    if len(frags) > 1:
        lines.append(f"Aanvullende didactische hint: {frags[1].text}")

    return "\n".join(f"- {line}" for line in lines)



def suggest_vocab(goal: dict, vocab_index: dict) -> str:
    vocab = related_vocab(goal, vocab_index)
    if not vocab:
        return ""
    return ", ".join(vocab)



def generate() -> dict:
    goals = load_goals()
    fragments = load_pdf_fragments()
    vocab_index = build_vocab_indices(goals)

    suggestions = []
    for goal in goals:
        vak = goal.get("vak", "")
        top = best_fragments(goal, fragments.get(vak, []), n=3)
        suggestions.append(
            {
                "id": goal.get("id", ""),
                "code": goal.get("code", ""),
                "vak": vak,
                "suggested_voorbeelden": suggest_examples(goal, top),
                "suggested_extra_toelichting": suggest_teacher_note(goal, top),
                "suggested_woordenschat": suggest_vocab(goal, vocab_index),
                "source_pdfs": sorted({t.source_pdf for t in top}),
            }
        )

    return {
        "meta": {
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "based_on": ["data/goals.json", "Visieteksten en bijlagen (PDF)"],
            "aantal_leerdoelen": len(goals),
            "velden": [
                "suggested_voorbeelden",
                "suggested_extra_toelichting",
                "suggested_woordenschat",
            ],
        },
        "suggestions": suggestions,
    }



def main() -> None:
    payload = generate()
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(payload['suggestions'])} suggestions")


if __name__ == "__main__":
    main()
