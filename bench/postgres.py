"""Canonical Neon storage for serverless collection; receipts stay private."""
import gzip
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
import psycopg
from .storage import Store, digest, safe_json

WORKER_LOCK = 74012492
BUDGET_LOCK = 74012493


class Row(dict):
    def __getitem__(self, key):
        return tuple(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


def row_factory(cursor):
    names = [column.name for column in (cursor.description or [])]
    return lambda values: Row(zip(names, values))


class Database:
    """The collector's existing SQL interface, backed by PostgreSQL transactions."""
    def __init__(self, url):
        if '-pooler.' in (urlsplit(url).hostname or ''):
            raise ValueError('Collector requires a direct Neon connection for its session lock')
        self.connection = psycopg.connect(url, autocommit=True, row_factory=row_factory,
                                         connect_timeout=15, options='-c search_path=trace_collector,public')
        self.transactions = []

    def execute(self, query, params=()):
        if query == 'BEGIN IMMEDIATE':
            return self.connection.execute('SELECT pg_advisory_xact_lock(%s)', (BUDGET_LOCK,))
        return self.connection.execute(query.replace('?', '%s'), params)

    def executemany(self, query, params):
        with self.connection.cursor() as cursor:
            cursor.executemany(query.replace('?', '%s'), params)

    def __enter__(self):
        transaction = self.connection.transaction()
        self.transactions.append(transaction)
        transaction.__enter__()
        return self

    def __exit__(self, *args):
        return self.transactions.pop().__exit__(*args)

    def close(self):
        self.connection.close()


def initialize(url):
    from .storage import SCHEMA_SQL
    with psycopg.connect(url, autocommit=True) as connection:
        connection.execute('CREATE SCHEMA IF NOT EXISTS trace_collector')
        connection.execute('SET search_path=trace_collector,public')
        connection.execute(SCHEMA_SQL.replace('REAL', 'DOUBLE PRECISION'))
        connection.execute('CREATE INDEX IF NOT EXISTS observations_run_task_idx ON observations(run_id,task_id)')
        connection.execute('CREATE INDEX IF NOT EXISTS runs_status_started_idx ON runs(status,started_at)')
        connection.execute('''CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY, sha256 TEXT NOT NULL, data BYTEA, size BIGINT NOT NULL);
            CREATE TABLE IF NOT EXISTS file_chunks (
            path TEXT NOT NULL REFERENCES files(path), part INTEGER NOT NULL, data BYTEA NOT NULL, PRIMARY KEY(path,part));
            CREATE TABLE IF NOT EXISTS public_exports (
            path TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now());''')


class PostgresStore(Store):
    serverless = True
    defer_publish = True

    def __init__(self, url=None):
        self.root = Path('/tmp/trace-benchmark')
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = Database(url or os.environ['TRACE_DATABASE_URL'])

    def acquire_worker(self):
        return self.db.connection.execute('SELECT pg_try_advisory_lock(%s)', (WORKER_LOCK,)).fetchone()[0]

    def put_file(self, path, data):
        sha = digest(data)
        row = self.db.connection.execute('''INSERT INTO files VALUES(%s,%s,%s,%s)
            ON CONFLICT(path) DO UPDATE SET path=excluded.path WHERE files.sha256=excluded.sha256
            RETURNING sha256''', (str(path), sha, data, len(data))).fetchone()
        if not row:
            raise ValueError('Conflicting immutable file: '+str(path))
        return sha

    def import_file(self, path, source):
        checksum=hashlib.sha256()
        size=0
        with source.open('rb') as stream:
            while chunk:=stream.read(8*1024*1024):
                checksum.update(chunk);size+=len(chunk)
        sha=checksum.hexdigest()
        existing=self.db.connection.execute('SELECT sha256,size FROM files WHERE path=%s',(str(path),)).fetchone()
        if existing:
            if existing[0]!=sha or existing[1]!=size:raise ValueError('Conflicting immutable file: '+str(path))
            return
        if size<=8*1024*1024:
            self.put_file(path,source.read_bytes());return
        with self.db:
            self.db.connection.execute('INSERT INTO files VALUES(%s,%s,NULL,%s)',(str(path),sha,size))
            with source.open('rb') as stream:
                part=0
                while chunk:=stream.read(8*1024*1024):
                    self.db.connection.execute('INSERT INTO file_chunks VALUES(%s,%s,%s)',(str(path),part,chunk))
                    part+=1

    def file_checksum(self, path):
        row=self.db.connection.execute('SELECT sha256,size,data FROM files WHERE path=%s',(str(path),)).fetchone()
        if not row:return None
        checksum=hashlib.sha256();size=0
        if row['data'] is not None:
            checksum.update(row['data']);size=len(row['data'])
        else:
            with self.db.connection.transaction():
                with self.db.connection.cursor(name='verify_file') as cursor:
                    cursor.execute('SELECT data FROM file_chunks WHERE path=%s ORDER BY part',(str(path),))
                    for chunk in cursor:
                        checksum.update(chunk[0]);size+=len(chunk[0])
        return {'sha256':checksum.hexdigest(),'size':size,'stored_sha256':row['sha256']}

    def blob(self, value):
        data = safe_json(value).encode()
        key = digest(data)
        path='blobs/'+key[:2]+'/'+key+'.json.gz'
        if not self.db.connection.execute('SELECT 1 FROM files WHERE path=%s',(path,)).fetchone():
            self.put_file(path,gzip.compress(data,mtime=0))
        return key

    def load_blob(self, key):
        row = self.db.connection.execute('SELECT data FROM files WHERE path=%s',
            ('blobs/'+key[:2]+'/'+key+'.json.gz',)).fetchone()
        if not row:
            raise ValueError('Missing immutable receipt: '+key)
        data=row[0]
        if data is None:
            data=b''.join(bytes(chunk[0]) for chunk in self.db.connection.execute('SELECT data FROM file_chunks WHERE path=%s ORDER BY part',('blobs/'+key[:2]+'/'+key+'.json.gz',)))
        return json.loads(gzip.decompress(bytes(data)))

    def publish_file(self, path, value):
        self.db.connection.execute('''INSERT INTO public_exports(path,data) VALUES(%s,%s)
            ON CONFLICT(path) DO UPDATE SET data=excluded.data,updated_at=now()''', (path, safe_json(value)))
