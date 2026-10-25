// Keep the Fetch-to-Node transport in one place so authentication tests cross
// the same HTTP boundary as the production listener.
export async function writeResponse(response, res) {
  const headers = Object.fromEntries(response.headers);
  // Set-Cookie cannot be folded into a comma-separated header. In particular,
  // clearing a login-flow cookie must not expire the session cookie next to it.
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers['set-cookie'] = cookies;
  res.writeHead(response.status, headers);
  if (response.body) {
    for await (const part of response.body) {
      if (!res.write(part)) await new Promise(resolve => res.once('drain', resolve));
    }
  }
  res.end();
}
