"""Jev dispatch budgets and receipt-based estimates, separate from scraper pricing."""
from decimal import Decimal, InvalidOperation, ROUND_FLOOR
import json
import os

BUCKET = 'jev_input_token_reservations'
MODEL = 'jev-1.13.0'
INPUT_USD_PER_MILLION = Decimal('0.042')
TARIFF = {'model': MODEL, 'input_usd_per_million': float(INPUT_USD_PER_MILLION),
          'output_usd_per_million': 0, 'source': 'https://docs.typesafe.ai/models',
          'verified_at': '2026-09-30'}


def daily_token_cap():
    try:
        dollars = Decimal(os.environ.get('TRACE_JEV_DAILY_BUDGET_USD', '5'))
    except InvalidOperation as exc:
        raise ValueError('Invalid TRACE_JEV_DAILY_BUDGET_USD') from exc
    if not dollars.is_finite() or dollars < 0:
        raise ValueError('TRACE_JEV_DAILY_BUDGET_USD must be finite and nonnegative')
    return int((dollars * 1_000_000 / INPUT_USD_PER_MILLION).to_integral_value(rounding=ROUND_FLOOR))


def input_tokens(usage):
    value = usage.get('input_tokens') if isinstance(usage, dict) else None
    return value if type(value) is int and value >= 0 else None


def request_estimate(request):
    from .storage import safe_json
    if request['model'] != MODEL:
        raise ValueError('An explicit tariff is required for this model')
    # Shared state is sent once, even with multiple questions. Byte length plus
    # overhead is conservative planning, not a tokenizer or a billing receipt.
    return len(safe_json(request).encode()) + 2048


def usd(tokens):
    return float(Decimal(str(tokens)) * INPUT_USD_PER_MILLION / 1_000_000)


def cost_report(store):
    from .capacity import profile
    cap = min(daily_token_cap(), profile(store)['judge_input_reservations'])
    days = []
    for row in store.db.execute('''
        SELECT b.day, COUNT(*) AS jobs,
          SUM(COALESCE(s.amount,0)) AS reported_input_tokens,
          SUM(CASE WHEN s.amount IS NULL THEN b.amount ELSE 0 END) AS held_input_tokens,
          SUM(CASE WHEN s.amount IS NULL THEN 1 ELSE 0 END) AS unsettled_jobs,
          SUM(CASE WHEN s.amount>b.amount THEN 1 ELSE 0 END) AS overrun_jobs
        FROM budget b LEFT JOIN budget_settlements s USING(day,bucket,reservation_id)
        WHERE b.bucket=? GROUP BY b.day ORDER BY b.day DESC LIMIT 31
    ''', (BUCKET,)):
        item = dict(row)
        item.update(reported_cost_usd=usd(row['reported_input_tokens']),
                    held_cost_usd=usd(row['held_input_tokens']),
                    accounted_cost_usd=usd(row['reported_input_tokens']+row['held_input_tokens']))
        days.append(item)
    return {'tariff': TARIFF, 'daily_dispatch_limit_usd': usd(cap), 'days': days,
            'scope': 'Jev grading, output comparisons and legacy reference judgments in this collector; excludes scraping, discovery, hosting and other uses of the API key.',
            'basis': 'Complete usage receipts priced at the published tariff, not an invoice. Partially reported jobs remain reserved. Unsettled jobs retain conservative reservations, not actual charges. Concurrent calls can exceed estimates; overruns are retained and reduce later dispatch capacity.'}


def review_usage(judgment):
    if judgment.get('model') != MODEL:
        return None
    assessments = judgment.get('private', {}).get('assessments')
    if not assessments:
        assessments = [judgment]
    values = []
    for assessment in assessments:
        response = assessment.get('private', {}).get('response')
        usage = response.get('usage') if isinstance(response, dict) else assessment.get('usage')
        measured = input_tokens(usage)
        if measured is None:
            return None
        values.append(measured)
    return sum(values)


def reconcile(store):
    """Recover settlements from immutable receipts; never issue or repeat calls."""
    recovered = 0; missing = 0
    rows = list(store.db.execute('''SELECT b.* FROM budget b
        LEFT JOIN budget_settlements s USING(day,bucket,reservation_id)
        WHERE b.bucket=? AND s.amount IS NULL''', (BUCKET,)))
    for row in rows:
        key = row['reservation_id']; measured = None
        if key.startswith('output_comparison:'):
            result = store.meta(key) or {}
            if result.get('receipt_sha256'):
                receipt = store.load_blob(result['receipt_sha256'])
                if receipt.get('request', {}).get('model') == MODEL:
                    response = receipt.get('response')
                    measured = input_tokens(response.get('usage') if isinstance(response, dict) else None)
        else:
            if key.startswith('reference:'):
                saved = store.db.execute('SELECT blob FROM browser_references WHERE id=?', (key[len('reference:'):],)).fetchone()
            else:
                saved = store.db.execute('SELECT blob FROM judgments WHERE observation_id=?', (key,)).fetchone()
            if saved and saved['blob']:
                receipt = store.load_blob(saved['blob'])
                measured = review_usage(receipt.get('assessment', {}) if key.startswith('reference:') else receipt)
        if measured is None:
            missing += 1
        else:
            recovered += store.settle(BUCKET, key, measured, day=row['day'])
    return {'settled': recovered, 'unsettled': missing}


if __name__ == '__main__':
    import argparse
    import fcntl
    from .storage import Store
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--state', required=True)
    parser.add_argument('--reconcile', action='store_true')
    args = parser.parse_args()
    store = Store(args.state)
    with (store.root/'worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = {'reconciliation': reconcile(store)} if args.reconcile else {}
        print(json.dumps(dict(result, **cost_report(store))))
