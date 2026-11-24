"""Prepara los lotes de búsqueda de cartas para los clientes sin ficha en data/cartas/.

Clasifica por giro y nombre para no buscar cartas en empresas sin servicio de
comida. No incluye RUT: los subagentes reciben solo nombre, dirección y giro.
"""
import datetime as dt
import glob
import json
import re

from bsale import DATA
from catalogo import norm
from datos import agregar

SI = r"restaura|gastronom|pizz|cafe|cafeter|coffee|bar\b|pub\b|sushi|hotel|hostal|lodge|banquet|eventos|catering|casino|comida|sandwich|sanguch|panader|pasteler|bakery|brunch|bistro|burger|hamburg|cocina|food|parrilla|fuente de soda|cerveceria|vino|wine|delicatessen|deli\b|rotiser|empanad|club|trattoria|ristorante"
NO = r"gas\b|ingenier|constructora|transporte|minera|abogad|inmobiliaria|clinica|colegio|universidad|municipalidad|banco|seguros|farmacia|ferreter|automotriz"


def clasificar(c: dict) -> str:
    x = c["cliente"]
    t = norm(" ".join(str(x.get(k) or "") for k in ("company", "activity")))
    if re.search(NO, t):
        return "descartar"
    return "buscar" if re.search(SI, t) else "dudoso"


if __name__ == "__main__":
    docs = {"facturas": [], "nc": []}
    for f in sorted(glob.glob(str(DATA / "bsale/docs/*_t*.json"))):
        docs["nc" if f.endswith("_t2.json") else "facturas"] += json.load(open(f))
    r = agregar(docs, dt.date(2025, 11, 1), dt.date(2026, 11, 1))
    ids = json.load(open(DATA / "ids.json"))
    hechos = {f[-9:-5] for f in glob.glob(str(DATA / "cartas/C*.json"))}
    grupos = {"buscar": [], "dudoso": [], "descartar": []}
    for rut, c in sorted(r["clientes"].items(), key=lambda x: -x[1]["venta_neta"]):
        if ids[rut] in hechos:
            continue
        x = c["cliente"]
        persona = x.get("companyOrPerson") == 0
        grupos[clasificar(c)].append({
            "id": ids[rut], "venta": c["venta_neta"], "persona": persona,
            "nombre": "" if persona else " ".join((x.get("company") or "").split()),
            "direccion": " ".join((x.get("address") or "").split()), "comuna": (x.get("municipality") or "").strip(),
            "giro": (x.get("activity") or "").strip()[:60],
        })
    (DATA / "lotes.json").write_text(json.dumps(grupos, ensure_ascii=False), encoding="utf-8")
    for k, v in grupos.items():
        print(k, len(v), sum(i["venta"] for i in v), "personas", sum(i["persona"] for i in v))
