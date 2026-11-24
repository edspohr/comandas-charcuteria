"""Cliente Bsale de SOLO LECTURA para el informe de oportunidades.

Reglas: solo GET, solo api.bsale.io, el token vive en memoria y nunca se
imprime ni se escribe. Las respuestas se guardan en data/ sin campos sensibles.
"""
import json
import os
import subprocess
import time
from pathlib import Path
from urllib.parse import urlparse

import requests

HOST = "api.bsale.io"
BASE = f"https://{HOST}/v1"
PROJECT = "comandas-charcuteria"
SECRET = "BSALE_ACCESS_TOKEN"
PAUSA_S = 0.25
MAX_REINTENTOS = 6

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
OUTPUT = ROOT / "output"

# Campos que Bsale incluye en cada documento y que no deben quedar en caché.
CAMPOS_SENSIBLES = {"token", "ted", "urlPublicView", "urlPublicViewOriginal", "urlPdf", "urlPdfOriginal", "urlTimbre", "urlXml"}


def cargar_token() -> str:
    token = os.environ.get(SECRET, "").strip()
    if token:
        return token
    res = subprocess.run(
        ["firebase", "functions:secrets:access", SECRET, "--project", PROJECT],
        capture_output=True, text=True,
    )
    token = res.stdout.strip()
    if res.returncode != 0 or not token:
        # No se reenvía stdout: podría contener el secreto.
        raise SystemExit(f"No se pudo leer {SECRET} (código {res.returncode}). Revisa `firebase login`.")
    return token


def limpiar(x):
    if isinstance(x, dict):
        return {k: limpiar(v) for k, v in x.items() if k not in CAMPOS_SENSIBLES}
    if isinstance(x, list):
        return [limpiar(v) for v in x]
    return x


class Bsale:
    def __init__(self):
        self._s = requests.Session()
        self._s.headers.update({"access_token": cargar_token(), "accept": "application/json"})
        self.llamadas = 0

    def get(self, path: str, params: dict | None = None) -> dict:
        url = path if path.startswith("http") else f"{BASE}{path}"
        if urlparse(url).hostname != HOST:
            raise ValueError("Host no permitido")
        if params:
            # expand lleva corchetes que Bsale espera sin codificar.
            q = "&".join(f"{k}={v}" for k, v in params.items())
            url += ("&" if "?" in url else "?") + q
        for intento in range(MAX_REINTENTOS):
            time.sleep(PAUSA_S)
            self.llamadas += 1
            res = self._s.get(url, timeout=60)
            if res.status_code == 200:
                return res.json()
            if res.status_code == 429 or res.status_code >= 500:
                espera = float(res.headers.get("retry-after") or 2 ** (intento + 1))
                print(f"  Bsale {res.status_code}, reintento en {espera:.0f} s")
                time.sleep(espera)
                continue
            raise RuntimeError(f"Bsale {res.status_code} en {urlparse(url).path}")
        raise RuntimeError(f"Bsale sin respuesta tras {MAX_REINTENTOS} intentos en {urlparse(url).path}")

    def todo(self, path: str, params: dict | None = None, limit: int = 50) -> list:
        items, offset = [], 0
        while True:
            pag = self.get(path, {**(params or {}), "limit": limit, "offset": offset})
            nuevos = pag.get("items") or []
            items.extend(nuevos)
            if len(nuevos) < limit or (pag.get("count") is not None and len(items) >= pag["count"]):
                return items
            offset += limit


def guardar(nombre: str, datos) -> Path:
    p = DATA / nombre
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(limpiar(datos), ensure_ascii=False), encoding="utf-8")
    return p


def leer(nombre: str):
    p = DATA / nombre
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def bajar_maestros(api: Bsale, refrescar: bool = False) -> dict:
    """Productos, variantes y tipos de documento, con caché en data/."""
    tipos = leer("bsale/document_types.json")
    if tipos is None or refrescar:
        tipos = api.todo("/document_types.json")
        guardar("bsale/document_types.json", tipos)
    productos = leer("bsale/products.json")
    if productos is None or refrescar:
        productos = api.todo("/products.json", {"expand": "[product_type]"})
        guardar("bsale/products.json", productos)
    variantes = leer("bsale/variants.json")
    if variantes is None or refrescar:
        variantes = []
        for i, p in enumerate(productos):
            if i % 50 == 0:
                print(f"  variantes: producto {i}/{len(productos)}")
            for v in api.todo(f"/products/{p['id']}/variants.json"):
                v["_producto"] = p["name"]
                v["_producto_estado"] = p.get("state")
                v["_tipo"] = (p.get("product_type") or {}).get("name")
                variantes.append(v)
        guardar("bsale/variants.json", variantes)
    return {"tipos": tipos, "productos": productos, "variantes": variantes}


def completar_variantes(api: Bsale, docs: dict) -> int:
    """Variantes facturadas que el listado por producto no devuelve."""
    variantes = leer("bsale/variants.json") or []
    conocidas = {v["id"] for v in variantes}
    faltan = {int(l["variant"]["id"]) for d in docs["facturas"] + docs["nc"] for l in d["details"]["items"]
              if (l.get("variant") or {}).get("id") is not None} - conocidas
    productos = {}
    for vid in sorted(faltan):
        v = api.get(f"/variants/{vid}.json")
        pid = (v.get("product") or {}).get("id")
        if pid not in productos:
            productos[pid] = api.get(f"/products/{pid}.json", {"expand": "[product_type]"})
        p = productos[pid]
        v["_producto"], v["_producto_estado"] = p.get("name", ""), p.get("state")
        v["_tipo"] = (p.get("product_type") or {}).get("name")
        variantes.append(v)
    if faltan:
        guardar("bsale/variants.json", variantes)
    return len(faltan)
