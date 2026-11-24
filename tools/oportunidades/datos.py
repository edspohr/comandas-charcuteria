"""Paso 2: facturas y notas de crédito de Bsale, agregadas por RUT.

Las notas de crédito no traen `references` en esta cuenta: se ligan a la
factura por `relatedDetailId` de cada línea, que apunta al detalle original.
"""
import datetime as dt
import json
import re
from collections import Counter, defaultdict

from bsale import DATA, ROOT, guardar, leer
from catalogo import norm

TIPO_FACTURA = [5, 15, 27]  # SII 33 y 34
TIPO_NC = [2]               # SII 61
EXPAND = "[details,client,document_type,sellers,office]"
# Fran GC es distribuidor del propio consultor: fuera de todo el análisis.
EXCLUIR_CLIENTE = r"\bfran\b.*\bgc\b|\bfrangc\b"


def meses(desde: dt.date, hasta: dt.date):
    a = desde.replace(day=1)
    while a < hasta:
        b = (a.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield a, b
        a = b


def epoch(d: dt.date) -> int:
    return int(dt.datetime(d.year, d.month, d.day, tzinfo=dt.timezone.utc).timestamp())


def bajar_mes(api, tipo: int, a: dt.date, b: dt.date, hasta: dt.date, refrescar: bool) -> list:
    nombre = f"bsale/docs/{a:%Y-%m}_t{tipo}.json"
    cerrado = b <= dt.date.today().replace(day=1)
    cache = leer(nombre)
    if cache is not None and cerrado and not refrescar:
        return cache
    fin = min(b, hasta)
    docs = api.todo("/documents.json", {
        "emissiondaterange": f"[{epoch(a)},{epoch(fin) - 1}]", "documenttypeid": tipo, "expand": EXPAND,
    })
    for d in docs:
        if str((d.get("document_type") or {}).get("id")) != str(tipo):
            raise RuntimeError("Bsale ignoró el filtro de tipo de documento")
        # El expand corta los detalles en 25 líneas.
        det = d.get("details") or {}
        if (det.get("count") or 0) > len(det.get("items") or []):
            det["items"] = api.todo(f"/documents/{d['id']}/details.json")
    guardar(nombre, docs)
    return docs


def bajar_documentos(api, desde: dt.date, hasta: dt.date, refrescar: bool = False) -> dict:
    out = {"facturas": [], "nc": []}
    for a, b in meses(desde, hasta):
        for t in TIPO_FACTURA:
            out["facturas"] += bajar_mes(api, t, a, b, hasta, refrescar)
        # Las NC se siguen hasta hoy: pueden anular facturas del período después de su cierre.
        for t in TIPO_NC:
            out["nc"] += bajar_mes(api, t, a, b, dt.date.today() + dt.timedelta(days=1), refrescar)
    return out


def rut_de(c: dict) -> str:
    return re.sub(r"[^0-9kK]", "", c.get("code") or "").upper()


def rut_fmt(r: str) -> str:
    return f"{r[:-1]}-{r[-1]}" if len(r) > 1 else r


def indice_variantes() -> dict:
    """variante_id a (sku, nombre) según catalog.json."""
    cat = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    return {v["variante_id"]: (c["sku"], c["nombre"]) for c in cat for v in c["variantes_bsale"]}


def kg_por_unidad(etiqueta: str):
    n = norm(etiqueta)
    m = re.search(r"\b(\d+)\s*(?:x\s*(\d+)\s*)?gr?s?\b", n)
    if re.search(r"\b(kg|kilo)\b", n) and not m:
        return 1.0
    if m:
        return int(m.group(1)) * int(m.group(2) or 1) / 1000
    return None


def agregar(docs: dict, desde: dt.date, hasta: dt.date) -> dict:
    variantes = {v["id"]: v for v in leer("bsale/variants.json") or []}
    idx = indice_variantes()
    facturas = [d for d in docs["facturas"] if d.get("state") == 0]
    anuladas = len(docs["facturas"]) - len(facturas)

    # Notas de crédito por línea de factura.
    linea_a_rut = {}
    clientes, sin_rut = {}, 0
    for d in facturas:
        c = d.get("client") or {}
        r = rut_de(c)
        if not r:
            sin_rut += 1
            r = f"SINRUT{c.get('id', 0)}"
        d["_rut"] = r
        clientes[r] = c
        for l in d["details"]["items"]:
            linea_a_rut[l["id"]] = d
    nc_linea = defaultdict(float)
    nc_ligada, nc_sin_ligar = 0.0, 0.0
    nc_sin_ligar_n = 0
    for n in docs["nc"]:
        if n.get("state") != 0:
            continue
        ligada = False
        for l in n["details"]["items"]:
            if l.get("relatedDetailId") in linea_a_rut:
                nc_linea[l["relatedDetailId"]] += l.get("netAmount") or 0
                nc_ligada += l.get("netAmount") or 0
                ligada = True
            else:
                nc_sin_ligar += l.get("netAmount") or 0
        if not ligada:
            nc_sin_ligar_n += 1

    agg = {}
    fuera = Counter()
    for d in facturas:
        c = d.get("client") or {}
        a = agg.setdefault(d["_rut"], {
            "rut": d["_rut"], "cliente": c, "venta_bruta": 0, "nc": 0.0, "facturas": 0,
            "ultima": 0, "productos": {}, "vendedores": Counter(), "ids": set(),
        })
        a["ids"].add(c.get("id"))
        if (c.get("updatedAt") or 0) >= (a["cliente"].get("updatedAt") or 0):
            a["cliente"] = c
        a["venta_bruta"] += d.get("netAmount") or 0
        a["facturas"] += 1
        a["ultima"] = max(a["ultima"], d.get("emissionDate") or 0)
        vendedores = (d.get("sellers") or {}).get("items") or []
        if vendedores:
            v = vendedores[0]
            a["vendedores"][" ".join(x for x in [v.get("firstName"), v.get("lastName")] if x)] += d.get("netAmount") or 0
        for l in d["details"]["items"]:
            nc = nc_linea.get(l["id"], 0)
            a["nc"] += nc
            neto = (l.get("netAmount") or 0) - nc
            vid = (l.get("variant") or {}).get("id")
            vid = int(vid) if vid is not None else None
            v = variantes.get(vid, {})
            etiqueta = f"{v.get('_producto', '')} {v.get('description') or ''}".strip() or (l.get("variant") or {}).get("description") or "(sin variante)"
            sku, nombre = idx.get(vid, (None, etiqueta))
            if sku is None:
                fuera[(vid, etiqueta)] += neto
            p = a["productos"].setdefault(sku or f"V{vid}", {"sku": sku, "nombre": nombre, "neto": 0.0, "unidades": 0.0, "kg": 0.0, "kg_ok": True})
            p["neto"] += neto
            q = l.get("quantity") or 0
            factor = (l.get("netAmount") or 0) and (neto / (l.get("netAmount") or 1))
            p["unidades"] += q * factor
            k = kg_por_unidad(etiqueta)
            if k is None:
                p["kg_ok"] = False
            else:
                p["kg"] += q * factor * k

    for a in agg.values():
        a["venta_neta"] = round(a["venta_bruta"] - a["nc"])
        a["ids"] = sorted(x for x in a["ids"] if x is not None)
        a["vendedor"] = a["vendedores"].most_common(1)[0][0] if a["vendedores"] else ""
        a["vendedores"] = dict(a["vendedores"])
    excluidos = {}
    for r in list(agg):
        c = agg[r]["cliente"]
        texto = norm(" ".join(str(c.get(k) or "") for k in ("company", "firstName", "lastName")))
        if re.search(EXCLUIR_CLIENTE, texto):
            excluidos[r] = agg.pop(r)
    return {
        "clientes": agg, "excluidos": excluidos, "fuera_catalogo": fuera,
        "resumen": {
            "facturas": len(facturas), "anuladas": anuladas, "sin_rut": sin_rut,
            "nc_ligada": round(nc_ligada), "nc_sin_ligar": round(nc_sin_ligar), "nc_sin_ligar_docs": nc_sin_ligar_n,
        },
    }
