# Serving the Production Build

If you need the full clone/build/deploy workflow, start with `docs/ops/self-hosting.md`.

The production build is a static SvelteKit SPA/PWA. It requires server configuration that serves real files normally and falls back to `/index.html` for client-side routes.

## Recommended: Using `serve` (Node.js)

The easiest way to serve the production build with proper SPA routing:

```bash
# Install serve globally (one time)
npm install -g serve

# Serve the build directory with SPA mode enabled
npx serve build -s -p 3000
```

**IMPORTANT:** The `-s` or `--single` flag is required to enable SPA routing. Without it, direct route access will return 404 errors.

The `-s` flag tells `serve` to:

- Redirect all non-file routes to index.html (enabling SPA routing)
- Properly handle client-side routing for routes like `/settings`, `/git/...`, `/c/...`, `/widgets`, and `/people/...`.

## Alternative: Using Python's http.server

Python's built-in server doesn't support SPA routing out of the box. You need a custom script:

```bash
# Create a simple SPA server
cd build
python3 -m http.server 3000
```

**Note:** This will NOT work for direct route access (e.g., `/settings`). You'll get 404 errors.

To fix this, create a custom Python server:

```python
# spa-server.py
import http.server
import socketserver
import os
from urllib.parse import urlparse

class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Parse the URL
        parsed_path = urlparse(self.path)
        path = parsed_path.path

        # Check if file exists
        if path != '/' and os.path.exists('.' + path):
            # Serve the file normally
            return http.server.SimpleHTTPRequestHandler.do_GET(self)
        else:
            # Serve index.html for all other routes (SPA routing)
            self.path = '/index.html'
            return http.server.SimpleHTTPRequestHandler.do_GET(self)

PORT = 3000
os.chdir('build')

with socketserver.TCPServer(("", PORT), SPAHandler) as httpd:
    print(f"Serving at http://localhost:{PORT}")
    httpd.serve_forever()
```

Then run:

```bash
python3 spa-server.py
```

## Alternative: Using Apache

If you're using Apache or LiteSpeed, the generated `build/.htaccess` handles SPA routing, cache headers, and CORS for `/.well-known/`. Point your vhost to `build/` and keep that file in place.

On shared hosting, Apache/PHP-FPM is the safer choice for Budabit. OpenLiteSpeed/LSCache may serve the SPA correctly while ignoring or overriding `.htaccess` `Header` and `AddType` rules, which breaks service-worker update reliability. If your host exposes toggles, use Apache/PHP-FPM, disable LSCache, and enable forced HTTPS/SSL.

After deployment, verify the effective live headers instead of assuming `.htaccess` was honored:

```bash
node scripts/check-deploy-cache.mjs https://your-domain.example
```

## Alternative: Using Nginx

Add this to your Nginx configuration:

```nginx
server {
    listen 3000;
    server_name localhost;
    root /path/to/flotilla/build;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }

    # Cache immutable static assets. SvelteKit content-hashes files under /_app/immutable/.
    location /_app/immutable/ {
        expires 1y;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    # Keep service workers, manifest, and update marker fresh.
    location ~* ^/(service-worker\.js|sw\.js|manifest\.webmanifest|_app/version\.json)$ {
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
        add_header Pragma "no-cache" always;
        add_header Expires "0" always;
    }

    location = /manifest.webmanifest {
        types { application/manifest+json webmanifest; }
        add_header Cache-Control "no-cache, no-store, must-revalidate" always;
    }

    # CORS for .well-known
    location /.well-known/ {
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Headers *;
        add_header Access-Control-Allow-Methods GET;
    }
}
```

## Why Direct Routes Return 404

When you access a direct route such as `http://192.168.10.103:3000/settings`:

1. The browser requests `/settings` from the server
2. The server looks for a file at `/settings` (doesn't exist)
3. Server returns 404

For SPAs to work, the server must:

1. Check if the requested path is a real file
2. If not, serve `index.html` instead
3. Let the client-side router (SvelteKit) handle the route

This is what `serve -s`, `serve.json`, `build/.htaccess`, and the configurations above accomplish.

## Cache Header Sanity Check

Before trusting a deployment, run:

```bash
node scripts/check-deploy-cache.mjs https://your-domain.example
```

This checks that mutable app-shell files revalidate, `manifest.webmanifest` has the correct content type, and `/_app/immutable/*` is the only long-lived immutable cache area.
