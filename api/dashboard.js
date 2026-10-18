import { handler } from '../server/functions/dashboard.js';

export default function dashboard(request, response) {
  const url = new URL(request.url, 'http://localhost');
  const route = url.searchParams.get('__trace_route');
  if (route === 'page') url.pathname = '/';
  else if (route === 'data') url.pathname = '/data/' + (url.searchParams.get('__trace_file') || '');
  else if (['summary', 'results', 'result', 'download'].includes(route)) url.pathname = '/api/' + route;
  url.searchParams.delete('__trace_route');
  url.searchParams.delete('__trace_file');
  request.url = url.pathname + url.search;
  return handler(request, response);
}
