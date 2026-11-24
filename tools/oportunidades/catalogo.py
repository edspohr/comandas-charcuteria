"""Paso 1: catalog.json desde docs/productos.pdf y cruce con variantes de Bsale.

El PDF no trae códigos, así que el cruce es por nombre normalizado. Cada fila
del PDF es una entrada y puede apuntar a varias variantes (sachet, laminado,
pieza).
"""
import difflib
import json
import re
import subprocess
import unicodedata
from collections import Counter

from bsale import DATA, ROOT, leer

PDF = ROOT.parent.parent / "docs" / "productos.pdf"

SECCIONES = {
    "LONGANIZAS - VIENESAS AHUMADAS": "Longanizas y vienesas ahumadas",
    "PRODUCTOS MADURADOS": "Madurados",
    "CHARQUI": "Charqui",
    "PRODUCTOS COCIDOS": "Cocidos",
    "PRODUCTOS UNTABLES": "Untables",
    "TABLAS": "Tablas",
}

# Términos que una carta usaría para cada fila, según nombre normalizado.
KEYWORDS = {
    "butifarra coctel": ["butifarra coctel", "mini butifarra", "butifarrita", "choripan coctel", "picoteo de longaniza"],
    "chistorra": ["chistorra", "txistorra"],
    "longanizas butifarra": ["butifarra", "choripan"],
    "longanizas tipo chillan": ["longaniza", "longaniza de chillan", "longaniza chillaneja", "choripan", "prieta y longaniza"],
    "mix de longanizas": ["longanizas", "mix de longanizas", "parrillada", "tabla parrillera"],
    "prieta": ["prieta", "morcilla", "ñachi prieta"],
    "vienesa frankfurt": ["vienesa", "salchicha", "frankfurt", "hot dog", "completo", "salchicha alemana"],
    "bresaola": ["bresaola", "cecina de vacuno", "carpaccio curado"],
    "cabanossi polaco": ["cabanossi", "kabanos", "cabanos"],
    "coppa": ["coppa", "capocollo", "bondiola curada"],
    "chorizo espanol": ["chorizo español", "chorizo iberico", "chorizo curado", "chorizo riojano", "chorizo"],
    "fuet espanol": ["fuet", "espetec"],
    "fuet cranberry": ["fuet", "fuet con arandanos", "fuet cranberry"],
    "guanciale madurado": ["guanciale", "carbonara", "amatriciana", "gricia"],
    "lomo embuchado": ["lomo embuchado", "lomo curado", "lomo iberico", "cana de lomo"],
    "panceta madurado": ["panceta curada", "pancetta", "panceta", "pancetta arrotolata", "carbonara"],
    "pastirma de vacuno": ["pastirma", "basturma", "pastrami curado"],
    "pepperoni madurado": ["pepperoni", "peperoni", "pizza pepperoni", "salame picante"],
    "salame angus": ["salame angus", "salame de vacuno"],
    "salame italiano": ["salame", "salami", "salame italiano", "salame milano", "salchichon"],
    "jamon serrano": ["jamon serrano", "jamon crudo", "prosciutto", "jamon iberico"],
    "charqui vacuno": ["charqui", "charqui de vacuno", "beef jerky", "jerky"],
    "charqui cerdo": ["charqui de cerdo", "charqui", "jerky de cerdo"],
    "porchetta": ["porchetta", "porqueta"],
    "chicharron": ["chicharron", "chicharrones", "torreja de chicharron"],
    "chuleta kassler": ["kassler", "chuleta ahumada", "chuleta kassler", "chuleta de cerdo ahumada"],
    "jamon de pierna cocido": ["jamon", "jamon cocido", "jamon de pierna", "jamon york", "jamon queso", "croque monsieur", "barros jarpa"],
    "jamon de pechuga de pavo cocido": ["jamon de pavo", "pechuga de pavo", "pavo ahumado", "pavo laminado"],
    "jamon de pierna ahumado artesanal": ["jamon ahumado", "jamon cocido ahumado", "prosciutto cotto affumicato", "jamon artesanal", "jamon de pierna ahumado", "jamon selva negra"],
    "lomo kassler": ["kassler", "lomo kassler", "lomo ahumado", "lomo de cerdo ahumado"],
    "lomo kassler medallon": ["medallon de kassler", "medallon ahumado", "medallones de lomo ahumado"],
    "mortadella ahumada tipo italiana con pistacho": ["mortadela", "mortadella", "mortadela con pistacho", "mortadela bologna"],
    "pastrami de cerdo": ["pastrami de cerdo"],
    "pastrami de vacuno": ["pastrami", "pastrami de vacuno", "reuben"],
    "panceta ahumada": ["tocino", "tocineta", "bacon", "tocino ahumado", "panceta ahumada", "panceta", "carbonara", "bacon cheese"],
    "pastrami americano angus": ["pastrami", "pastrami angus", "reuben", "new york pastrami"],
    "queso cabra ahumado": ["queso de cabra ahumado", "queso cabra", "queso de cabra"],
    "queso gouda ahumado": ["queso ahumado", "gouda ahumado", "queso gouda"],
    "pepperoni untable": ["nduja", "'nduja", "pepperoni untable", "untable de pepperoni"],
    "sobrasada untable": ["sobrasada", "sobrassada"],
    "tocino aleman untable": ["untable de tocino", "tocino untable", "griebenschmalz", "schmalz", "manteca de tocino"],
    "pate de campo": ["pate", "pate de campo", "pate rustico", "terrina", "pate de cerdo"],
    "pepperoni untable frasco": ["nduja", "'nduja", "pepperoni untable"],
    "sobrasada untable frasco": ["sobrasada", "sobrassada"],
    "tocino aleman untable frasco": ["untable de tocino", "tocino untable", "manteca de tocino"],
    "tabla charcuteras": ["tabla de charcuteria", "tabla de quesos y embutidos", "tabla de fiambres", "charcuterie", "picada", "tabla mixta"],
}

# Nombres con que Bsale llama a filas del PDF y que los tokens no alcanzan
# (la "Panceta ahumada" del PDF es "Tocino Ahumado" en Bsale). Sobre etiqueta normalizada.
ALIAS = {
    "guanciale madurado": r"\bguanciale\b",
    "pepperoni madurado": r"^pepperon+i\b(?!.*untable)",
    "jamon de pechuga de pavo cocido": r"^jamon pavo",
    "jamon de pierna ahumado artesanal": r"^jamon ahumado",
    "jamon de pierna cocido": r"^jamon cocido",
    "mortadella ahumada tipo italiana con pistacho": r"^mortadel+a",
    "vienesa frankfurt": r"^(salchichas?|vienesas?).*frankfurt",
    "prieta": r"^prietas\b",
    "cabanossi polaco": r"^cabanossi(?! (merken|pepperoni))",
    "fuet cranberry": r"^fuet con arandanos",
    "chuleta kassler": r"^chuleta ahumada",
    "longanizas butifarra": r"^butifarra lc kilo",
    "panceta madurado": r"^pancetta madurada",
    "pastrami americano angus": r"^pastrami angus",
    "panceta ahumada": r"^tocino ahumado",
    "salame italiano": r"^salamin",
}
ALIAS_SKU = {"LC046": r"^tablas? charcuteras.*\b150", "LC047": r"^tablas? charcuteras.*\b200"}
# Lo que comparte nombre con otra fila.
EXCLUIR_FILA = {"fuet espanol": r"cranberry", "longanizas butifarra": r"coctel"}
# Productos en proceso, recortes y materia prima no son el producto de lista.
EXCLUIR = r"productos madurando|recortes?\b|materia prima|\bmp\b|cuero entero"

# Productos reales facturados que el PDF no lista. Decisión del 01-11-2026:
# el objetivo es encontrar oportunidades, así que también se proponen.
EXTRA = [
    ("Roast Beef", "kg o sachet 200 g", r"^roast be", ["roast beef", "rosbif", "roastbeef"]),
    ("Jamón Gran Biscotto", "kg o sachet 200 g", r"^jamon gran biscotto", ["prosciutto cotto", "jamon italiano", "jamon biscotto", "jamon cotto"]),
    ("Prosciutto", "sachet 100/500 g", r"^prosciutto", ["prosciutto", "prosciutto crudo", "jamon de parma", "parma"]),
    ("Salame Milano", "kg o sachet 100 g", r"^salame milano", ["salame milano", "salami milano"]),
    ("Pastirma de cerdo", "kg o sachet 100 g", r"^pastirma (de )?(cerdo|bondiola)", ["pastirma de cerdo", "pastirma", "bondiola curada"]),
    ("Pastirma Angus", "kg o sachet 100 g", r"^pastirma angus", ["pastirma angus", "pastirma"]),
    ("Pastirma de lomo", "kg o sachet 100 g", r"^pastirma de lomo", ["pastirma de lomo", "pastirma"]),
    ("Costillar ahumado", "kg", r"^costill(ar|a) ahumad", ["costillar ahumado", "costilla ahumada", "ribs ahumadas", "costillas de cerdo ahumadas"]),
    ("Mix de madurados", "sachet 150/200 g", r"^mix madurados?", ["mix de cecinas", "selección de embutidos", "antipasto", "antipasti"]),
    ("Longaniza Angus", "kg o sachet", r"^longaniza (kg |sachet |lc )?angus|^longaniza angus", ["longaniza angus", "longaniza de vacuno"]),
    ("Longaniza Polaca", "kg o sachet", r"^longanizas?( kg| sachet| sachet pagina)? polaca", ["longaniza polaca", "kielbasa"]),
    ("Salchicha Angus", "kg o sachet", r"^(salchicha|vienesa)( kg)? angus", ["salchicha angus", "hot dog angus", "completo angus"]),
    ("Salchicha Polaca", "kg o sachet", r"^(salchicha|vienesa)( kg)? polaca?", ["salchicha polaca", "kielbasa"]),
    ("Bratwurst", "kg", r"^bratwurst", ["bratwurst", "salchicha alemana", "salchicha blanca"]),
    ("Cervelat", "pieza o sachet 200 g", r"^cervelat", ["cervelat"]),
    ("Krakowska", "kg", r"^krakowska", ["krakowska"]),
    ("Arrollado Huaso", "kg o 200 g", r"^arrollado huaso", ["arrollado", "arrollado huaso", "arrollado de chancho"]),
    ("Papada ahumada", "kg", r"^papada ahumada", ["papada", "papada ahumada"]),
    ("Pernil ahumado", "pieza", r"^pernil ahumado", ["pernil", "pernil ahumado", "codillo"]),
    ("Chorizo Sarta", "pieza", r"^chorizo sarta", ["chorizo sarta", "chorizo a la sidra"]),
    ("Lengua sous vide", "sachet", r"^lengua sous vide", ["lengua", "lengua de vacuno"]),
    ("Cabanossi saborizado", "unidad", r"^cabanossi (merken|pepperoni)", ["cabanossi", "cabanossi merken"]),
    ("Untable de salame o pastrami", "kg o tubo", r"^untables (kg|tubo) (salame|pastrami)", ["untable de salame", "untable de pastrami"]),
    ("Manteca de cerdo", "frasco", r"^manteca de cerdo", ["manteca de cerdo"]),
    ("Pollo ahumado", "kg o sachet", r"^pollo ahumado", ["pollo ahumado", "pechuga ahumada"]),
    ("Salmón ahumado", "kg", r"salmon ahumado|ahumado al frio kg salmon", ["salmon ahumado"]),
    ("Trucha ahumada", "kg", r"ahumado al frio kg trucha", ["trucha ahumada"]),
    ("Queso de cabra", "kg", r"^queso kg cabra", ["queso de cabra"]),
    ("Queso gouda", "kg o sachet 200 g", r"^queso.*gouda(?!.*ahumado)", ["queso gouda", "gouda"]),
    ("Queso pecorino", "kg o sachet", r"^queso.*pecorino(?!.*ahumado)", ["pecorino", "pecorino romano", "cacio e pepe"]),
    ("Queso pecorino ahumado", "kg", r"^queso.*pecorino ahumado", ["pecorino ahumado"]),
    ("Queso guayanés o de mano", "kg", r"^queso.*(guayanes)", ["queso de mano", "queso guayanes", "tequeño", "cachapa"]),
    ("Tablas charcuteras otros formatos", "100/120/250 g y por pliego", r"^tablas? charcuteras(?!.*\b(150|200))", ["tabla de charcuteria", "picada", "tabla mixta"]),
    ("Recortes y despuntes", "kg o sachet", r"^(recortes?|despuntes)\b(?!.*(salmon|papada|chuleta))", ["pizza", "tortilla", "relleno", "pure con tocino", "quiche"]),
]

RUIDO = {"de", "del", "la", "el", "tipo", "con", "y", "unid", "und", "un", "ud", "gr", "grs", "kg", "kilo", "sachet", "pieza", "pza", "laminado", "lam", "unidad", "aprox", "min", "normal", "condimentado", "pedido", "cerrado"}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", s)).strip()


def nombre_base(nombre: str) -> str:
    # "(Medallon)" sí distingue producto; los demás paréntesis son aclaraciones.
    return norm(re.sub(r"\((?!medall).*?\)", " ", nombre, flags=re.I))


def tokens(s: str) -> set:
    fuera = {"longanizas": "longaniza", "untables": "untable", "tablas": "tabla", "jamon": "jamon", "mortadella": "mortadela", "tocino": "tocino", "madurado": "madurado", "madurada": "madurado", "ahumado": "ahumado", "ahumada": "ahumado", "espanol": "espanol"}
    out = set()
    for t in norm(s).split():
        if t in RUIDO or re.fullmatch(r"\d+([a-z]+)?", t):
            continue
        out.add(fuera.get(t, t))
    return out


def leer_pdf() -> list:
    texto = subprocess.run(["pdftotext", "-layout", str(PDF), "-"], capture_output=True, text=True, check=True).stdout
    filas, categoria = [], None
    for linea in texto.splitlines():
        limpia = linea.strip()
        if limpia in SECCIONES or limpia.split("  ")[0] in SECCIONES:
            categoria = SECCIONES[limpia.split("  ")[0]]
            continue
        if not categoria or not limpia or limpia.startswith(("Precios sujetos", "La presentación", "El costo")):
            continue
        cols = [c.strip() for c in re.split(r"\s{2,}", limpia) if c.strip()]
        if len(cols) < 2:
            continue
        filas.append({
            "nombre": cols[0], "formato": cols[1], "categoria": categoria,
            "precios_pdf": cols[2:], "clave": nombre_base(cols[0]),
        })
    return filas


def cruzar(fila: dict, variantes: list) -> list:
    """Variantes cuyo nombre contiene todos los tokens de la fila del PDF."""
    objetivo = tokens(fila["clave"])
    otros = fila.get("_tokens_mas_especificos", [])
    hits = []
    for v in variantes:
        etiqueta = f"{v.get('_producto', '')} {v.get('description') or ''}"
        t, n = tokens(etiqueta), norm(etiqueta)
        if re.search(EXCLUIR, n) or re.search(EXCLUIR_FILA.get(fila["clave"], "$^"), n):
            continue
        alias = ALIAS_SKU.get(fila["sku"]) or ALIAS.get(fila["clave"])
        por_tokens = fila["sku"] not in ALIAS_SKU and objetivo <= t and not any(o <= t for o in otros)
        if por_tokens or (alias and re.search(alias, n)):
            hits.append({
                "variante_id": v["id"], "codigo": v.get("code") or "", "etiqueta": etiqueta.strip(),
                "activa": v.get("state") == 0 and v.get("_producto_estado") == 0,
            })
    return hits


def sugerencias(fila: dict, variantes: list) -> list:
    clave = fila["clave"]
    nombres = {f"{v.get('_producto', '')}".strip() for v in variantes}
    return difflib.get_close_matches(clave, [norm(n) for n in nombres], n=3, cutoff=0.55)


def construir() -> dict:
    filas = leer_pdf()
    variantes = leer("bsale/variants.json") or []
    conjuntos = [(f["clave"], tokens(f["clave"])) for f in filas]
    catalogo, sin_cruce = [], []
    for i, f in enumerate(filas, 1):
        # Una fila no debe llevarse las variantes de otra más específica
        # (fuet español vs fuet cranberry, pepperoni untable vs frasco).
        propios = tokens(f["clave"])
        f["sku"] = f"LC{i:03d}"
        f["_tokens_mas_especificos"] = [t for c, t in conjuntos if c != f["clave"] and propios < t]
        entrada = {
            "sku": f"LC{i:03d}", "nombre": f"{f['nombre']} {f['formato']}" if f["clave"] == "tabla charcuteras" else f["nombre"], "formato": f["formato"], "categoria": f["categoria"],
            "precios_pdf": f["precios_pdf"], "menu_keywords": KEYWORDS.get(f["clave"], []),
            "variantes_bsale": cruzar(f, variantes) if variantes else [],
        }
        if not entrada["menu_keywords"]:
            print(f"AVISO: sin keywords para {f['clave']}")
        entrada["cruce"] = "ok" if entrada["variantes_bsale"] else "sin_cruce"
        if variantes and not entrada["variantes_bsale"]:
            sin_cruce.append({"sku": entrada["sku"], "nombre": f["nombre"], "parecidos": sugerencias(f, variantes)})
        catalogo.append(entrada)
    for j, (nombre, formato, regex, kws) in enumerate(EXTRA, 101):
        hits = []
        for v in variantes:
            etiqueta = f"{v.get('_producto', '')} {v.get('description') or ''}".strip()
            if re.search(regex, norm(etiqueta)) and "productos madurando" not in norm(etiqueta):
                hits.append({"variante_id": v["id"], "codigo": v.get("code") or "", "etiqueta": etiqueta,
                             "activa": v.get("state") == 0 and v.get("_producto_estado") == 0})
        catalogo.append({"sku": f"LC{j}", "nombre": nombre, "formato": formato, "categoria": "Fuera del PDF",
                         "precios_pdf": [], "menu_keywords": kws, "variantes_bsale": hits,
                         "cruce": "ok" if hits else "sin_cruce"})
    conteo = Counter(v["variante_id"] for c in catalogo for v in c["variantes_bsale"])
    for c in catalogo:
        for v in c["variantes_bsale"]:
            if conteo[v["variante_id"]] > 1:
                print(f"AVISO: variante {v['variante_id']} ({v['etiqueta']}) en más de una fila: {c['sku']}")
    usadas = {v["variante_id"] for c in catalogo for v in c["variantes_bsale"]}
    fuera_pdf = [
        {"variante_id": v["id"], "codigo": v.get("code") or "", "etiqueta": f"{v.get('_producto', '')} {v.get('description') or ''}".strip()}
        for v in variantes if v["id"] not in usadas and v.get("state") == 0 and v.get("_producto_estado") == 0
    ]
    DATA.mkdir(parents=True, exist_ok=True)
    (ROOT / "catalog.json").write_text(json.dumps(catalogo, ensure_ascii=False, indent=1), encoding="utf-8")
    (DATA / "catalogo_sin_cruce.json").write_text(json.dumps({"sin_cruce": sin_cruce, "variantes_fuera_del_pdf": fuera_pdf}, ensure_ascii=False, indent=1), encoding="utf-8")
    return {"catalogo": catalogo, "sin_cruce": sin_cruce, "fuera_pdf": fuera_pdf}


if __name__ == "__main__":
    r = construir()
    print(f"{len(r['catalogo'])} filas, {len(r['sin_cruce'])} sin cruce, {len(r['fuera_pdf'])} variantes activas fuera del PDF")
