#!/usr/bin/env python3
"""
IAndes Server — Launcher
=========================

Uso:
    python run.py              # Iniciar servidor en http://localhost:8000
    python run.py --port 9000  # Usar puerto personalizado
    python run.py --no-reload  # Sin hot-reload (producción)
    python run.py --check      # Solo verificar dependencias y modelos
    python run.py --install    # Instalar dependencias faltantes
"""

import sys
import subprocess
import importlib
from pathlib import Path

# ─── Configuración ───────────────────────────────────────────────────────────

SERVER_DIR = Path(__file__).parent
MAIN_MODULE = "main:app"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000

REQUIRED_PACKAGES = {
    "fastapi":       "fastapi",
    "uvicorn":       "uvicorn",
    "pydantic":      "pydantic",
    "spacy":         "spacy",
    "sentence_transformers": "sentence-transformers",
    "sklearn":       "scikit-learn",
    "numpy":          "numpy",
}

SPACY_MODEL = "es_core_news_sm"
MINILM_PATH = SERVER_DIR / "models" / "minilm"


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _green(text):
    return f"\033[92m{text}\033[0m"

def _red(text):
    return f"\033[91m{text}\033[0m"

def _yellow(text):
    return f"\033[93m{text}\033[0m"

def _bold(text):
    return f"\033[1m{text}\033[0m"


def check_python_version():
    """Verifica que Python sea 3.9+."""
    version = sys.version_info
    if version < (3, 9):
        print(_red(f"x Python {version.major}.{version.minor} detectado. Se requiere 3.9+."))
        sys.exit(1)
    print(_green(f"+ Python {version.major}.{version.minor}.{version.micro}"))


def check_packages():
    """Verifica que los paquetes requeridos estén instalados. Retorna los faltantes."""
    missing = {}
    for import_name, pip_name in REQUIRED_PACKAGES.items():
        try:
            importlib.import_module(import_name)
        except ImportError:
            missing[import_name] = pip_name
    return missing


def check_spacy_model():
    """Verifica que el modelo de spaCy esté instalado."""
    try:
        import spacy
        spacy.load(SPACY_MODEL)
        print(_green(f"+ spaCy model '{SPACY_MODEL}' instalado"))
        return True
    except OSError:
        print(_yellow(f"! spaCy model '{SPACY_MODEL}' no encontrado"))
        return False


def check_minilm():
    """Verifica que MiniLM esté descargado localmente."""
    config_file = MINILM_PATH / "config.json"
    if config_file.exists():
        size_mb = sum(f.stat().st_size for f in MINILM_PATH.rglob("*") if f.is_file()) / (1024 * 1024)
        print(_green(f"+ MiniLM local ({size_mb:.0f} MB)"))
        return True
    else:
        print(_yellow("! MiniLM no encontrado en models/minilm/"))
        return False


def install_packages(missing):
    """Instala los paquetes faltantes."""
    if not missing:
        print(_green("+ Todas las dependencias están instaladas"))
        return

    print(_bold(f"\nInstalando {len(missing)} dependencia(s) faltante(s)..."))
    pip_names = list(missing.values())
    cmd = [sys.executable, "-m", "pip", "install", "--quiet"] + pip_names
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(_red(f"x Error instalando: {result.stderr}"))
        sys.exit(1)

    print(_green(f"+ {len(missing)} dependencia(s) instalada(s)"))


def install_spacy_model():
    """Descarga el modelo de spaCy si no está instalado."""
    try:
        import spacy
        spacy.load(SPACY_MODEL)
        return
    except OSError:
        pass

    print(_bold(f"\nDescargando modelo spaCy '{SPACY_MODEL}'..."))
    cmd = [sys.executable, "-m", "spacy", "download", SPACY_MODEL]
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(_red(f"x Error descargando modelo: {result.stderr}"))
        sys.exit(1)

    print(_green(f"+ Modelo '{SPACY_MODEL}' descargado"))


def run_check():
    """Ejecuta verificación completa de dependencias y modelos."""
    print(_bold("\n=== IAndes Server v5 - Verificacion ===\n"))

    # Python
    check_python_version()

    # Paquetes
    missing = check_packages()
    if missing:
        print(_yellow(f"\n! {len(missing)} dependencia(s) faltante(s):"))
        for imp, pip in missing.items():
            print(f"  - {pip} (import: {imp})")
    else:
        print(_green("\n+ Todas las dependencias Python instaladas"))

    # Modelos
    spacy_ok = check_spacy_model()
    minilm_ok = check_minilm()

    # Resumen
    print()
    if not missing and spacy_ok and minilm_ok:
        print(_green(_bold("+ Todo listo para ejecutar el servidor")))
        return 0
    else:
        print(_yellow(_bold("! Ejecuta: python run.py --install")))
        return 1


def run_install():
    """Instala dependencias y modelos faltantes."""
    print(_bold("\n=== IAndes Server v5 - Instalacion ===\n"))

    check_python_version()

    # Paquetes
    missing = check_packages()
    install_packages(missing)

    # spaCy model
    install_spacy_model()

    # MiniLM
    if not check_minilm():
        print(_yellow("\n! MiniLM no encontrado. Descárgalo con:"))
        print("  python models/download_minilm.py")
        print("  O el servidor lo descargará de HuggingFace en el primer inicio.")

    print(_green(_bold("\n+ Instalacion completada")))
    return 0


def run_server(port, reload):
    """Inicia el servidor uvicorn."""
    print(_bold("\n=== IAndes Server v5 ==="))
    print(f"  Host:   {DEFAULT_HOST}")
    print(f"  Puerto: {port}")
    print(f"  Reload: {'Si' if reload else 'No'}")
    print(f"  UI:     http://localhost:{port}")
    print(f"  API:    http://localhost:{port}/optimize")
    print(f"  Health: http://localhost:{port}/health")
    print(_bold("============================\n"))

    # Verificación rápida antes de iniciar
    missing = check_packages()
    if missing:
        print(_red(f"! Faltan dependencias: {', '.join(missing.values())}"))
        print(_yellow("Ejecuta: python run.py --install"))
        sys.exit(1)

    import uvicorn
    uvicorn.run(
        MAIN_MODULE,
        host=DEFAULT_HOST,
        port=port,
        reload=reload,
        log_level="info",
    )


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="IAndes Server v5 — Launcher",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python run.py              Iniciar servidor en puerto 8000
  python run.py --port 9000  Usar puerto 9000
  python run.py --no-reload  Sin hot-reload (producción)
  python run.py --check      Solo verificar dependencias
  python run.py --install    Instalar dependencias faltantes
        """,
    )
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"Puerto (default: {DEFAULT_PORT})")
    parser.add_argument("--no-reload", action="store_true", help="Desactivar hot-reload")
    parser.add_argument("--check", action="store_true", help="Solo verificar dependencias y modelos")
    parser.add_argument("--install", action="store_true", help="Instalar dependencias faltantes")

    args = parser.parse_args()

    if args.check:
        sys.exit(run_check())
    elif args.install:
        sys.exit(run_install())
    else:
        run_server(port=args.port, reload=not args.no_reload)


if __name__ == "__main__":
    main()