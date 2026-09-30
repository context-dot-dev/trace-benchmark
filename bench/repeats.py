"""Durable pre-dispatch repeat plans, separate from first-acquisition results.

Callers hold the CLI worker lock. Plans survive materialization and execution;
an interrupted materialization is therefore discoverable on the next tick.
"""
import json
from datetime import datetime, timedelta, timezone
from .storage import digest, now


def schedule(store, run_id, selected, quota=2):
    plans = store.meta('repeat_jobs') or []
    if any(j['parent'] == run_id for j in plans):
        return  # The first plan is immutable, including its due time and quota.
    repeat_id = 'repeat-' + run_id
    if store.db.execute('SELECT 1 FROM runs WHERE id=?', (repeat_id,)).fetchone():
        return  # Legacy materialization may have removed its pending plan.
    if isinstance(quota, bool) or not isinstance(quota, int) or quota < 0:
        raise ValueError('Repeat quota must be a nonnegative integer')
    parent = store.db.execute('SELECT * FROM runs WHERE id=?', (run_id,)).fetchone()
    if not parent or parent['cohort'] != 'independent':
        raise ValueError('Repeat parent must be an existing independent run')
    if parent['status'] != 'running' or store.db.execute(
        'SELECT 1 FROM observations WHERE run_id=? LIMIT 1', (run_id,)
    ).fetchone():
        raise ValueError('Repeat selection must precede parent acquisition')
    frozen = [json.loads(r[0]) for r in store.db.execute(
        'SELECT data FROM tasks WHERE run_id=? ORDER BY id', (run_id,))]
    if sorted(selected, key=lambda c: c['id']) != frozen:
        raise ValueError('Repeat selection must use the complete frozen parent panel')
    chosen = sorted(frozen, key=lambda c: digest('repeat-v1:' + run_id + ':' + c['id']))[:quota]
    stamp = now()
    plans.append({'parent': run_id, 'run_id': repeat_id, 'selected_at': stamp,
                  'due_at': (datetime.fromisoformat(stamp) + timedelta(hours=6)).isoformat(),
                  'quota': quota, 'selected': chosen})
    store.meta('repeat_jobs', plans)


def materialize_due(store):
    ready = []
    for plan in store.meta('repeat_jobs') or []:
        if not plan['selected'] or datetime.fromisoformat(plan['due_at']) > datetime.now(timezone.utc):
            continue
        existing = store.db.execute('SELECT * FROM runs WHERE id=?', (plan['run_id'],)).fetchone()
        if existing is None:
            store.create_run(plan['run_id'], plan['selected'], {
                'parent_run_id': plan['parent'], 'scheduled_for': plan['due_at'],
                'repeat_selected_at': plan.get('selected_at'),
                'repeat_rule': 'preselected_sha256_six_hours'}, cohort='repeat')
        else:
            metadata = json.loads(existing['metadata'])
            frozen = [json.loads(r[0]) for r in store.db.execute(
                'SELECT data FROM tasks WHERE run_id=? ORDER BY id', (plan['run_id'],))]
            if (existing['cohort'] != 'repeat' or metadata.get('parent_run_id') != plan['parent']
                    or frozen != sorted(plan['selected'], key=lambda c: c['id'])):
                raise ValueError('Existing repeat run conflicts with its frozen plan')
            if existing['status'] not in ('running', 'acquired', 'incomplete', 'pending_budget'):
                continue  # Completed/review-pending runs require explicit review, not paid retries.
        ready.append(plan['run_id'])
    return ready
