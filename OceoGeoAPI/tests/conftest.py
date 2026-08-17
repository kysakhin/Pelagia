"""Pytest configuration: make the OceoGeoAPI package root importable.

Tests are laid out as `OceoGeoAPI/tests/test_*.py` and import modules like
`from core.tools import ...`. We insert the API root dir onto sys.path so
those absolute imports resolve without needing an installed package.
"""
import os
import sys

_API_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _API_ROOT not in sys.path:
    sys.path.insert(0, _API_ROOT)
