"""Import a frozen SQLite snapshot and private files without overwriting history."""
import argparse
import hashlib
import json
import os
import sqlite3
from pathlib import Path
from psycopg import sql
from psycopg.rows import tuple_row
from .postgres import PostgresStore, initialize

TABLES = ('browser_references', 'reference_scores', 'candidates', 'discoveries', 'runs',
          'tasks', 'observations', 'judgments', 'budget', 'budget_settlements', 'metadata')


def rows_hash(rows):
    checksum = hashlib.sha256()
    count = 0
    for row in rows:
        checksum.update(json.dumps(list(row), ensure_ascii=False, separators=(',', ':')).encode()+b'\n')
        count += 1
    return {'rows': count, 'sha256': checksum.hexdigest()}


def source_files(root):
    for path in sorted(root.rglob('*')):
        if path.is_file() and str(path.relative_to(root)) not in ('state.sqlite3', 'state.sqlite3-wal', 'state.sqlite3-shm', 'worker.lock'):
            yield path


def migrate(root):
    root = Path(root)
    initialize(os.environ['TRACE_DATABASE_URL'])
    source = sqlite3.connect(f'file:{root / "state.sqlite3"}?mode=ro', uri=True)
    target = PostgresStore()
    try:
        if not target.acquire_worker():
            raise ValueError('Collector is active; migration requires exclusive access')
        available={r[0] for r in source.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
        if available!=set(TABLES):raise ValueError('Source schema differs from the complete migration table list')
        for table in TABLES:
            columns = [r[1] for r in source.execute(f'PRAGMA table_info({table})')]
            if not columns:
                raise ValueError('Missing source table: '+table)
            # TEXT columns retain the original JSON bytes; amounts retain binary64 precision.
            with target.db.connection.transaction():
                target.db.connection.execute(sql.SQL('CREATE TEMP TABLE incoming (LIKE {}) ON COMMIT DROP').format(sql.Identifier(table)))
                with target.db.connection.cursor().copy(sql.SQL('COPY incoming ({}) FROM STDIN').format(sql.SQL(',').join(map(sql.Identifier, columns)))) as copy:
                    for row in source.execute(f'SELECT * FROM {table}'):
                        copy.write_row(row)
                mismatch = target.db.connection.execute(sql.SQL('SELECT COUNT(*) FROM {} t JOIN incoming i USING({}) WHERE t IS DISTINCT FROM i').format(
                    sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier,
                    [r[1] for r in source.execute(f'PRAGMA table_info({table})') if r[5]])))).fetchone()[0]
                if mismatch:
                    raise ValueError(f'Conflicting existing history in {table}')
                target.db.connection.execute(sql.SQL('INSERT INTO {} SELECT * FROM incoming ON CONFLICT DO NOTHING').format(sql.Identifier(table)))
        for path in source_files(root):
            target.import_file(path.relative_to(root), path)
    finally:
        target.db.close()
        source.close()


def verify(root):
    root = Path(root)
    source = sqlite3.connect(f'file:{root / "state.sqlite3"}?mode=ro', uri=True)
    target = PostgresStore()
    report = {'passed': True, 'tables': {}, 'files': {'count': 0, 'bytes': 0, 'manifest_sha256': None}}
    manifest = hashlib.sha256()
    try:
        if not target.acquire_worker():raise ValueError('Collector is active; verification requires exclusive access')
        for table in TABLES:
            columns = [r[1] for r in source.execute(f'PRAGMA table_info({table})')]
            primary = [r[1] for r in source.execute(f'PRAGMA table_info({table})') if r[5]]
            ordering = ','.join('"'+c+'"' for c in primary)
            before = rows_hash(source.execute(f'SELECT * FROM {table} ORDER BY {ordering}'))
            query = sql.SQL('SELECT {} FROM {} ORDER BY {}').format(sql.SQL(',').join(map(sql.Identifier, columns)), sql.Identifier(table), sql.SQL(',').join(sql.SQL('{} COLLATE "C"').format(sql.Identifier(c)) for c in primary))
            with target.db.connection.cursor(row_factory=tuple_row) as cursor:
                after = rows_hash(cursor.execute(query))
            report['tables'][table] = {'source': before, 'target': after, 'match': before == after}
            report['passed'] &= before == after
        for path in source_files(root):
            checksum=hashlib.sha256();size=0
            with path.open('rb') as stream:
                while chunk:=stream.read(8*1024*1024):checksum.update(chunk);size+=len(chunk)
            sha=checksum.hexdigest()
            relative=str(path.relative_to(root))
            saved=target.file_checksum(relative)
            matches=bool(saved and saved['stored_sha256']==sha and saved['size']==size and saved['sha256']==sha)
            report['passed'] &= matches
            manifest.update((relative+'\0'+sha+'\n').encode())
            report['files']['count'] += 1
            report['files']['bytes'] += size
        report['files']['manifest_sha256'] = manifest.hexdigest()
        return report
    finally:
        source.close()
        target.db.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    if not args.verify_only: migrate(args.source)
    report = verify(args.source)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(report))
    if not report['passed']: raise SystemExit('Migration verification failed')
