#!/usr/bin/env python3
"""
One-time script to get a Gmail OAuth2 refresh token.

Setup:
  1. Go to https://console.cloud.google.com
  2. Create a project (or use existing)
  3. Enable "Gmail API"
  4. Go to APIs & Services > Credentials > Create Credentials > OAuth client ID
  5. Application type: Desktop app
  6. Download the JSON — copy client_id and client_secret into .env
  7. Run: python3 scripts/get_gmail_token.py
  8. Copy the refresh_token printed at the end into .env
"""

import os, json, urllib.parse, urllib.request, http.server, threading, webbrowser
from dotenv import load_dotenv

load_dotenv()

CLIENT_ID     = os.environ['GMAIL_CLIENT_ID']
CLIENT_SECRET = os.environ['GMAIL_CLIENT_SECRET']
REDIRECT_URI  = 'http://localhost:8080'
SCOPE         = 'https://www.googleapis.com/auth/gmail.modify'

auth_code = None

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        params    = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        auth_code = params.get('code', [None])[0]
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'Auth complete. You can close this tab.')
        threading.Thread(target=self.server.shutdown).start()

    def log_message(self, *args): pass

server = http.server.HTTPServer(('localhost', 8080), Handler)

url = (
    'https://accounts.google.com/o/oauth2/auth'
    f'?client_id={CLIENT_ID}'
    f'&redirect_uri={REDIRECT_URI}'
    f'&response_type=code'
    f'&scope={urllib.parse.quote(SCOPE)}'
    f'&access_type=offline'
    f'&prompt=consent'
)
print(f'\nOpening browser for Gmail OAuth...\n{url}\n')
webbrowser.open(url)
server.serve_forever()

# Exchange code for tokens
data = urllib.parse.urlencode({
    'code':          auth_code,
    'client_id':     CLIENT_ID,
    'client_secret': CLIENT_SECRET,
    'redirect_uri':  REDIRECT_URI,
    'grant_type':    'authorization_code',
}).encode()

req  = urllib.request.Request('https://oauth2.googleapis.com/token', data=data, method='POST')
resp = json.loads(urllib.request.urlopen(req).read())

print('\n=== Add this to your .env ===')
print(f"GMAIL_REFRESH_TOKEN={resp['refresh_token']}")
