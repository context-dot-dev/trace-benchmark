"""Explicit operator recovery of interrupted page groups; never select best attempts.
Call only while the worker is stopped and its writer lock is held.
"""
from .storage import now,safe_json


def recover(store,run_id,reason):
    if not reason.strip():raise ValueError('Recovery requires a documented reason')
    task_ids=[r[0] for r in store.db.execute("SELECT DISTINCT task_id FROM observations WHERE run_id=? AND status='dispatched' ORDER BY task_id",(run_id,))]
    if not task_ids:return {'task_ids':[]}
    archive={'run_id':run_id,'reason':reason,'at':now(),'observations':[],'references':[],'judgments':[],'scores':[]}
    attempts={}
    for task in task_ids:
        rows=[dict(r) for r in store.db.execute('SELECT * FROM observations WHERE run_id=? AND task_id=?',(run_id,task))]
        archive['observations'].extend(rows)
        archive['references'].extend(dict(r) for r in store.db.execute('SELECT * FROM browser_references WHERE run_id=? AND task_id=?',(run_id,task)))
        for row in rows:
            archive['judgments'].extend(dict(r) for r in store.db.execute('SELECT * FROM judgments WHERE observation_id=?',(row['id'],)))
            archive['scores'].extend(dict(r) for r in store.db.execute('SELECT * FROM reference_scores WHERE observation_id=?',(row['id'],)))
        attempts[task]=(store.meta('acquisition_attempt:'+run_id+':'+task) or 1)+1
    key=store.blob(archive)
    result={'at':archive['at'],'reason':reason,'task_ids':task_ids,'attempts':attempts,'archive_sha256':key,'policy':'Replace every provider on interrupted tasks; retain all prior receipts and budget reservations.'}
    history=store.meta('recovery:'+run_id) or []
    with store.db:
        for row in archive['observations']:
            for table in ('judgments','reference_scores'):store.db.execute('DELETE FROM '+table+' WHERE observation_id=?',(row['id'],))
            store.db.execute('DELETE FROM observations WHERE id=?',(row['id'],))
        for task in task_ids:
            store.db.execute('DELETE FROM browser_references WHERE run_id=? AND task_id=?',(run_id,task))
            store.db.execute('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('acquisition_attempt:'+run_id+':'+task,safe_json(attempts[task])))
        store.db.execute('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',('recovery:'+run_id,safe_json(history+[result])))
    return result
