"""Phone profiles without a brand list Chrome's, as Chrome on Android does.

Run: python3 -m unittest discover -s sdks/python/tests (or pytest)."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

# runtime.py on its own, as in test_runtime_swap.py: no browser driver needed.
if "httpx" not in sys.modules:
    try:
        import httpx  # noqa: F401
    except ImportError:
        sys.modules["httpx"] = types.ModuleType("httpx")
RUNTIME_PY = Path(__file__).resolve().parents[1] / "shardx" / "runtime.py"
_spec = importlib.util.spec_from_file_location("shardx_runtime_brand_test", RUNTIME_PY)
rt = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = rt
_spec.loader.exec_module(rt)
apply_chrome_brand = rt.apply_chrome_brand


class ChromeBrandTest(unittest.TestCase):
    def test_a_profile_without_a_brand_gets_chromes_and_a_named_one_stays(self):
        bare = {"client_hints": {"mobile": True, "brand_version": "156"}}
        apply_chrome_brand(bare)
        self.assertEqual(bare["client_hints"]["brand"], "Google Chrome")
        empty = {"client_hints": {"brand": ""}}
        apply_chrome_brand(empty)
        self.assertEqual(empty["client_hints"]["brand"], "Google Chrome")
        named = {"client_hints": {"brand": "Microsoft Edge"}}
        apply_chrome_brand(named)
        self.assertEqual(named["client_hints"]["brand"], "Microsoft Edge")


if __name__ == "__main__":
    unittest.main()
