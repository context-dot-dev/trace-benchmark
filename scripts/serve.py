"""Loopback-only static preview with gzip and conditional HTTP requests."""
import argparse
from functools import lru_cache
import gzip
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import os
from pathlib import Path

COMPRESSIBLE={'.html','.json','.js','.css','.svg','.md'}


@lru_cache(maxsize=8)
def compressed_file(path, modified, size):
    return gzip.compress(Path(path).read_bytes(),compresslevel=5,mtime=0)


class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        root=Path(self.directory).resolve()
        path=Path(self.translate_path(self.path)).resolve()
        if path.is_dir():path=(path/'index.html').resolve()
        if not path.is_relative_to(root) or not path.is_file():
            self.send_error(404,'File not found')
            return None
        encoding={}
        for item in self.headers.get('Accept-Encoding','').lower().split(','):
            parts=item.strip().split(';')
            quality=1.0
            for parameter in parts[1:]:
                if parameter.strip().startswith('q='):
                    try:quality=float(parameter.strip()[2:])
                    except ValueError:quality=0
            encoding[parts[0].strip()]=quality
        use_gzip=encoding.get('gzip',encoding.get('*',0))>0 and path.suffix in COMPRESSIBLE
        stat=path.stat()
        etag=f'W/"{stat.st_mtime_ns:x}-{stat.st_size:x}-{"gzip" if use_gzip else "identity"}"'
        unchanged=etag in [part.strip() for part in self.headers.get('If-None-Match','').split(',')]
        if unchanged:
            self.send_response(304)
            self.send_header('ETag',etag)
            self.send_header('Cache-Control','no-cache')
            self.send_header('Vary','Accept-Encoding')
            self.end_headers()
            return None
        if use_gzip:
            body=compressed_file(str(path),stat.st_mtime_ns,stat.st_size)
            stream=BytesIO(body);length=len(body)
        else:
            stream=path.open('rb');length=os.fstat(stream.fileno()).st_size
        self.send_response(200)
        self.send_header('Content-Type',self.guess_type(str(path)))
        self.send_header('Content-Length',str(length))
        self.send_header('Cache-Control','no-cache')
        self.send_header('ETag',etag)
        self.send_header('Vary','Accept-Encoding')
        if use_gzip:self.send_header('Content-Encoding','gzip')
        self.end_headers()
        return stream


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=8794)
    parser.add_argument('--directory',type=Path,default=Path(__file__).resolve().parents[1]/'site')
    args=parser.parse_args()
    from functools import partial
    server=ThreadingHTTPServer(('127.0.0.1',args.port),partial(Handler,directory=str(args.directory)))
    print(f'TRACE preview: http://127.0.0.1:{server.server_port}',flush=True)
    server.serve_forever()


if __name__=='__main__':main()
