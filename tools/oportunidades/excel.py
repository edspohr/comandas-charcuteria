"""Excel simple: una fila por cliente con su oportunidad."""
import csv
from collections import defaultdict
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from textos import A_CONFIRMAR, CORTO

ROOT = Path(__file__).resolve().parent
leer = lambda f: list(csv.DictReader(open(ROOT / "output" / f, encoding="utf-8-sig"), delimiter=";"))
R, D = leer("oportunidades_resumen.csv"), leer("oportunidades_detalle.csv")
n = lambda s: CORTO.get(s, s)

COLS = [("#", 5), ("Cliente", 24), ("Razón social", 30), ("Comuna", 14), ("Vendedor", 18), ("Venta 12 meses neta (CLP)", 15),
        ("Hoy compra", 34), ("Productos por ofrecer (platos)", 38), ("Platos con productos nuevos", 11),
        ("Oportunidad y próxima acción", 70), ("A confirmar", 42), ("Carta", 34)]
wb = Workbook()
ws = wb.active
ws.title = "Oportunidades por cliente"
ws.append([c for c, _ in COLS])
for r in R:
    g = defaultdict(int)
    for d in D:
        if d["rut"] == r["rut"] and d["ya_lo_compra"] == "no":
            g[d["producto_sugerido"]] += 1
    orden = sorted(g.items(), key=lambda x: -x[1])
    productos = ", ".join(f"{n(k)} ({v})" for k, v in orden)
    nuevos = sum(g.values())
    if not orden:  # Carloto: la brecha sale de leer la Tabla Mediterránea
        productos, nuevos = "Coppa y Salame Italiano (1)", 1
    compra = [n(x.split(" (")[0]) for x in r["productos_que_compra"].split(" | ")]
    urls = list(dict.fromkeys(r["url_carta"].split()))
    ws.append([int(r["ranking"]), r["nombre_fantasia"], r["razon_social"], r["comuna"], " ".join(r["vendedor_actual"].split()),
               int(r["venta_12m_neta_clp"]), ", ".join(compra[:8]) + (" y otros" if len(compra) > 8 else ""), productos, nuevos,
               r["propuesta"], A_CONFIRMAR.get(r["nombre_fantasia"], ""), "\n".join(urls)])
ult = ws.max_row
ws.append(["", "Total", "", "", "", f"=SUM(F2:F{ult})", "", "", f"=SUM(I2:I{ult})"])

base, negra = Font(name="Arial", size=10), Font(name="Arial", size=10, bold=True)
linea = Side(style="thin", color="D9DED6")
for i, (_, ancho) in enumerate(COLS, 1):
    ws.column_dimensions[chr(64 + i)].width = ancho
for fila in ws.iter_rows():
    for c in fila:
        c.font = base
        c.alignment = Alignment(wrap_text=True, vertical="top")
        c.border = Border(bottom=linea)
for c in ws[1]:
    c.font = Font(name="Arial", size=10, bold=True, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor="7A1F2B")
    c.alignment = Alignment(wrap_text=True, vertical="center")
for c in ws[ws.max_row]:
    c.font = negra
for f in range(2, ws.max_row + 1):
    ws.cell(f, 6).number_format = '"$"#,##0'
    if f <= ult:
        ws.row_dimensions[f].height = 120
ws.row_dimensions[1].height = 42
ws.freeze_panes = "C2"
ws.auto_filter.ref = f"A1:L{ult}"
ws.page_setup.orientation = "landscape"
ws.page_setup.fitToWidth = 1
ws.page_setup.fitToHeight = 0
ws.sheet_properties.pageSetUpPr.fitToPage = True
wb.save(ROOT / "output" / "oportunidades_10_clientes.xlsx")
