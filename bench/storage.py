"""Durable registry, immutable receipts and conservative dispatch reservations."""
import gzip
import hashlib
import json
import os
import math
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def _finite_number(value):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(value):
    if isinstance(value, str):
        value = value.encode()
    return hashlib.sha256(value).hexdigest()


def safe_json(value):
    data = json.dumps(value, ensure_ascii=False, sort_keys=True)
    for key, secret in os.environ.items():
        if any(k in key for k in ('API_KEY', 'TOKEN', 'SECRET')) and len(secret) > 8:
            data = data.replace(secret, '[REDACTED]')
    return data


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(safe_json(value), encoding='utf-8')
    os.replace(tmp, path)


class Store:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.root,0o700)
        self.db = sqlite3.connect(self.root / 'state.sqlite3', timeout=30)
        os.chmod(self.root / 'state.sqlite3',0o600)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS browser_references(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,status TEXT,data TEXT,blob TEXT);
        CREATE TABLE IF NOT EXISTS reference_scores(observation_id TEXT PRIMARY KEY,data TEXT);
        CREATE TABLE IF NOT EXISTS candidates(id TEXT PRIMARY KEY,url TEXT UNIQUE,data TEXT NOT NULL,first_seen TEXT NOT NULL,last_seen TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS discoveries(id TEXT PRIMARY KEY,data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,finished_at TEXT,status TEXT NOT NULL,cohort TEXT NOT NULL,metadata TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS tasks(run_id TEXT,id TEXT,data TEXT NOT NULL,PRIMARY KEY(run_id,id));
        CREATE TABLE IF NOT EXISTS observations(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,provider TEXT,status TEXT NOT NULL,data TEXT,blob TEXT,dispatched_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS judgments(observation_id TEXT PRIMARY KEY,status TEXT NOT NULL,data TEXT,blob TEXT);
        CREATE TABLE IF NOT EXISTS budget(day TEXT,bucket TEXT,reservation_id TEXT,amount REAL NOT NULL,PRIMARY KEY(day,bucket,reservation_id));
        CREATE TABLE IF NOT EXISTS budget_settlements(day TEXT,bucket TEXT,reservation_id TEXT,amount REAL NOT NULL CHECK(amount>=0),PRIMARY KEY(day,bucket,reservation_id));
        CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        ''')
        self.db.commit()

    def blob(self, value):
        data = safe_json(value).encode()
        key = digest(data)
        path = self.root / 'blobs' / key[:2] / (key + '.json.gz')
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
            with os.fdopen(fd,'wb') as f:
                f.write(gzip.compress(data, mtime=0))
        return key

    def load_blob(self, key):
        return json.loads(gzip.decompress((self.root/'blobs'/key[:2]/(key+'.json.gz')).read_bytes()))

    def reserve(self, bucket, reservation_id, amount, cap, day=None):
        if not _finite_number(amount) or amount<=0 or not _finite_number(cap) or cap<0:
            raise ValueError('invalid reservation amount or cap')
        day = day or now()[:10]
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            existing = self.db.execute('SELECT amount FROM budget WHERE day=? AND bucket=? AND reservation_id=?', (day,bucket,reservation_id)).fetchone()
            if existing:
                return False  # A dispatched request must never be silently replayed.
            used = self.db.execute("""
                SELECT COALESCE(SUM(COALESCE(s.amount,b.amount)),0)
                FROM budget b LEFT JOIN budget_settlements s
                USING(day,bucket,reservation_id) WHERE b.day=? AND b.bucket=?
                """, (day,bucket)).fetchone()[0]
            if used+amount > cap:
                return False
            self.db.execute('INSERT INTO budget VALUES(?,?,?,?)',(day,bucket,reservation_id,amount))
        return True

    def reserve_all(self, buckets, reservation_id, day=None):
        """Reserve one call across multiple budget buckets atomically."""
        if not buckets or len({b for b,_ in buckets})!=len(buckets):
            raise ValueError('distinct budget buckets required')
        if any(not _finite_number(cap) or cap<0 for _,cap in buckets):
            raise ValueError('invalid budget cap')
        day=day or now()[:10]
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            for bucket,cap in buckets:
                if self.db.execute('SELECT 1 FROM budget WHERE day=? AND bucket=? AND reservation_id=?',(day,bucket,reservation_id)).fetchone():return False
                used=self.db.execute('SELECT COALESCE(SUM(COALESCE(s.amount,b.amount)),0) FROM budget b LEFT JOIN budget_settlements s USING(day,bucket,reservation_id) WHERE b.day=? AND b.bucket=?',(day,bucket)).fetchone()[0]
                if used+1>cap:return False
            self.db.executemany('INSERT INTO budget VALUES(?,?,?,?)',[(day,bucket,reservation_id,1) for bucket,_ in buckets])
        return True

    def settle(self, bucket, reservation_id, amount, day=None):
        """Record measured provider usage without changing the original reservation.

        Call only after persisting a complete receipt with validated provider usage.
        Missing/failed usage is not zero: leave its full reservation outstanding.
        Returns True on insertion and False on identical replay. Conflicting
        settlements and amounts outside [0, original] raise ValueError.
        """
        if not _finite_number(amount) or amount < 0:
            raise ValueError('invalid measured usage')
        day = day or now()[:10]
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            original = self.db.execute(
                'SELECT amount FROM budget WHERE day=? AND bucket=? AND reservation_id=?',
                (day,bucket,reservation_id)).fetchone()
            if original is None:
                raise ValueError('settlement requires an existing reservation')
            if amount > original['amount']:
                raise ValueError('measured usage exceeds the original reservation')
            existing = self.db.execute(
                'SELECT amount FROM budget_settlements WHERE day=? AND bucket=? AND reservation_id=?',
                (day,bucket,reservation_id)).fetchone()
            if existing is not None:
                if existing['amount'] != amount:
                    raise ValueError('settlement is immutable; conflicting measured usage')
                return False
            self.db.execute('INSERT INTO budget_settlements VALUES(?,?,?,?)',
                            (day,bucket,reservation_id,amount))
        return True

    def usage(self, day=None):
        """Effective usage: measured amounts plus full unsettled reservations."""
        return {r['bucket']:r['used'] for r in self.db.execute("""
            SELECT b.bucket,SUM(COALESCE(s.amount,b.amount)) AS used
            FROM budget b LEFT JOIN budget_settlements s USING(day,bucket,reservation_id)
            WHERE b.day=? GROUP BY b.bucket
            """, (day or now()[:10],))}

    def usage_reserved(self, day=None):
        """Original dispatch reservations, retained even after settlement."""
        return {r['bucket']:r['used'] for r in self.db.execute(
            'SELECT bucket,SUM(amount) AS used FROM budget WHERE day=? GROUP BY bucket',
            (day or now()[:10],))}

    def meta(self, key, value=None):
        if value is None:
            row=self.db.execute('SELECT value FROM metadata WHERE key=?',(key,)).fetchone()
            return json.loads(row[0]) if row else None
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',(key,safe_json(value)))

    def ingest(self, result):
        from .discovery import CATEGORIES
        stamp=now()
        priority={c:i for i,c in enumerate(CATEGORIES)}
        with self.db:
            for c in sorted(result['candidates'],key=lambda c:(priority.get(c['category'],999),c['source_id'],c['id'])):
                old=self.db.execute('SELECT first_seen,data FROM candidates WHERE id=?',(c['id'],)).fetchone()
                c=dict(c,discovered_at=old['first_seen'] if old else c.get('discovered_at',stamp))
                if old:
                    previous=json.loads(old['data'])
                    origins=previous.get('discovery_origins',[{'source_id':previous['source_id'],'category':previous['category']}])
                    origin={'source_id':c['source_id'],'category':c['category']}
                    if origin not in origins:origins.append(origin)
                    if priority.get(previous['category'],999)<priority.get(c['category'],999):c=previous
                    c['discovery_origins']=origins
                self.db.execute('INSERT INTO candidates VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,last_seen=excluded.last_seen',(c['id'],c['url'],safe_json(c),c['discovered_at'],stamp))
            self.db.execute('INSERT INTO discoveries VALUES(?,?)',(stamp,safe_json({k:v for k,v in result.items() if k!='candidates'})))
        self.meta('last_collection_at',stamp)

    def candidates(self):
        return [json.loads(r[0]) for r in self.db.execute('SELECT data FROM candidates ORDER BY id')]

    def seen(self, cohort='independent'):
        from .discovery import identity_keys
        seen=set()
        for row in self.db.execute('SELECT tasks.data FROM tasks JOIN runs ON runs.id=tasks.run_id WHERE runs.cohort=?',(cohort,)):
            seen.update(identity_keys(json.loads(row[0])))
        return seen

    def create_run(self, run_id, selected, metadata, cohort='independent'):
        from .export import PROTOCOL
        import platform
        source_root=Path(__file__).resolve().parent
        if self.meta('collection_profile')=='live':
            config=json.loads((source_root.parent/'config/benchmark.json').read_text())
            from .capacity import profile
            metadata=dict(metadata,provider_ids=config['providers'],browser_reference=config['browser_reference'],benchmark_config=config,collection_profile=profile(self))
        else:
            metadata=dict(metadata,provider_ids=['context','hetzner','exa','keenable'],browser_reference=False)
        manifest={str(p.relative_to(source_root.parent)):digest(p.read_bytes()) for p in sorted(source_root.glob('*.py'))}
        for name in ['config/sources.json','config/benchmark.json','requirements-lock.txt']:
            path=source_root.parent/name
            if path.exists():manifest[name]=digest(path.read_bytes())
        metadata=dict(metadata,protocol_version=PROTOCOL if self.meta('collection_profile')=='live' else 'trace-live-v1',code_sha256=digest(safe_json(manifest)),code_manifest=manifest,collector={'hostname':os.environ.get('TRACE_COLLECTOR','local'),'platform':platform.system(),'python':platform.python_version()},selection_sha256=digest(safe_json(selected)))
        with self.db:
            self.db.execute('INSERT INTO runs VALUES(?,?,?,?,?,?)',(run_id,now(),None,'running',cohort,safe_json(metadata)))
            self.db.executemany('INSERT INTO tasks VALUES(?,?,?)',[(run_id,c['id'],safe_json(c)) for c in selected])

    def close_run(self, run_id, status):
        with self.db:
            self.db.execute('UPDATE runs SET status=?,finished_at=? WHERE id=?',(status,now(),run_id))
