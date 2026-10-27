"""Gmail immutable identity and labels shared by intake and reconciliation."""
import re

def metadata(header, decode):
    mid = re.search(rb'\bX-GM-MSGID\s+(\d+)\b', header)
    start = re.search(rb'\bX-GM-LABELS\s+\(', header)
    if not mid or not start:
        raise RuntimeError('gmail_metadata_missing')
    labels, i = [], start.end()
    while i < len(header):
        while i < len(header) and header[i:i+1] == b' ': i += 1
        if header[i:i+1] == b')':
            return {'message_id': mid[1].decode('ascii'), 'labels': labels}
        if header[i:i+1] == b'"':
            i += 1; value = bytearray()
            while i < len(header) and header[i:i+1] != b'"':
                if header[i:i+1] == b'\\':
                    i += 1
                    if header[i:i+1] not in (b'\\', b'"'): raise RuntimeError('gmail_label_invalid')
                value.extend(header[i:i+1]); i += 1
            if i >= len(header): raise RuntimeError('gmail_label_invalid')
            i += 1
        else:
            end = i
            while end < len(header) and header[end:end+1] not in (b' ', b')'): end += 1
            value = header[i:end]; i = end
            if not value: raise RuntimeError('gmail_label_invalid')
        labels.append(decode(bytes(value).decode('ascii')))
        if len(labels) > 1000: raise RuntimeError('gmail_label_capacity')
    raise RuntimeError('gmail_label_invalid')
