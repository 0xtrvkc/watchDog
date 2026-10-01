import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from server import Engine, fetch_quote, handler_factory


def quote(price, offset=0):
    return {'price': price, 'timestamp': time.time()+offset, 'updatedAt': '2026-10-01T00:00:00Z'}


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'state.json'
        self.engine = Engine(self.path)
        self.engine.observe(quote(4100, -5))

    def tearDown(self):
        self.temp.cleanup()

    def test_up_down_overshoot_once_and_restart(self):
        self.engine.arm([4150,4050])
        self.engine.observe(quote(4160,-4))
        sent = []
        self.engine.deliver(sent.append)
        self.engine.observe(quote(4165,-3))
        self.engine.deliver(sent.append)
        self.assertEqual(len(sent),1)
        restart = Engine(self.path)
        restart.observe(quote(4040,-2))
        restart.deliver(sent.append)
        self.assertEqual(len(sent),2)
        self.assertEqual([v['status'] for v in restart.state['levels']],['sent','sent'])

    def test_exact_touch(self):
        self.engine.arm([4150,4050])
        self.engine.observe(quote(4150,-4))
        self.assertEqual(self.engine.state['levels'][0]['status'],'pending')

    def test_independent_same_side_targets(self):
        self.engine.arm([4150,4200])
        self.engine.observe(quote(4210,-4))
        self.assertEqual(len(self.engine.state['pending']),2)

    def test_retry_survives_restart(self):
        self.engine.arm([4150,4050])
        self.engine.observe(quote(4160,-4))
        def fail(_):
            raise OSError('Mock SMTP unavailable')
        self.engine.deliver(fail)
        restored = Engine(self.path)
        self.assertEqual(restored.state['pending'][0]['attempts'],1)
        restored.state['pending'][0]['nextTry']=0
        sent=[]
        restored.deliver(sent.append)
        self.assertEqual(len(sent),1)
        self.assertEqual(restored.state['levels'][0]['status'],'sent')

    def test_stale_quote_and_replayed_quote_rejected(self):
        self.engine.arm([4150,4050])
        with self.assertRaises(ValueError):
            self.engine.observe(quote(4300,-300))
        self.engine.observe(quote(4300,-8))
        self.assertEqual(len(self.engine.state['pending']),0)

    def test_pause_cancels_pending(self):
        self.engine.arm([4150,4050])
        self.engine.observe(quote(4160,-4))
        self.engine.pause()
        sent=[]
        self.engine.deliver(sent.append)
        self.assertEqual(sent,[])
        self.engine.observe(quote(4000,-3))
        self.assertEqual(self.engine.state['pending'],[])

    def test_bad_targets(self):
        for values in ([1], [1,2,3], [True,10], ['nan',20], [-1,20], [100,100], [4100,4200]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                self.engine.arm(values)

    def test_provider_cache_minimum_and_instrument(self):
        class Response:
            headers={'Cache-Control':'public, max-age=60'}
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def read(self,_):
                from datetime import datetime, timezone
                return json.dumps({'symbol':'XAU','currency':'USD','price':4200,'updatedAt':datetime.now(timezone.utc).isoformat()}).encode()
        with patch('urllib.request.urlopen', return_value=Response()):
            result, delay=fetch_quote()
        self.assertEqual(delay,60)
        self.assertEqual(result['price'],4200)

    def test_private_api_and_origin_checks(self):
        server=ThreadingHTTPServer(('127.0.0.1',0), handler_factory(self.engine,'long-secret-password','http://localhost:8080'))
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        base=f'http://127.0.0.1:{server.server_port}'
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(base+'/api/state')
            self.assertEqual(error.exception.code,401)
            def post(origin):
                return urllib.request.Request(base+'/api/login',data=json.dumps({'password':'long-secret-password'}).encode(),headers={'Content-Type':'application/json','Origin':origin})
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(post('https://evil.example'))
            self.assertEqual(error.exception.code,403)
            with urllib.request.urlopen(post('http://localhost:8080')) as response:
                cookie=response.headers['Set-Cookie'].split(';')[0]
            request=urllib.request.Request(base+'/api/state',headers={'Cookie':cookie})
            with urllib.request.urlopen(request) as response:
                self.assertEqual(len(json.load(response)['levels']),0)
        finally:
            server.shutdown()
            server.server_close()


if __name__ == '__main__':
    unittest.main()
