#!/usr/bin/env python3
import ast
from pathlib import Path

p = Path('scripts/research_patch_v83_independent_long_sleeve.py')
tree = ast.parse(p.read_text())
re_subn_calls = []
for node in ast.walk(tree):
    if not isinstance(node, ast.Call):
        continue
    fn = node.func
    if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) and fn.value.id == 're' and fn.attr == 'subn':
        re_subn_calls.append(node)

assert len(re_subn_calls) == 2, f'expected exactly 2 re.subn transformer calls, got {len(re_subn_calls)}'
for i, call in enumerate(re_subn_calls, 1):
    assert len(call.args) >= 2, f're.subn call {i} missing replacement argument'
    replacement = call.args[1]
    assert isinstance(replacement, ast.Lambda), (
        f're.subn call {i} must use a callable replacement so backslashes in generated TypeScript '
        'are returned literally instead of being interpreted by re.subn replacement-string semantics'
    )
print('V83_REPLACEMENT_ESCAPING=PASS')
