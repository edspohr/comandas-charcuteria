"""Página del reporte para el equipo, generada desde los CSV de output/."""
import csv
import html
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from textos import A_CONFIRMAR, CORTO

e = html.escape
n = lambda s: CORTO.get(s, s)
leer = lambda f: list(csv.DictReader(open(ROOT / "output" / f, encoding="utf-8-sig"), delimiter=";"))
R, D = leer("oportunidades_resumen.csv"), leer("oportunidades_detalle.csv")
clp = lambda s: "$" + f"{int(s):,}".replace(",", ".")

filas, fichas = [], []
for r in R:
    platos = [d for d in D if d["rut"] == r["rut"]]
    g = defaultdict(list)
    for d in platos:
        if d["ya_lo_compra"] == "no":
            g[d["producto_sugerido"]].append(d["plato"])
    orden = sorted(g.items(), key=lambda x: -len(x[1]))
    compra = [x.split(" (")[0] for x in r["productos_que_compra"].split(" | ")]
    principal = ", ".join(f"{n(k)} ({len(v)})" for k, v in orden[:3]) or "Coppa y Salame Italiano (1)"
    nombre = r["nombre_fantasia"]
    filas.append(f'<tr><td class="num">{r["ranking"]}</td><td><a href="#c{r["ranking"]}">{e(nombre)}</a></td><td class="num">{r["score"]}</td><td class="num">{clp(r["venta_12m_neta_clp"])}</td><td class="num">{len(g)}</td><td class="num">{sum(map(len, g.values()))}</td><td>{e(principal)}</td><td>{e(" ".join(r["vendedor_actual"].split()))}</td></tr>')
    chips = "".join(f'<li><b>{e(n(k))}</b> <span class="cnt">{len(v)}</span><span class="pl">{e(", ".join(v[:4]))}{" y otros" if len(v) > 4 else ""}</span></li>' for k, v in orden)
    if not orden:
        chips = '<li><b>Coppa y Salame Italiano</b> <span class="cnt">1</span><span class="pl">Tabla Mediterránea</span></li>'
    tabla = "".join(f'<tr><td>{e(d["plato"])}</td><td>{e(d["ingrediente_actual"])}</td><td>{e(n(d["producto_sugerido"]))}</td><td>{"Sí" if d["ya_lo_compra"] == "sí" else "No"}</td><td>{e(d["confianza"])}</td></tr>' for d in platos)
    urls = list(dict.fromkeys(r["url_carta"].split()))
    enlaces = " · ".join(f'<a href="{e(u)}">carta {i}</a>' for i, u in enumerate(urls, 1))
    locales = f' · {r["n_locales"]} locales' if r["n_locales"] and int(r["n_locales"]) > 1 else ""
    fichas.append(f'''<section class="ficha" id="c{r["ranking"]}">
<header><h3>{e(nombre)}</h3><p class="meta">{e(r["razon_social"])} · {e(r["comuna"])}{locales}</p>
<p class="meta">{clp(r["venta_12m_neta_clp"])} netos en 12 meses · {r["n_facturas_12m"]} facturas · última compra {r["ultima_compra"]} · {e(" ".join(r["vendedor_actual"].split()))}</p></header>
<p class="prop">{e(r["propuesta"])}</p>
<h4>Productos por ofrecer y platos donde entran</h4><ul class="ops">{chips}</ul>
<p class="cf"><b>Hoy compra:</b> {e(", ".join(n(c) for c in compra[:8]))}{" y otros" if len(compra) > 8 else ""}.</p>
<p class="cf"><b>A confirmar:</b> {e(A_CONFIRMAR.get(nombre, ""))}</p>
<details><summary>Ver los {len(platos)} platos ({enlaces})</summary><div class="tw"><table><thead><tr><th>Plato</th><th>Ingrediente en carta</th><th>Producto</th><th>¿Lo compra?</th><th>Confianza</th></tr></thead><tbody>{tabla}</tbody></table></div></details>
</section>''')

no_compra = sum(d["ya_lo_compra"] == "no" for d in D)
pagina = f'''<title>Oportunidades Charcutería</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bitter:wght@500;700&family=Source+Sans+3:wght@400;600&display=swap">
<style>
/* Informe de trabajo: una tabla para decidir y una ficha por cuenta. */
:root{{--bg:#f6f7f5;--panel:#ffffff;--fg:#20261f;--mut:#5c665a;--line:#d9ded6;--acc:#7a1f2b;--tag:#efe4e2;--disp:"Bitter",Georgia,serif;--body:"Source Sans 3","Helvetica Neue",Arial,sans-serif}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#171a17;--panel:#1f231f;--fg:#e8ebe6;--mut:#a3ada0;--line:#363c35;--acc:#e0a0a8;--tag:#3a2629;color-scheme:dark}}}}
:root[data-theme="dark"]{{--bg:#171a17;--panel:#1f231f;--fg:#e8ebe6;--mut:#a3ada0;--line:#363c35;--acc:#e0a0a8;--tag:#3a2629;color-scheme:dark}}
body{{background:var(--bg);color:var(--fg);font:400 17px/1.5 var(--body)}}
main{{max-width:980px;margin:0 auto;padding-block:40px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));display:grid;gap:32px}}
h1,h2,h3{{font-family:var(--disp);line-height:1.2;text-wrap:balance;margin:0}}h1{{font-size:2.1rem}}h2{{font-size:1.4rem}}h3{{font-size:1.25rem}}
h4{{font-size:.8rem;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);margin:0}}
p{{margin:0;max-width:70ch}}a{{color:var(--acc)}}section{{display:grid;gap:12px;min-width:0}}
.tw{{overflow-x:auto}}table{{border-collapse:collapse;width:100%;font-size:.95rem}}th{{text-align:left;font-weight:600;color:var(--mut);border-bottom:2px solid var(--line);padding:6px 10px}}td{{border-bottom:1px solid var(--line);padding:7px 10px;vertical-align:top}}.num{{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}}
.ficha{{background:var(--panel);border:1px solid var(--line);padding:20px;scroll-margin-top:12px}}.ficha header{{display:grid;gap:2px}}.meta{{color:var(--mut);font-size:.92rem;max-width:none}}.prop{{font-size:1.05rem}}
.ops{{list-style:none;margin:0;padding:0;display:grid;gap:6px}}.ops li{{display:grid;grid-template-columns:auto auto 1fr;gap:4px 10px;align-items:baseline}}.cnt{{background:var(--tag);color:var(--acc);font-weight:600;padding:0 7px;font-variant-numeric:tabular-nums}}.pl{{color:var(--mut);font-size:.92rem;min-width:0}}
.cf{{font-size:.95rem}}summary{{cursor:pointer;color:var(--acc)}}summary a{{font-size:.9rem}}details table{{margin-top:8px;font-size:.9rem}}
ul.nota{{margin:0;padding-left:20px;max-width:70ch;display:grid;gap:6px}}
@media (max-width:560px){{.ops li{{grid-template-columns:auto 1fr}}.pl{{grid-column:1/-1}}h1{{font-size:1.7rem}}}}
</style>
<main>
<section><h1>Oportunidades de venta en 10 clientes con carta</h1>
<p>Para revisar con el equipo antes de ampliar el análisis. Son 10 de los mayores clientes con factura entre el 01-11-2025 y el 31-10-2026 cuya carta se pudo leer en la web. Suman {clp(sum(int(r["venta_12m_neta_clp"]) for r in R))} netos, y de {len(D)} platos con charcutería, <b>{no_compra} usan productos que hoy no nos compran</b>.</p></section>
<section><h2>Ranking</h2><p>Sicily y De Pura Madre compran un solo producto y tienen de las cartas más amplias. El prosciutto crudo, el tocino y el salmón ahumado son las brechas que más se repiten.</p>
<div class="tw"><table><thead><tr><th class="num">#</th><th>Cliente</th><th class="num">Puntaje</th><th class="num">Venta 12 m</th><th class="num">Productos nuevos</th><th class="num">Platos</th><th>Principales (platos)</th><th>Vendedor</th></tr></thead><tbody>{"".join(filas)}</tbody></table></div></section>
<section><h2>Fichas por cliente</h2>{"".join(fichas)}</section>
<section><h2>Cómo leer este reporte</h2><ul class="nota">
<li>Se revisaron los 28 mayores clientes por venta. Los otros 18 no tenían carta legible: distribuidoras, tiendas o sociedades sin marca pública. El detalle de cada caso está en los archivos de trabajo.</li>
<li>El puntaje pesa 40 % venta, 35 % platos abordables y 25 % productos nuevos, y solo compara a estos 10 clientes.</li>
<li>La venta descuenta $17,5 M en notas de crédito ligadas a facturas. Otros $1,03 M no se pudieron ligar y no se descontaron. Fran GC está excluido.</li>
<li>Los platos salen de lo publicado en cada carta. La marca actual casi nunca aparece, así que un plato con el producto no nos dice quién lo provee hoy.</li>
<li>Confianza alta: el ingrediente está nombrado y hay producto exacto. Media: ingrediente genérico. Baja: inferido.</li>
<li>Algunos productos sugeridos no están en la lista de precios de septiembre, como Prosciutto, Salmón ahumado, Roast Beef y Chorizo Sarta. Son productos facturados en Bsale en los últimos 12 meses.</li>
</ul></section>
</main>'''
Path(sys.argv[1]).write_text(pagina, encoding="utf-8")
