#!/usr/bin/env python3
"""Execute the workflow reporting step against isolated GitHub responses."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ReportingTest(unittest.TestCase):
    def test_reporting(self):
        workflow = (ROOT / '.github/workflows/upstream-watch.yml').read_text()
        reporting = workflow.split('      - name: Check whether issue reporting is available\n', 1)[1]
        block = reporting.split('        run: |\n', 1)[1].split('      - name:', 1)[0]
        script = '\n'.join(line[10:] for line in block.splitlines() if line.strip())
        for name in ('Open or update the single tracking issue',
                     'Close the tracking issue once every pin is current again'):
            condition = workflow.split('      - name: ' + name + '\n', 1)[1].splitlines()[0]
            self.assertIn("steps.reporting.outputs.enabled == 'true'", condition)
        for enabled, behind, api_rc, expected in (
            ('true', 'false', 0, 0), ('true', 'true', 0, 0),
            ('false', 'false', 0, 0), ('false', 'true', 0, 1),
            ('', 'false', 1, 1), ('unexpected', 'false', 0, 1),
        ):
            with self.subTest(enabled=enabled, behind=behind, api_rc=api_rc):
                with tempfile.TemporaryDirectory() as scratch:
                    directory = Path(scratch)
                    gh = directory / 'gh'
                    gh.write_text('#!/bin/sh\nprintf "%s\\n" "$RESPONSE"\nexit "$API_RC"\n')
                    gh.chmod(0o755)
                    output = directory / 'output'
                    result = subprocess.run(['bash', '-c', script], capture_output=True,
                        env={**os.environ, 'PATH': scratch + ':' + os.environ['PATH'],
                             'GH_REPO': 'example/project', 'BEHIND': behind,
                             'RESPONSE': enabled, 'API_RC': str(api_rc),
                             'GITHUB_OUTPUT': str(output),
                             'GITHUB_STEP_SUMMARY': str(directory / 'summary')})
                    self.assertEqual(result.returncode, expected, result.stderr)
                    if api_rc == 0 and enabled in ('true', 'false'):
                        self.assertEqual(output.read_text(), f'enabled={enabled}\n')


if __name__ == '__main__':
    unittest.main()
