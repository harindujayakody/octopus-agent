"""Apple M-series profiles gain the WebGPU feature Chrome 156 reports there.

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
_spec = importlib.util.spec_from_file_location("shardx_runtime_webgpu_test", RUNTIME_PY)
rt = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = rt
_spec.loader.exec_module(rt)
apply_apple_webgpu_features = rt.apply_apple_webgpu_features

M1 = "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)"


def mac(renderer, vendor, features):
    return {"webgl": {"renderer": renderer}, "webgpu": {"vendor": vendor, "features": features}}


class AppleWebGpuTest(unittest.TestCase):
    def test_an_apple_m_list_gains_the_feature_in_sorted_place_once(self):
        cfg = mac(M1, "apple", ["shader-f16", "texture-compression-etc2", "texture-formats-tier1"])
        apply_apple_webgpu_features(cfg)
        apply_apple_webgpu_features(cfg)
        self.assertEqual(cfg["webgpu"]["features"],
                         ["shader-f16", "texture-compression-etc2", "texture-compression-unaligned",
                          "texture-formats-tier1"])

    def test_other_gpus_and_an_empty_list_are_left_alone(self):
        for cfg in (mac("ANGLE (Intel, Intel(R) Iris(TM) Plus Graphics)", "intel", ["shader-f16"]),
                    mac(M1, "intel", ["shader-f16"]),
                    mac(M1, "apple", [])):
            before = repr(cfg)
            apply_apple_webgpu_features(cfg)
            self.assertEqual(repr(cfg), before)


if __name__ == "__main__":
    unittest.main()
