"""Pasos 4 y 5: cruce plato a producto y puntaje 0-100."""
import math
import re
from collections import Counter

from catalogo import norm

# Términos que no identifican un producto único: confianza media.
GENERICOS = {"jamon", "salame", "salami", "chorizo", "longaniza", "longanizas", "salchicha", "vienesa", "pastrami",
             "pastirma", "cabanossi", "charqui", "pate", "panceta", "kassler", "gouda", "picada", "arrollado"}
# Platos que implican el ingrediente sin nombrarlo: confianza baja.
INFERIDOS = {"carbonara", "amatriciana", "gricia", "completo", "hot dog", "choripan", "barros jarpa", "croque monsieur",
             "reuben", "parrillada", "tabla parrillera", "tabla mixta", "bacon cheese", "antipasto", "antipasti",
             "picada", "charcuterie", "tequeno", "cachapa", "cacio e pepe"}
# Los recortes se ofrecen a criterio; sus términos ("pizza") no identifican un plato.
NO_CRUZAR = {"Recortes y despuntes"}
PARRILLA = r"parriller|parrilla|choripan|chori\b"


def contiene(texto: str, termino: str) -> bool:
    return re.search(rf"\b{re.escape(termino)}\b", texto) is not None


def indice_keywords(catalogo: list) -> list:
    out = []
    for c in catalogo:
        if c["nombre"] in NO_CRUZAR:
            continue
        for k in c["menu_keywords"]:
            out.append((norm(k), c))
    return sorted(out, key=lambda x: -len(x[0]))


def cruzar_plato(plato: dict, indice: list, por_sku: dict) -> dict | None:
    ingrediente = norm(plato.get("ingrediente_actual") or "")
    resto = norm(f"{plato.get('plato') or ''} {plato.get('texto_carta') or ''}")
    hallados = []
    for k, c in indice:
        en_ing, en_resto = contiene(ingrediente, k), contiene(resto, k)
        if en_ing or en_resto:
            hallados.append((k, c, en_ing))
    if not hallados:
        return None
    # Primero lo escrito como ingrediente, luego el término más largo.
    # Manda lo primero que nombra el ingrediente. A igual término, el producto que lo lleva en el nombre; el queso nunca le gana a la carne.
    es_queso = lambda c: norm(c["nombre"]).startswith("queso")
    posicion = lambda k, en_ing: re.search(rf"\b{re.escape(k)}\b", ingrediente).start() if en_ing else 9999
    hallados.sort(key=lambda h: (es_queso(h[1]), not h[2], posicion(h[0], h[2]), -len(h[0]), h[0] not in norm(h[1]["nombre"])))
    k, mejor, en_ing = hallados[0]
    alternativa = next((c for _, c, _ in hallados if c["sku"] != mejor["sku"] and es_queso(c) == es_queso(mejor)), None)
    if k in INFERIDOS:
        confianza = "baja"
    elif k in GENERICOS:
        confianza = "media"
    else:
        confianza = "alta" if en_ing else "media"
    # El chorizo de parrilla es fresco: no es el chorizo español curado.
    if norm(mejor["nombre"]).startswith("chorizo") and re.search(PARRILLA, f"{ingrediente} {resto}"):
        mejor, alternativa, confianza = por_sku["LC004"], por_sku["LC003"], "baja"
    return {"mejor": mejor, "alternativa": alternativa, "confianza": confianza}


def cruzar_cliente(carta: dict, compra: set, catalogo: list) -> list:
    indice = indice_keywords(catalogo)
    por_sku = {c["sku"]: c for c in catalogo}
    filas, vistos = [], set()
    for p in carta.get("platos") or []:
        clave = (norm(p.get("local") or ""), norm(p.get("plato") or ""))
        if clave in vistos:
            continue
        vistos.add(clave)
        r = cruzar_plato(p, indice, por_sku)
        if r:
            filas.append({**p, **r, "ya_lo_compra": r["mejor"]["sku"] in compra})
    return filas


def percentil(valores: list, p: float) -> float:
    if not valores:
        return 0.0
    v = sorted(valores)
    i = (len(v) - 1) * p
    a, b = math.floor(i), math.ceil(i)
    return v[a] + (v[b] - v[a]) * (i - a)


def vecinos(clientes: dict) -> dict:
    """Vector de productos por RUT (log del neto), para similitud coseno."""
    return {r: {k: math.log1p(p["neto"]) for k, p in c["productos"].items() if p["sku"] and p["neto"] > 0} for r, c in clientes.items()}


def coseno(a: dict, b: dict) -> float:
    comun = set(a) & set(b)
    if not comun:
        return 0.0
    return sum(a[k] * b[k] for k in comun) / (math.sqrt(sum(x * x for x in a.values())) * math.sqrt(sum(x * x for x in b.values())))


def brecha_por_similares(rut: str, vectores: dict, n: int = 30, umbral: float = 0.40) -> list:
    """SKU que compra al menos el 40 % (ponderado) de los clientes parecidos y este no."""
    propio = vectores[rut]
    if not propio:
        return []
    sims = sorted(((coseno(propio, v), r) for r, v in vectores.items() if r != rut), reverse=True)[:n]
    sims = [(s, r) for s, r in sims if s > 0]
    total = sum(s for s, _ in sims)
    if not total:
        return []
    peso = Counter()
    for s, r in sims:
        for sku in vectores[r]:
            if sku not in propio:
                peso[sku] += s
    return [sku for sku, p in peso.most_common() if p / total >= umbral]


def puntuar(filas: list, clientes_todos: dict) -> list:
    """filas: dicts con rut, venta, tiene_carta, n_platos, n_brecha."""
    logs = [math.log1p(max(c["venta_neta"], 0)) for c in clientes_todos.values()]
    lo, hi = min(logs), max(logs)
    p90_carta = percentil([f["n_platos"] for f in filas if f["tiene_carta"]], 0.9)
    p90_brecha = percentil([f["n_brecha"] for f in filas], 0.9)
    for f in filas:
        v = (math.log1p(max(f["venta"], 0)) - lo) / (hi - lo) if hi > lo else 0
        b = min(f["n_brecha"] / p90_brecha, 1) if p90_brecha else 0
        f["c_venta"], f["c_brecha"] = v * 100, b * 100
        if f["tiene_carta"]:
            c = min(f["n_platos"] / p90_carta, 1) if p90_carta else 0
            f["c_carta"] = c * 100
            f["score"] = 100 * (0.40 * v + 0.35 * c + 0.25 * b)
            f["parcial"] = False
        else:
            f["c_carta"] = None
            f["score"] = 100 * (0.615 * v + 0.385 * b)
            f["parcial"] = True
    return sorted(filas, key=lambda f: -f["score"])
