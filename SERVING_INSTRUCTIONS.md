# Serving the Production Build

The production build is a static SPA (Single Page Application) that requires proper server configuration to handle client-side routing.

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
- Properly handle client-side routing for routes like `/settings`, `/spaces/...`, etc.

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

If you're using Apache, the `.htaccess` file in the build directory already handles SPA routing. Just point your Apache virtual host to the `build` directory.

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
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
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

When you access `http://192.168.10.103:3000/settings` directly:

1. The browser requests `/settings` from the server
2. The server looks for a file at `/settings` (doesn't exist)
3. Server returns 404

For SPAs to work, the server must:
1. Check if the requested path is a real file
2. If not, serve `index.html` instead
3. Let the client-side router (SvelteKit) handle the route

This is what the `serve.json`, `.htaccess`, and the configurations above accomplish.
