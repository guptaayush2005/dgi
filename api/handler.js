const handleApiRequest = require('./[...path]');

module.exports = function handler(req, res) {
  const requestUrl = new URL(req.url, 'http://localhost');
  const route = requestUrl.searchParams.get('route');
  if (!route) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'API route not found.' }));
    return;
  }

  const query = new URLSearchParams(requestUrl.searchParams);
  query.delete('route');
  req.url = `/api/${route.replace(/^\/+/, '')}${query.size ? `?${query}` : ''}`;
  return handleApiRequest(req, res);
};
