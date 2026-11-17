const { handleRequest } = require('../server');

module.exports = function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = url.searchParams.get('route');
  if (route) {
    const query = new URLSearchParams(url.searchParams);
    query.delete('route');
    req.url = `/api/${route.replace(/^\/+/, '')}${query.size ? `?${query}` : ''}`;
  }
  return handleRequest(req, res);
};
