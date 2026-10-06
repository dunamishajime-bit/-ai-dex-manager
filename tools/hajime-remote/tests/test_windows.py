import importlib
import struct
import unittest
import zlib

class WindowsTest(unittest.TestCase):
    def module(self):
        try: return importlib.import_module('remote_app.windows')
        except ModuleNotFoundError: self.fail('Win32 backend missing')

    def test_png_preserves_colors_and_rows(self):
        m = self.module()
        png = m.encode_png(2, 1, bytes([0,0,255,0, 255,0,0,0]))
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        at, compressed = 8, b''
        while at < len(png):
            size = struct.unpack('>I', png[at:at+4])[0]
            kind, data = png[at+4:at+8], png[at+8:at+8+size]
            self.assertEqual(zlib.crc32(kind+data)&0xffffffff, struct.unpack('>I', png[at+8+size:at+12+size])[0])
            if kind == b'IDAT': compressed += data
            at += size+12
        self.assertEqual(zlib.decompress(compressed), b'\x00\xff\x00\x00\x00\x00\xff')

    def test_entire_batch_validated_before_input(self):
        m = self.module()
        for batch in ([{'kind':'click','x':10,'y':10},{'kind':'keys','keys':['UNKNOWN']}],
                      [{'kind':'click','x':-1,'y':3}], [{'kind':'text'}], [{'kind':'scroll','amount':21}]):
            with self.assertRaises(ValueError): m.validate_actions(batch, 100, 100)
        m.validate_actions([{'kind':'click','x':0,'y':99},{'kind':'keys','keys':['CTRL','A']},{'kind':'text','text':'日本語'}],100,100)

class ImageContractTest(unittest.TestCase):
    def test_backend_image_becomes_mcp_image_block(self):
        from remote_app.protocol import content
        from remote_app.windows import Desktop
        from unittest.mock import Mock
        desktop=Desktop.__new__(Desktop)
        desktop.require=lambda:None
        desktop.dimensions=lambda:(-2,0,2,1)
        desktop.u=Mock();desktop.g=Mock()
        desktop.g.GetDIBits.return_value=1
        result=content(desktop.screenshot())
        self.assertEqual(result['content'][1]['type'],'image')
