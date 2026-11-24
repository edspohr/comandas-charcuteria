"""Informe de oportunidades. Bsale solo se lee.

Uso: python3 tools/oportunidades/run.py --since YYYY-MM-DD --limit N

Refresca Bsale, puntaje y CSV. Las cartas (data/cartas/) y propuestas
(data/propuestas/) las produce una sesión de Claude: los clientes que aún no
las tienen quedan en data/pendientes_carta.json y sus columnas salen vacías.
"""
import argparse
import csv
import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import catalogo as cat
from bsale import DATA, OUTPUT, ROOT, Bsale, bajar_maestros, completar_variantes, leer
from datos import agregar, bajar_documentos, rut_fmt
from scoring import brecha_por_similares, cruzar_cliente, puntuar, vecinos

RESUMEN = ["ranking", "score", "score_parcial", "componente_venta", "componente_carta", "componente_brecha", "rut",
           "razon_social", "nombre_fantasia", "comuna", "giro", "venta_12m_neta_clp", "n_facturas_12m", "ultima_compra",
           "productos_que_compra", "carta_encontrada", "motivo_sin_carta", "url_carta", "n_locales", "n_resenas_google",
           "n_platos_abordables", "productos_sugeridos", "propuesta", "vendedor_actual", "vendedor_asignado", "notas"]
DETALLE = ["id_oportunidad", "rut", "nombre_fantasia", "local", "plato", "seccion_carta", "precio_plato_clp",
           "ingrediente_actual", "marca_actual", "producto_sugerido", "sku", "alternativa", "ya_lo_compra", "confianza",
           "url_carta", "nota"]


def dec(x, n=1):
    return "" if x is None else f"{x:.{n}f}".replace(".", ",")


def limpio(s):
    return " ".join(str(s or "").split()).strip(" .")


def ids_estables(clientes: dict) -> dict:
    ids = leer("ids.json") or {}
    siguiente = len(ids) + 1
    for r, _ in sorted(clientes.items(), key=lambda x: -x[1]["venta_neta"]):
        if r not in ids:
            ids[r] = f"C{siguiente:03d}"
            siguiente += 1
    (DATA / "ids.json").write_text(json.dumps(ids, ensure_ascii=False), encoding="utf-8")
    return ids


def escribir(nombre: str, columnas: list, filas: list):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT / nombre, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=columnas, delimiter=";")
        w.writeheader()
        w.writerows(filas)


def main():
    hoy = dt.date.today()
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", type=dt.date.fromisoformat, default=hoy.replace(year=hoy.year - 1, day=1))
    ap.add_argument("--until", type=dt.date.fromisoformat, default=hoy.replace(day=1), help="fin exclusivo")
    ap.add_argument("--limit", type=int, default=0, help="solo los N mayores clientes por venta (0 = todos)")
    ap.add_argument("--con-carta", type=int, default=0, help="solo los N mayores clientes con carta encontrada, omitiendo el resto")
    ap.add_argument("--refrescar", action="store_true", help="vuelve a bajar lo que ya está en caché")
    args = ap.parse_args()

    api = Bsale()
    bajar_maestros(api, args.refrescar)
    docs = bajar_documentos(api, args.since, args.until, args.refrescar)
    completar_variantes(api, docs)
    cat.construir()
    r = agregar(docs, args.since, args.until)
    clientes = r["clientes"]
    catalogo = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
    por_sku = {c["sku"]: c for c in catalogo}
    ids = ids_estables(clientes)
    vectores = vecinos(clientes)

    orden = sorted(clientes, key=lambda x: -clientes[x]["venta_neta"])
    alcance = orden[: args.limit] if args.limit else orden
    if args.con_carta:
        con = [r for r in orden if (leer(f"cartas/{ids[r]}.json") or {}).get("carta_encontrada") == "sí"]
        alcance = con[: args.con_carta]
    filas, pendientes = [], []
    for rut in alcance:
        c = clientes[rut]
        cid = ids[rut]
        carta = leer(f"cartas/{cid}.json")
        if carta is None:
            pendientes.append(cid)
        compra = {p["sku"] for p in c["productos"].values() if p["sku"] and p["neto"] > 0}
        tiene = bool(carta) and carta.get("carta_encontrada") == "sí"
        platos = cruzar_cliente(carta, compra, catalogo) if tiene else []
        if tiene:
            cuenta = {}
            for p in platos:
                # La alternativa cuenta para la brecha, pero la mejor opción ordena la lista.
                for x, peso in ((p["mejor"], 100), (p["alternativa"], 1)):
                    if x and x["sku"] not in compra:
                        cuenta[x["sku"]] = cuenta.get(x["sku"], 0) + peso
            brecha = sorted(cuenta, key=lambda s: -cuenta[s])
        else:
            brecha = brecha_por_similares(rut, vectores)
        filas.append({"rut": rut, "id": cid, "venta": c["venta_neta"], "tiene_carta": tiene, "carta": carta,
                      "platos": platos, "n_platos": len({cat.norm(p["plato"]) for p in platos}),
                      "brecha": brecha, "n_brecha": len(brecha)})
    filas = puntuar(filas, clientes)

    resumen, detalle = [], []
    n = 0
    for pos, f in enumerate(filas, 1):
        c, carta = clientes[f["rut"]], f["carta"] or {}
        x = c["cliente"]
        fantasia = limpio(carta.get("nombre_fantasia"))
        productos = sorted((p for p in c["productos"].values() if p["sku"] and p["neto"] > 0), key=lambda p: -p["neto"])
        texto = [f"{p['nombre']} ({round(p['neto'])} CLP" + (f", {dec(p['kg'])} kg)" if p["kg_ok"] else f", {dec(p['unidades'], 0)} un)") for p in productos]
        propuesta = (leer(f"propuestas/{f['id']}.json") or {}).get("propuesta", "")
        urls = [l.get("url_carta") for l in carta.get("locales") or [] if l.get("url_carta")]
        resumen.append({
            "ranking": pos, "score": dec(f["score"]), "score_parcial": "sí" if f["parcial"] else "no",
            "componente_venta": dec(f["c_venta"]), "componente_carta": dec(f["c_carta"]), "componente_brecha": dec(f["c_brecha"]),
            "rut": rut_fmt(f["rut"]), "razon_social": limpio(x.get("company")), "nombre_fantasia": fantasia,
            "comuna": limpio(x.get("municipality")).title(), "giro": limpio(x.get("activity")),
            "venta_12m_neta_clp": c["venta_neta"], "n_facturas_12m": c["facturas"],
            "ultima_compra": dt.datetime.fromtimestamp(c["ultima"], dt.timezone.utc).date().isoformat(),
            "productos_que_compra": " | ".join(texto),
            "carta_encontrada": "sí" if f["tiene_carta"] else "no",
            "motivo_sin_carta": limpio(carta.get("motivo_sin_carta")) if carta else "Pendiente de investigar",
            "url_carta": " ".join(urls), "n_locales": carta.get("n_locales") or "", "n_resenas_google": carta.get("n_resenas_google") or "",
            "n_platos_abordables": f["n_platos"] if f["tiene_carta"] else "",
            "productos_sugeridos": " | ".join(por_sku[s]["nombre"] for s in f["brecha"][:6]),
            "propuesta": propuesta, "vendedor_actual": c["vendedor"], "vendedor_asignado": "", "notas": "",
        })
        for p in f["platos"]:
            n += 1
            m, alt = p["mejor"], p["alternativa"]
            detalle.append({
                "id_oportunidad": f"O{n:05d}", "rut": rut_fmt(f["rut"]), "nombre_fantasia": fantasia, "local": limpio(p.get("local")),
                "plato": limpio(p.get("plato")), "seccion_carta": limpio(p.get("seccion_carta")), "precio_plato_clp": p.get("precio_plato_clp") or "",
                "ingrediente_actual": limpio(p.get("ingrediente_actual")), "marca_actual": limpio(p.get("marca_actual")),
                "producto_sugerido": m["nombre"], "sku": m["sku"], "alternativa": alt["nombre"] if alt else "",
                "ya_lo_compra": "sí" if p["ya_lo_compra"] else "no", "confianza": p["confianza"], "url_carta": p.get("url_carta") or "",
                "nota": "Producto fuera de la lista PDF" if m["categoria"] == "Fuera del PDF" else "",
            })
    escribir("oportunidades_resumen.csv", RESUMEN, resumen)
    escribir("oportunidades_detalle.csv", DETALLE, detalle)
    (DATA / "pendientes_carta.json").write_text(json.dumps(pendientes), encoding="utf-8")

    res = r["resumen"]
    venta = sum(c["venta_neta"] for c in clientes.values())
    fuera = sum(c["venta_neta"] for c in r["excluidos"].values())
    print(f"Clientes: {len(clientes)} (en este informe {len(filas)}); filas detalle: {len(detalle)}; pendientes de carta: {len(pendientes)}")
    print(f"Venta neta clientes: {venta}; excluida (Fran GC): {fuera}; NC ligadas: {res['nc_ligada']}; NC sin ligar: {res['nc_sin_ligar']} en {res['nc_sin_ligar_docs']} documentos")
    print(f"Llamadas a Bsale: {api.llamadas}")


if __name__ == "__main__":
    main()
