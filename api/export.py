from api.cron import handler as CronHandler
import hmac
import os


class handler(CronHandler):
    def do_GET(self):
        secret = os.environ.get('CRON_SECRET')
        if not secret or not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer '+secret):
            return self.respond(401, {'error': 'Unauthorized'})
        if os.environ.get('TRACE_WORKER_ENABLED') != '1':
            return self.respond(200, {'status': 'disabled'})
        try:
            from bench.serverless import export
            return self.respond(200, export())
        except Exception as error:
            print('TRACE export failed:', type(error).__name__, flush=True)
            return self.respond(500, {'error': 'Publication failed'})
