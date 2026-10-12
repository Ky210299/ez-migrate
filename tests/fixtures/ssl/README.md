Self-signed certificate **for the tests only**. The PostgreSQL test container
serves it, and the SSL tests use `server.crt` as CA to check verification.
The key protects nothing: never use it outside the tests.

Regenerate:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 36500 -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  -keyout server.key -out server.crt
```
