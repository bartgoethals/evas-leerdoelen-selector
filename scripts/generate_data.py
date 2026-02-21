from __future__ import annotations

import json
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parent.parent

WORKBOOKS = [
    ("nederlands en communicatie versie KS (1).xlsx", "Nederlands en communicatie"),
    ("wetenschap en techniek versie KS.xlsx", "Wetenschap en techniek"),
    ("wiskunde versie KS.xlsx", "Wiskunde"),
]

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


def clean(value):
    if value is None:
        return ""
    return str(value).replace("\n", " ").strip()


def val(ws, row: int, header_idx: dict, *names: str) -> str:
    for name in names:
        col = header_idx.get(name)
        if col:
            return clean(ws.cell(row=row, column=col).value)
    return ""


def load_goals() -> list[dict]:
    results: list[dict] = []
    for workbook_name, subject in WORKBOOKS:
        workbook_path = ROOT / workbook_name
        wb = openpyxl.load_workbook(workbook_path, data_only=True)
        ws = wb[wb.sheetnames[0]]

        headers = [clean(ws.cell(row=1, column=c).value) for c in range(1, ws.max_column + 1)]
        header_idx = {h: i + 1 for i, h in enumerate(headers) if h}

        for row in range(2, ws.max_row + 1):
            goal_text = val(ws, row, header_idx, "Leerplandoel")
            if not goal_text:
                continue

            item = {
                "id": f"{subject[:3].upper()}-{row}",
                "vak": subject,
                "doelsoort": val(ws, row, header_idx, "Doel-soort"),
                "lfmd": val(ws, row, header_idx, "LfMD"),
                "nrmd": val(ws, row, header_idx, "NrMD", "nrMD"),
                "md": val(ws, row, header_idx, "MD"),
                "code": val(ws, row, header_idx, "Code"),
                "fase": val(ws, row, header_idx, "Jaar/ fase", "Jaar/\nfase"),
                "domein": val(ws, row, header_idx, "Domein"),
                "subdomein": val(ws, row, header_idx, "Subdomein"),
                "cluster": val(ws, row, header_idx, "Cluster"),
                "leerplandoel": goal_text,
                "voorbeelden": val(ws, row, header_idx, "Voorbeelden"),
                "extra_toelichting": val(ws, row, header_idx, "Extra toelichting"),
                "woordenschat": val(ws, row, header_idx, "Woordenschat (richtinggevend)"),
            }
            results.append(item)

    return results


def build_resources() -> list[dict]:
    resources: list[dict] = []
    for subject, pdfs in PDF_GROUPS.items():
        for filename in pdfs:
            path = ROOT / filename
            size_kb = round(path.stat().st_size / 1024)
            resources.append(
                {
                    "vak": subject,
                    "bestand": filename,
                    "titel": filename.replace("_", " ").replace(".pdf", ""),
                    "url": filename,
                    "grootte_kb": size_kb,
                }
            )
    return resources


def main() -> None:
    goals = load_goals()
    payload = {
        "meta": {
            "bron": "Nieuwe leerdoelen (Excel + PDF)",
            "aantal": len(goals),
            "vakken": sorted({g["vak"] for g in goals}),
        },
        "doelen": goals,
        "bronnen": build_resources(),
    }
    out = ROOT / "data" / "goals.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {out} with {len(goals)} doelen")


if __name__ == "__main__":
    main()
