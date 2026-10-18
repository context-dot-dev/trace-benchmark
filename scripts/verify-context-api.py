"""Live adapter proof: POST transport, nested Markdown, freshness, and auth failure.

Run explicitly with Doppler; this spends one scrape request and never changes
benchmark state. A 200 with a failed/missing Markdown output must not count as
returned content. Missing credentials must not make a network request.
"""
import asyncio
import json
import os
from pathlib import Path
from bench.providers import fetch_reader

async def main():
    success = await fetch_reader('context', 'https://example.com')
    request = success['request_config']
    checks = {
        'unified_endpoint': request['endpoint'] == 'https://api.context.dev/v1/web/scrape',
        'post_json': request['method'] == 'POST' and request['json']['formats'] == {'markdown': True},
        'returned_markdown': success['outcome'] == 'returned' and 'domain is for use in documentation examples' in success['text'],
        'fresh_requested': success['freshness']['requested'],
        'uncached': success['cache'].get('status') == 'miss',
        'billing_preserved': success['credits'] is not None,
    }
    original = os.environ.pop('CONTEXT_API_KEY')
    try:
        missing = await fetch_reader('context', 'https://example.com')
        checks['missing_key_not_dispatched'] = missing['error_code'] == 'MISSING_CREDENTIAL' and missing['api_status'] is None
        os.environ['CONTEXT_API_KEY'] = 'invalid-trace-adapter-verification'
        denied = await fetch_reader('context', 'https://example.com')
        checks['auth_error_retained'] = denied['api_status'] == 401 and denied['outcome'] == 'harness_error' and denied['text'] == ''
    finally:
        os.environ['CONTEXT_API_KEY'] = original
    out = Path('artifacts/context-api')
    out.mkdir(parents=True, exist_ok=True)
    report = {'passed': all(checks.values()), 'checks': checks, 'request': request,
              'elapsed_ms': success['elapsed_ms'], 'credits': success['credits'],
              'request_id': success['raw'].get('response', {}).get('request_id'),
              'text_sha256': success['text_sha256']}
    (out / 'verification.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    assert report['passed'], 'Context API contract failed'

asyncio.run(main())
