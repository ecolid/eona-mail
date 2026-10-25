"""Portable IMAP folder encoding and RFC 2971 client identification."""
import base64
import imaplib

def modified_utf7(value):
    result, pending = [], []
    def flush():
        if pending:
            result.append('&' + base64.b64encode(''.join(pending).encode('utf-16-be')).decode().rstrip('=').replace('/', ',') + '-')
            pending.clear()
    for char in value:
        if ' ' <= char <= '~':
            flush();result.append('&-' if char == '&' else char)
        else:
            pending.append(char)
    flush()
    return ''.join(result)

def identify(client):
    if 'ID' not in imaplib.Commands:
        imaplib.Commands['ID'] = ('AUTH', 'SELECTED')
    capabilities = {x.decode().upper() if isinstance(x, bytes) else str(x).upper() for x in getattr(client, 'capabilities', [])}
    if 'ID' in capabilities:
        status, response = client._simple_command('ID', '("name" "Mail" "version" "0.2")')
        client._untagged_response(status, response, 'ID')
