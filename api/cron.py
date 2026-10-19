from http.server import BaseHTTPRequestHandler
import hmac
import json
import os


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        secret = os.environ.get('CRON_SECRET')
        authorization = self.headers.get('Authorization', '')
        if not secret or not hmac.compare_digest(authorization, 'Bearer '+secret):
            return self.respond(401, {'error': 'Unauthorized'})
        if os.environ.get('TRACE_WORKER_ENABLED') != '1':
            return self.respond(200, {'status': 'disabled'})
        try:
            from bench.serverless import tick
            return self.respond(200, tick())
        except Exception as error:
            print('TRACE cron failed:', type(error).__name__, flush=True)
            return self.respond(500, {'error': 'Collector failed; inspect retained tick health'})

    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass
