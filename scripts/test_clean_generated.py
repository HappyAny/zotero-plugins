"""Check the cleaner with disposable files and a mocked tracked-file list."""
import contextlib
import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cleaner', Path(__file__).with_name('clean-generated.py'))
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)

class CleanGeneratedTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve() / 'repository'
        self.root.mkdir()
        (self.root / 'build').mkdir()
        (self.root / 'build/output.xpi').write_text('generated')
        (self.root / 'source.js').write_text('source')
        (self.root / '.git').mkdir()
        (self.root / '.git/HEAD').write_text('history')

    def run_cleaner(self, apply=False, tracked=b'source.js\0'):
        with patch.object(cleaner, 'ROOT', self.root), patch.object(cleaner.subprocess, 'run',
                return_value=subprocess.CompletedProcess([], 0, stdout=tracked)), \
                patch('sys.argv', ['cleaner'] + (['--apply'] if apply else [])), contextlib.redirect_stdout(io.StringIO()):
            cleaner.main()

    def test_preview_preserves_everything(self):
        self.run_cleaner()
        self.assertTrue((self.root / 'build/output.xpi').is_file())

    def test_apply_preserves_source_and_history(self):
        self.run_cleaner(apply=True)
        self.assertFalse((self.root / 'build').exists())
        self.assertTrue((self.root / 'source.js').is_file())
        self.assertTrue((self.root / '.git/HEAD').is_file())

    def test_tracked_files_block_all_removal(self):
        with self.assertRaisesRegex(RuntimeError, 'tracked content'):
            self.run_cleaner(apply=True, tracked=b'build/output.xpi\0')
        self.assertTrue((self.root / 'build/output.xpi').is_file())

    def test_parent_target_cannot_escape_workspace(self):
        with patch.object(cleaner, 'GENERATED', ['../outside']):
            # relative_to rejects a path outside the workspace if it exists.
            outside = self.root.parent / 'outside'
            if outside.exists():
                self.skipTest('Outside sentinel already exists')
            outside.write_text('preserve')
            try:
                with self.assertRaises((ValueError, RuntimeError)):
                    self.run_cleaner(apply=True)
                self.assertEqual(outside.read_text(), 'preserve')
            finally:
                outside.unlink()

if __name__ == '__main__':
    unittest.main()
