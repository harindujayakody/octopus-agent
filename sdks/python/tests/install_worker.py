"""One process running install() on a shared cache, the engine "downloaded"
slowly from a local zip so two of them overlap (test_runtime_swap.py).

Usage: install_worker.py <runtime.py> <cache root> <engine zip>"""
import importlib.util
import json
import sys
import time
import types
import warnings
from pathlib import Path

runtime_py, root, archive = sys.argv[1:4]
sys.modules.setdefault("httpx", types.ModuleType("httpx"))
spec = importlib.util.spec_from_file_location("shardx_runtime_worker", runtime_py)
rt = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = rt
spec.loader.exec_module(rt)
warnings.simplefilter("ignore")

key = rt.host_spec().browser.key
downloaded = False


def download(arch, dest, unpacks=False):
    global downloaded
    if arch.key != key:
        raise RuntimeError(f"download {arch.key}: HTTP 404")
    downloaded = True
    body = Path(archive).read_bytes()
    tmp = dest / f".{arch.key}.tmp"
    step = -(-len(body) // 20)
    with tmp.open("wb") as f:
        for at in range(0, len(body), step):
            time.sleep(0.015)
            f.write(body[at:at + step])
    return tmp, "e157.0.0.1"


r = rt.Runtime(cache_dir=root)
r._fetch_manifest = lambda: {
    "chromium_version": "157.0.0.1",
    "archives": {key: "e157.0.0.1", "ShardX-Fingerprints.zip": "f1"},
}
r._download = download
try:
    r.install()
    print(json.dumps({"ok": True, "version": r.chromium_version, "downloaded": downloaded}))
except Exception as e:  # noqa: BLE001
    print(json.dumps({"ok": False, "error": str(e), "downloaded": downloaded}))
