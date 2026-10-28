"""HTTP reader → immutable receipt → judge request → public JSON verification.

Failure modes: a lone UTF-16 surrogate crashes hashing or persistence; malformed
raw metadata crashes serialization; valid Unicode changes; raw evidence is lost;
or one malformed response prevents the next page from completing. No paid calls.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from bench.providers import fetch_reader
from bench.judging import payload
from bench.storage import Store, atomic_json, safe_json, now

VALID = 'Useful page with café, 中文 and 🚀.'
MALFORMED = VALID + '\ud83d trailing \udc00'

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self): self.do_GET()
    def do_GET(self):
        text = VALID if self.path.startswith('/valid') else MALFORMED
        body = {'markdown': {'requested': True, 'success': True, 'data': text},
                'success': True, 'data': {'markdown': text},
                'results': [{'text': text, 'url': 'https://example.com'}],
                'content': text, 'raw_metadata': '\ud83d'}
        data = json.dumps(body).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

async def main():
    root = Path('artifacts/unicode-receipts') / now().replace(':', '-')
    store = Store(root / 'state')
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    Thread(target=server.serve_forever, daemon=True).start()
    checks = {}
    receipts = []
    try:
        for provider in ('context', 'exa', 'firecrawl', 'keenable'):
            key = provider.upper() + '_API_KEY'
            previous = os.environ.get(key)
            os.environ[key] = 'local-verification-only'
            try:
                for mode in ('malformed', 'valid'):
                    label = provider + ':' + mode
                    try:
                        observation = await fetch_reader(provider, 'https://example.com', {'endpoints': {provider: f'http://127.0.0.1:{server.server_port}/{mode}'}})
                        blob = store.blob(observation)
                        restored = store.load_blob(blob)
                        request = payload({'url': 'https://example.com', 'category': 'news'}, restored)
                        json.dumps(request, ensure_ascii=False).encode('utf-8')
                        atomic_json(root / (label.replace(':', '-') + '.json'), restored)
                        expected = VALID if mode == 'valid' else VALID + '\ufffd trailing \ufffd'
                        checks[label] = observation['outcome'] == 'returned' and restored['text'] == expected and restored['raw']['response']['raw_metadata'] == '\ud83d' and restored['raw']['response']['content'] == (VALID if mode == 'valid' else MALFORMED) and restored['text_sha256'] == hashlib.sha256(expected.encode()).hexdigest()
                        receipts.append(blob)
                    except Exception as error:
                        checks[label] = False
                        print(label, type(error).__name__, str(error))
            finally:
                if previous is None: os.environ.pop(key, None)
                else: os.environ[key] = previous
        checks['valid_serialization_unchanged'] = safe_json({'text': VALID}) == json.dumps({'text': VALID}, ensure_ascii=False, sort_keys=True)
        report = {'passed': all(checks.values()), 'checks': checks, 'receipts': receipts}
        atomic_json(root / 'verification.json', report)
        print(json.dumps(report, indent=2)); print(root)
        if not report['passed']: raise SystemExit(1)
    finally:
        server.shutdown(); server.server_close(); store.db.close()

asyncio.run(main())
